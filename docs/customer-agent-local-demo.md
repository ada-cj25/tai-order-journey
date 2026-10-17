# 客户智能客服本地 Demo

当前实现只连接本机的两套**独立测试库**：`whole_house_erp_customer_demo`（ERP 虚构订单）和 `whole_house_erp_customer_agent_demo`（LangGraph 会话与演示知识向量）。不读取现有 `whole_house_erp` 数据，也没有修改云端配置或服务。入口为 `http://127.0.0.1:5174/customer`；员工从同一个本地网页登录后，可打开“客服 Demo 管理”。测试手机号 `13800000001`、`13800000002` 分别绑定一笔 `TEST-DEMO-CUSTOMER-*` 虚构订单。

## 本地启动与验收

先确认 `.env.customer-demo` 存在，且 `CUSTOMER_DEMO_ENABLED=true`、两个数据库名与上述完全一致、所有服务地址为 loopback。该文件包含本地会话密钥，已由 `.gitignore` 忽略。先在本机 PostgreSQL 中创建两套空测试库，再运行 `node --env-file=.env.customer-demo scripts/setup-customer-demo.mjs`。脚本只接受这两个库名，不删除或重置数据；客户表 SQL 存在 `customer-agent/sql/local-customer-schema.sql`，**不在常规 Prisma 迁移目录内**，因此普通云端迁移不会顺带建客服表。之后分别启动：

```bash
npm run dev:customer:api
npm run dev:customer:agent
npm run dev:customer:web
```

验收与评测：

```bash
npm run test:customer-demo
customer-agent/.venv/bin/python customer-agent/check_mcp.py
node --env-file=.env.customer-demo customer-agent/run-benchmark.mjs
```

`customer-agent/benchmark-result.json` 保存当前演示样本结果。该报告是旧版仅含 4 条虚构片段的基线，每题只有 1 条标注相关文档，所以 Precision@5 的理论上限是 0.2；它不代表当前 32 条混合检索的效果。当前完整检索尚无独立人工标注的指标，不可将演示分数作为上线依据。正式评测需要用公司审核资料建立独立标注集，至少覆盖材料、交付、售后、无答案和跨订单权限场景。

## 执行边界

客户先通过**模拟**短信验证码登录。员工必须核对订单与预留手机号，主动确认绑定后，客户才能查询该订单；员工撤销绑定会立即收回访问。订单工具始终由 NestJS/Prisma 在服务端复核授权，Agent 只收到客户可见的进度投影，不接收金额、回单、附件或内部备注。多笔订单未唯一确定时先反问。人工请求可由客户提交，员工在本地管理页回复。

Agent 使用 LangGraph 节点 `prepare → decide → tools → answer → validate → handoff/finish`，受工具白名单、调用次数、超时和证据校验约束。客户明确要求转人工时，`handoff` 节点通过 MCP 工具提交幂等人工请求。工具通过官方 MCP Python SDK 注册，并由 Agent 的 MCP 客户端调用；MCP 服务在同一进程内使用协议连接，未开放公网端口。工具调用有本地超时与短时熔断，知识检索结果缓存 5 分钟，订单事实绝不缓存。订单事实由确定性模板输出；一般资料问答仅使用已批准的虚构演示片段；本地改色问题让全部 32 条切片参与候选召回与重排，但回答只引用最终命中的用户提供公司规则草稿，并标明待审核。草稿回答必须标明待审核并提示核实具体订单，缺证据时拒答。浏览器通过 SSE 在执行期间收到轨迹事件。会话检查点存于独立 PostgreSQL 库；记忆分为最近 8 轮、只存咨询主题的压缩摘要、每轮重新计算的客户权限画像。历史订单引用每轮按当前授权过滤，指代改写只引用仍有权限的订单。

当前为验证阶段：验证码保存在隔离 PostgreSQL 库且直接显示于本机页面，尚未接入短信服务或 Redis；改色问题的候选检索包含全部 28 条待审草稿和 4 条演示片段；公开资料与拟议流程草稿只参与检索分析，不被表述为本公司已批准政策；无 DeepSeek API 密钥时使用本地受控决策与抽取式回答。BGE-M3 Dense 与 `bge-reranker-v2-m3` 已在本机启用，正式业务效果仍待标注评测。向量暂以 PostgreSQL JSONB 存储，并在 Python 内做 cosine 排序；生产规模需要有索引的向量库、文档版本管理和正式权限审计。当前 LLM-as-judge 若未配置密钥会明确标记为跳过。**这些未完成项必须通过验收后才考虑云端部署。**

公司真实业务资料应先经过部门确认、客户可见范围审查、版本与生效日期审核，再切为每片不超过 500 个汉字的知识片段。建议优先向销售、设计、技术、采购、安装及售后收集：订单阶段的客户措辞、交付日期可承诺范围、材料保养差异、质保起点与适用条件、常见安装问题和人工升级标准。不要将未确认的内部规则或客户隐私直接纳入知识库。

## 工作台与 DeepSeek 接入（2026-10-15）

`src/CustomerDemo.tsx` 与 `src/customer-demo.css` 实现侧边导航、快速提问、会话、实时诊断、知识资料预览、运行状态、评测报告和人工请求。诊断只显示结构化执行事件、允许公开的工具参数和证据摘要，不显示模型的隐藏思考过程。SSE 每轮重置轨迹，失败及拒绝的工具尝试也消耗执行预算。

在项目根目录的本地终端执行：

```bash
python3 scripts/configure-customer-llm.py
```

按提示输入完整 DeepSeek key（输入不会回显）。脚本只修改被 Git 忽略的 `.env.customer-demo`，保留其他配置并设置文件权限为 0600。无需把 key 发到聊天里或填写到网页。然后重启 `npm run dev:customer:agent`；在运行状态页刷新，再发送一条问题。运行状态分别标识未配置、已配置待验证、实际调用成功或最近调用异常；仅创建 key 或看到模型名不算接通。

默认模型为 `deepseek-flash`，使用 OpenAI 兼容 Chat Completions，显式关闭 thinking，限制单次输出 1000 tokens，调用超时 20 秒且不自动重试。可在本地环境变量 `DEEPSEEK_MODEL` 覆盖。依据 [DeepSeek 官方 API 文档](https://api-docs.deepseek.com/api/create-chat-completion/) 核对；账号实际可用模型和余额仍需真实调用验证。失败会降级为本地规则与证据摘录，轨迹会明确标记。订单事实目前仍由确定性模板输出，知识回答经过保守的原文片段校验，不能视为已实现所有自然语言生成目标。

## 待审核知识草稿

文件：`customer-agent/knowledge/review/furniture-qa-2026-10-15.json` 含 18 条公开资料调研草稿，来自 6 个官方或品牌公开页面；`customer-agent/knowledge/review/company-change-policy-2026-10-16.json` 含 10 条围绕用户提供的“设计交付后板材型号/颜色不可更换、一单一采、客户强制变更费用由客户承担”规则编写的草稿及拟议处理流程。每条 `title + content` 不超过 500 字。两份草稿记录来源性质、建议调研部门、待确认问题、人工升级条件、版本和审核状态。`pending_company_review` / `active_for_answers=false` 表示尚未经公司审批；拟议流程没有冒充已签发规则。

检索器读取两份待审核文件，将草稿纳入**本地审核范围**的 BM25 Top20、BGE-M3 Dense Top20、RRF 融合和 Cross-Encoder 对前 20 个融合候选重排。隔离的本地客户 MCP `search_knowledge` 在改色意图下从全部 32 条切片检索：BM25 Top20 与 Dense Top20 经 RRF 融合，前 20 条由 Cross-Encoder 重排，取前 8 条供本地取证。回答阶段依据来源类型和审核状态限制可引用内容，不能把公开资料或拟议流程说成本公司政策；其他问题仍只检索 `approved_demo` 样例。检索候选范围与回答发布权限是两道不同的门槛。工作台可预览、筛选并下载草稿，但不提供未经审批的一键生效操作。各部门审核后还需补齐品牌、产品范围、锁定节点、费用与例外、有效期和审批记录，再进入正式知识发布流程。不要将地区旧合同示范文本或其他品牌的数值承诺作为本公司通用法律或服务规则。

模型文件保存在被 Git 忽略的 `customer-agent/.models/`：BGE-M3 是向量模型，`bge-reranker-v2-m3` 是 Cross-Encoder 重排模型。模型仓库的权重文件分别为 `pytorch_model.bin` 和 `model.safetensors`；只下载 tokenizer/config 不足以运行。可在项目根目录执行以下命令补齐（先安装 `customer-agent/requirements-models.txt`）：

```bash
customer-agent/.venv/bin/hf download BAAI/bge-m3 --local-dir customer-agent/.models/bge-m3 --include '*.json' --include '*.txt' --include '*.model'
customer-agent/.venv/bin/hf download BAAI/bge-m3 pytorch_model.bin colbert_linear.pt sparse_linear.pt --local-dir customer-agent/.models/bge-m3
customer-agent/.venv/bin/hf download BAAI/bge-reranker-v2-m3 --local-dir customer-agent/.models/bge-reranker-v2-m3 --include '*.json' --include '*.txt' --include '*.model' --include '*.safetensors'
npm run index:customer:knowledge
npm run index:customer:knowledge -- --query '柜子现在还可以换颜色吗？' --scope local_demo --summary
```

最后两条命令只允许连接本机 `whole_house_erp_customer_agent_demo`。第一条索引命令为全部 32 条切片计算并保存向量，内容变更时按 SHA-256 重新计算；第二条输出 BM25、Dense、RRF、Rerank 四段排名以便人工标注。`customer-agent/knowledge/retrieval-labels-template.json` 提供 8 个起始问题与候选 ID，`relevance` 留空，不能拿自动生成的候选当真值。人工标注后才能据此计算 Recall@5、Precision@5、MRR 和 nDCG@5。若模型和检索延迟通过本机验收，再把 `.env.customer-demo` 的 `CUSTOMER_ENABLE_DENSE` 和 `CUSTOMER_ENABLE_RERANK` 设为 `true` 并重启 Agent；默认关闭避免半下载的权重影响客户演示。

## 已完成的接入验证

2026-10-15 用户在本地配置 key 后，已重启 Agent 并完成真实 DeepSeek 调用。测试问题“柜门可以用酒精清洁吗？”由模型选择 `search_knowledge`，命中 1 条演示知识，再生成草稿；整轮约 4298 ms。由于原文片段校验较保守，本次草稿被降级为证据摘录，页面分别显示模型成功与校验降级。测试仅包含虚构演示资料。此记录不代表后续所有调用均成功，也不是上线效果评测。

2026-10-16 续验保留了界面截图 `test-results/customer-agent-workbench-20261016.png`。完整类型检查、构建、隔离环境端到端回归，以及失败/拒绝工具的预算检查均通过。正式知识发布、短信、Redis 与完整评测仍按后续阶段处理。

2026-10-16 检索续验：本机已下载 BGE-M3 与 `bge-reranker-v2-m3` 所需权重，32 条切片（4 条客户演示、28 条待审核）已写入独立客服测试库；本地 `.env.customer-demo` 的 Dense 与 Rerank 开关已启用，Agent 在启动时预热模型。对“设计交付后坚持更换板材颜色，费用由谁承担？”的审核检索中，`company-change-004` 在 BM25、Dense、RRF 和 Cross-Encoder 四段均排第 1。该例只是链路验收，不能替代人工标注后的 Recall@5、Precision@5、MRR 与 nDCG@5。随后发现客户问订单改色时因草稿范围隔离只取到材料清洁/售后演示片段；曾临时将改色候选集限制为四条，容易造成虚高的命中印象，现已撤销。原混合问题在全部 32 条中检索时，RRF 前 10 漏掉两条关键规则且重排前 5 混入公开草稿；现将订单进度与知识子问题拆开，扩大重排候选至 20，并保留真实 Top5 作为评测结果。经本地检索实测，简化后的「柜子现在还可以换颜色吗」重排前 5 包含三条用户提供的规则，第四条在第 6，故在线取证用 Top8；这不是 Recall@5 达标的证据。回答必须区分待审核草稿与订单事实，且不再无条件拼接其他知识。隔离环境端到端回归、MCP 范围检查、类型检查和构建已通过；未访问原 `whole_house_erp` 业务库或云端。

2026-10-16 同义问法回归：对“我的订单执行到哪里了，里面的柜子我可以换成红色的吗”，旧意图规则没把“红色”识别为颜色变更，导致检索候选虽出现在轨迹里，回答却只使用订单模板并触发无引用降级。现在颜色变更意图覆盖“换成红色”等具体色名，知识查询会去掉订单进度子句；验收用第二个虚构客户账号检查订单事实和知识来源同时进入回答。诊断侧栏分别显示检索候选数和最终回答引用数，不能把召回条数当作已采用的证据数。
