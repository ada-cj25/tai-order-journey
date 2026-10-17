# 企业高可用备选方案（当前不执行）

> 本文保留公司资产、CVM+托管PostgreSQL路线，用于将来需要高可用和RPO15分钟/RTO4小时时评估。当前公司轻量服务器测试使用 [company-cloud-test-runbook.md](company-cloud-test-runbook.md)，不要混用两套 Compose 和环境文件。

## 0. 发布前置门槛

桌面验收、备案、预算报价、公司资产归属、依赖安全审核、技术支持人均必须有记录。本文命令仅作受控环境操作手册；不能在未批准的生产账号执行。禁止将本地 `.env`、附件或整个开发数据库复制到正式环境。

建立公司持有的私有代码仓库；先审查忽略规则及待提交文件，排除密钥、客户附件、本地数据库导出，保留必要匿名测试夹具。创建首个可追溯提交和版本标签，记录提交SHA、镜像digest、迁移清单、测试结果和批准人。本轮尚未取得公司远端仓库，未替公司创建远端或推送源码。

## 1. 网络、账号与存储

正式：同地域VPC内应用和托管PG17；数据库关闭公网入口。服务器只对外开80/443，SSH仅VPN/堡垒机/指定管理地址；不开放3000、5173、5432。主账号MFA由公司持有，支持人员用子账号；正式与测试数据库、桶、密钥、域名及发布项目名都不同。

应用使用DML数据库角色。迁移用独立DDL角色，只在发布窗口加载。PG连接如启用TLS，使用官方CA验证，不能设置跳过证书验证。托管PG的连接、TLS、权限及恢复能力须在实际资源上联调；本地测试不能替代。

COS：私有读写；生产桶开启版本控制；备份桶使用不同权限主体和独立副本，应用凭证只允许业务桶GetObject/PutObject，不允许DeleteObject或操作备份桶。当前附件经后端鉴权代理传输，前端不持有COS密钥；单文件40MB，扩展名+基础内容特征校验及SHA-256完整性核验，不宣称具备杀毒能力。中文文件名通过下载接口返回。历史本地附件不进入新空生产库；如将来迁移，应单独逐文件核对校验和。

申请桌面域名和API子域名，证书需覆盖两者；小程序后续配置合法域名。桌面统一同源 `/api`，无需跨站Cookie。Nginx覆盖转发头，后端只信任一层代理。若增加CDN/负载均衡，必须重新验证来源IP、限流与代理信任，不能直接增加信任层数。

## 2. 构建与测试

使用Node24与lockfile：

```sh
npm ci
npm run db:generate
npm run typecheck
npm test
npm run test:workflow
npm run test:integration
npm run build
npm run build:api
npm run test:sites
npm audit --omit=dev
```

集成测试必须显式配置 `TEST_DATABASE_ADMIN_URL` 指向专用测试数据库管理员连接；脚本创建 `erp_test_随机串` 数据库、应用全量迁移、启动临时API、测试后仅删除自己创建的数据库和临时上传目录。**不会回退到应用 DATABASE_URL。** 未授权的生产账号不得运行测试。

`.github/workflows/verify.yml` 只验证，不部署；需公司私库启用Actions后才实际运行。Sites原有构建保留三个交付文件，但Sites worker不是NestJS生产API。

Docker三类镜像从同一提交构建并存入公司私有镜像仓库：

```sh
docker build --target api -t erp-api:VERSION .
docker build --target migrate -t erp-migrate:VERSION .
docker build --target web -t erp-web:VERSION .
```

记录digest后将 `deploy/release.env.example` 的三个镜像替换为digest引用。正式部署不在CVM上执行npm dev，也不现场拉取未测试的新依赖。基础镜像在每个批准版本记录实际digest并做扫描；目前Dockerfile标签不是长期不可变承诺。

## 3. 首次初始化与发布

1. 在安全目录分别建立runtime.env、migration.env、release.env和证书目录，权限0600。runtime参考示例；migration仅填迁移数据库连接。不要将填好密钥的文件复制回仓库。Compose插值会使用外部shell同名变量，发布前核对环境；只运行 `config --quiet`，不把包含密钥的展开配置打印到日志。
2. 核对正式/测试目标、备案、镜像digest、备份；在测试环境先执行同一套操作。
3. 迁移后初始化空库：运行 `npm run db:bootstrap -- --manifest=/安全目录/初始化.json` 先校验。示例中的六池0值和2608仅是结构占位，必须替换为当前月份真实已占用最大值；没有用过也须人工确认0。
4. 确认空库后，由技术支持在安全环境设置 `NODE_ENV=production`、`BOOTSTRAP_CONFIRM_DATABASE=精确目标库名` 和临时 `BOOTSTRAP_ADMIN_PASSWORD`，再加 `--apply` 执行。密码不传命令行参数、不进入日志。脚本拒绝覆盖已有员工、订单或编号池。首次管理员必须改密，之后通过“员工账号”开户，不运行演示seed。
5. 财务核对收款账户目录；新增账户由财务申请、董事长管理员审批，通过后才可用于收款报备。确认目录显示名与实际账户一一对应后再验收。
6. 订单管理员在“旧流程编号预留”登记仍走旧流程的新单/补单，只把返回编号登记回原流程。该操作与ERP正式设计提交共用服务器当前月份的原子流水池，留审计、不可回收；不创建虚假ERP父单。每月切换前核对旧流程是否已占用当月流水，不能两边继续独立编号。

以下命令在仓库根目录执行，环境路径仅示意，必须换成已核准文件：

```sh
docker compose --env-file /etc/erp/production/release.env -f deploy/compose.yaml config --quiet
docker compose --env-file /etc/erp/production/release.env -f deploy/compose.yaml pull
docker compose --env-file /etc/erp/production/release.env -f deploy/compose.yaml --profile maintenance run --rm migrate
docker compose --env-file /etc/erp/production/release.env -f deploy/compose.yaml up -d api web
```

迁移成功不是业务初始化完成；首次启动前应完成上述基础资料。`/api/health/live` 仅存活；`/api/health/ready` 检查账号安全字段可查询及本实例提醒扫描新鲜度（启动宽限3分钟）。它不验证COS、备份成功、业务正确性或所有迁移版本。Compose等API健康再启动入口；变成unhealthy不会自动重启，必须外部告警和人工处理。

发布烟测：登录→首次改密→角色范围→列表/详情→隔离烟测单的草稿和附件→退出；检查安全Cookie与HTTP跳转、限流、Swagger关闭、数据库无公网入口。真实业务库不得加速点击真实生产订单。

## 4. 正常升级与回退

每次：测试环境验证→岗位确认→备份→数据库兼容性审查→维护公告→迁移→按digest发布→健康及关键动作烟测。记录旧/新digest、迁移、批准人与时间。首期单应用节点可短暂停机。

代码异常优先将三个镜像换回上一批准版本并重启；先确认新字段/迁移向后兼容。**不自动回滚数据库，不用旧备份覆盖已经发生的收款和报工。** 不兼容迁移须另行批准修复方案。发生误操作先恢复到隔离环境，业务核对后决定逐笔修复并留痕。

## 5. 备份与实际恢复

腾讯云PG配置每日全量、保留30天、连续日志/可用时间点恢复；重要发布前额外备份。COS版本控制加独立备份副本，备份凭证与应用隔离。跨地域副本记录实际复制延迟。每日核对成功记录和容量；备份30天不是合同/质保资料30天后删除。

上线前及每月一次恢复演练：

1. 记录故障模拟时间、最新可恢复点、实际备份ID和附件版本清单。
2. 从指定时间点恢复到独立PG实例/库；从独立COS副本恢复到隔离桶，不覆盖正式资源。
3. 用对应版本镜像启动隔离应用，关闭外发消息；账号与网络仅授权验收人员。
4. 核对订单数量、最大编号、付款事实、工序数量、草稿、补单父关系、附件SHA-256及抽样可读性。
5. 记录恢复点差值及整体恢复时长。目标：普通实例故障/误操作RPO≤15分钟、RTO≤4小时；未实测就标“未验证”，区域灾难不沿用该目标。
6. 公司确认演练结果和资源清理范围后再处置临时恢复资源，保留报告。

## 6. 告警与故障登记

上线前接入公司负责人和技术支持：HTTPS不可用/ready连续失败、5xx、登录异常、上传失败、磁盘和数据库容量、提醒扫描超过3分钟未成功、备份失败、证书30/14/7天到期、资源欠费。云端外部监控尚待账号接入；仓库不含已生效的通知机器人。

停机启用统一临时登记：订单编号、实际发生时间、操作者、动作/数量、凭证位置、登记时间、复核人。恢复后指定人员审核补录，同时保留实际时间与补录时间；不得回填服务器采购完成时间或绕过付款/发货门禁。每日汇总；重大数据、权限或错误放行事故停止新增业务，保全日志并电话升级。

运行日志不得记录密码、Cookie、CSRF、COS凭证或完整客户附件。登录限流记录、MutationReceipt和安全审计需制订保留策略；当前不自动删除业务幂等收据，避免长延迟重试重复写入。

官方参考：[Compose健康依赖](https://docs.docker.com/compose/how-tos/startup-order/)、[变量替换与优先级](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)、[腾讯云PG备份方案](https://cloud.tencent.com/document/product/409/94889)、[COS版本控制](https://cloud.tencent.com/document/product/436/19884)。云能力须按实际购买版本验证。
