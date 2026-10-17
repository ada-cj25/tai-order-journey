# Design QA — 全屋定制订单跟单系统

## Result

**Passed** — 2026-08-27

final result: passed

## 2026-09-22 登录后桌面整体密度复核

- Source visual truth path: `/var/folders/pk/h06v193j56nbbfgvj0ypkrc00000gp/T/codex-clipboard-92f1bd4c-3b94-4f33-92bf-5b158f8809ee.png`，作为登录后桌面业务页的字号、卡片、表格和留白密度参考。
- Browser-rendered implementation screenshot: Codex in-app browser 在 `http://localhost:5173/` 的 1920 × 1080 行业桌面视口内联捕获；同时复核了订单列表和 `N26090008` 订单详情。
- Source pixels / implementation viewport: 1920 × 1080 / 1920 × 1080，以同尺寸比较顶栏、内容边距、卡片高度和双栏比例。
- Scope: 仅 `.erp-shell` 登录后桌面壳层；登录手帐页和 `/mobile` 不使用这套密度规则。

### Full-view and focused comparison evidence

- 订单列表：四个概览卡、搜索栏和表格收紧到参考图的专业后台节奏，同屏可见行数增加，主次层级仍然清晰。
- 订单详情：主内容列约 1179px、侧栏约 447px；订单头部 104px，流程条卡片 116px，通用卡片标题栏 44px，普通按钮 30px。
- 字体与控件：桌面基础字号 13px，按钮与表格正文 12px，表头与辅助信息 9–11px；按钮、输入框、选择器和日期控件采用紧凑高度与 6px 圆角。
- 页面节奏：主内容边距收紧为 20px / 24px / 34px，详情卡片间距收紧为 10px；边框保持 1px，圆角和阴影同步减弱。

### Findings and verification

1. 初始 P1：仅生产区域卡片已经紧凑，但桌面壳层其他 Ant Design 按钮、表单和表格仍使用默认 14px / 偏高间距，整页密度不一致。
2. 修复：以 `.erp-shell` 为唯一作用域，统一缩小桌面字号、控件高度、表格单元格、页面边距、卡片标题栏和详情网格间距，保留生产区域单行滑动。
3. 宽屏实测：1920 × 1080 下详情双栏比例稳定，卡片、表格和按钮无裁切；浏览器未出现本次 CSS 相关错误。控制台仅保留项目原有的 Ant Design `rowKey` / `dropdownRender` / `addonAfter` 弃用提示。
4. Automated checks: `npm run typecheck` 通过；`npm run build` 通过；`npm run test:workflow` 32/32 通过。

final result: passed

## 2026-09-22 生产区域单行滑动布局复核

- Source visual truth path: `/var/folders/pk/h06v193j56nbbfgvj0ypkrc00000gp/T/codex-clipboard-666c9052-1289-4c5d-a233-2d9812586cf2.png`，用于匹配图二的桌面信息密度、字号层级和紧凑卡片节奏。
- Before-state path: `/var/folders/pk/h06v193j56nbbfgvj0ypkrc00000gp/T/TemporaryItems/NSIRD_screencaptureui_j5IMPo/截屏2026-09-22 10.14.03.png`，用于确认四区域技术阶段的换行与过大排版问题。
- Browser-rendered implementation screenshot: Codex in-app browser inline captures from `http://localhost:5173/`，包含 1920 × 1080 全宽状态、1440 × 900 横向溢出状态及滑动后状态；浏览器工具未提供持久截图路径。
- Source pixels: 图二 1920 × 1080，修改前局部图 1566 × 1050。Implementation pixels/CSS viewport: 1920 × 1080 与 1440 × 900，截图像素与 CSS 视口为 1:1。
- State: 本地技术测试账号，订单 `N26090008`，技术拆单阶段，儿童房、卫生间、客厅、主卧四个未提交区域。图二业务阶段不同，本次仅以其桌面密度和卡片风格为目标，不对齐其完工/发货文案。

### Full-view and focused comparison evidence

- 1920 × 1080：四张区域卡片在“生产区域总览”内保持一行，标题栏、状态、按钮和卡片密度与图二的紧凑工作台接近，不再出现修改前的第二行孤立卡片和大片空白。
- 1440 × 900：滚动容器 `clientWidth=789`、`scrollWidth=1154`，固定卡片宽 280px、高约 136px；计算样式为 `display:flex`、`flex-wrap:nowrap`、`overflow-x:auto`。
- 聚焦区域：从左端滑到 `scrollLeft=365` 后，第四张“主卧”卡片完整可见并可选中；选中边框、状态标签、作废和继续提交操作都保留。
- 源图与实施局部截图已在同一浏览器比较输出中打开；不需要额外的图片素材或图标替换。

### Required fidelity surfaces

- Fonts and typography: 继续使用 Noto Sans SC / PingFang SC；卡片标题 14px，按钮 12px，状态标签 11px，生产编号 10px，标签和操作文案不再换行放大。
- Spacing and layout rhythm: 标题栏 46px，卡片主体 11–12px 内边距、7px 局部间距，卡片间隔 10px；固定单行轨道在宽屏全展开，窄屏只在卡片容器内滑动。
- Colors and visual tokens: 保留现有深绿、青绿、浅绿灰边框与语义状态色，没有引入图二之外的装饰风格。
- Image quality and assets: 该组件无业务图片资产；使用原有 Ant Design 控件，未用 CSS 绘图、emoji 或占位图替换素材。
- Copy and content: 区域名称、生产编号、路线/计划状态、作废与继续提交文案均保留，没有为压缩排版删减业务信息。

### Findings and comparison history

1. 初始 P1：三列 CSS Grid 在四区域时把主卧换到第二行，卡片标签可换行且垂直间距偏大，形成用户指出的“老年人版”视觉。
2. 修复：区域容器改为固定卡片宽度的不换行 Flex 轨道，开启容器内横向滚动，压缩字号、按钮高度、内边距与卡片高度。
3. 复查：1920px 视口四区域单行完整展示；1440px 视口只产生容器内溢出，实际滑动与第四卡选中通过。无剩余 P0/P1/P2。

### Verification

- Primary interactions tested: 技术账号登录、打开 `N26090008`、区域轨道横向滑动、滑动后选中“主卧”、技术继续提交入口保留。
- Automated checks: `node --test tests/workflow-validation.test.mjs` 18/18 通过；`npm run typecheck` 通过；`npm run build` 通过。
- Browser console: 无本次布局相关异常；仅有项目原有 Ant Design Table `rowKey` 的 deprecated 警告。

final result: passed

## 2026-09-18 登录前置天气页复核

- Source visual truth path: `/var/folders/pk/h06v193j56nbbfgvj0ypkrc00000gp/T/codex-clipboard-5a8384d8-ea54-4fb0-baae-e455d10511c3.jpg`。
- Source animation truth: `/Users/cj25/Desktop/晴天(1).zip` 与 `/Users/cj25/Desktop/雨天.zip`；实施继续使用 `src/assets/login-weather/` 内的原始 1134 × 1134 PNG 帧。
- Browser-rendered implementation screenshot: Codex in-app browser inline capture from `http://localhost:5173/`（浏览器工具未提供持久截图文件路径）。
- Source pixels: 1440 × 1080；implementation pixels: 1440 × 900；CSS viewport: 1440 × 900；capture density: 1 implementation pixel per CSS pixel。源图包含浏览器外框及粉色展示底板，实施对比时按用户要求只归一化其“大留白白窗—小幅中心插画—标题—进入提示”的内容构图，不把外框和粉色视作目标。
- State: localhost、未配置高德 Key 的晴天静态降级、前置页首屏；同时复核进入后的测试账号登录页和 `/mobile` 登录页。

### Full-view comparison evidence

- 1440 × 900：实施保留参考图的大面积白色窗体、中心小幅手绘画面、画面下方标题与底部进入提示；外层按明确要求替换为现有 `#06251f` 深绿点阵背景。白窗边距、圆角、细边框和阴影形成与参考相同的“打开一页私人房间/手帐”层次。
- 1280 × 720：前置窗、天气画面、标题和进入按钮全部在首屏内；进入后测试账号卡、橘猫、登录表单和按钮也全部在首屏内。
- 1050 × 720：前置页保持单一居中构图；进入后的登录内容切换为上下布局，`scrollWidth=1050` 与 `clientWidth=1050` 一致，无横向溢出。
- 720 × 800：顶部只保留品牌标记，中心画面和标题完整，底部进入按钮不被裁切。
- `/mobile`：DOM 中 `.erp-login-prelude`、`.erp-login-weather-card`、`.scrapbook-cat` 均不存在，只渲染手机只读登录表单。

### Focused region comparison evidence

- 中心区域：参考图和实施都以小比例线稿插画作为唯一视觉焦点；实施未重绘素材，直接展示用户提供的晴/雨原始 PNG，`object-fit: contain` 保持白底、完整线条和原始纵横比。
- 标题区域：实施使用中文楷体回退栈、加宽字距和小号英文眉题，呼应参考图的手写房间标题；辅助句控制在单行且不抢插画层级。
- 进入区域：整页点击可进入，同时底部保留语义化 `button`、可见焦点环和“点击进入”提示；Enter 键实测可用。减少动态效果时前置窗入场动画被禁用，天气只显示首帧。
- 登录回归：进入后 localhost 四类测试账号页签与原凭据入口保留；右侧登录卡、橘猫、黄毛线球光标和服务端认证流程未改变。

### Required fidelity surfaces

- Fonts and typography: 前置页用楷体回退栈承接参考图的手写标题气质，UI 小字继续使用既有中文无衬线栈；字号、字重、行高和字距在 1440、1280、1050、720 宽度均无异常换行或截断。
- Spacing and layout rhythm: 白窗采用 54px 顶栏、弹性中央留白和 78px 进入区；插画、天气标签、眉题、标题、说明形成稳定的窄列节奏，主要空间关系与参考一致。
- Colors and visual tokens: 按用户要求把粉色底板替换为 `#06251f` 和白色小点；白窗使用暖白、绿灰边框及克制阴影，正文和交互色继续映射项目的深绿/青绿体系，文字对比充足。
- Image quality and asset fidelity: 晴天 6 帧、雨天 5 帧均为用户原始 1134 × 1134 PNG；没有用 CSS 图形、临时 SVG、emoji 或近似插画替代。橘猫仍使用现有高质量 PNG。
- Copy and content: 品牌名、欢迎语、宁波镇海天气依据和“点击进入”均能脱离设计说明独立成立；天气不可用时明确显示“天气暂不可用”，不伪造预报。

### Findings and comparison history

1. 初始进入登录页捕获发现 P2：天气从左侧移除后，本地测试账号卡仍受旧的伸展网格影响，被拉到接近整屏高度，产生大块无意义空白。
2. 修复：为 `.erp-login-with-test-accounts .erp-login-intro` 设置垂直居中和 `auto auto` 行轨，并让账号卡按内容高度排列。
3. 后续同一 1440 × 900 捕获确认品牌、账号卡和右侧登录卡形成紧凑双栏；1280 × 720 首屏完整，1050px 上下布局无横向溢出。无剩余 P0/P1/P2。
4. 预报浏览器态因本地未配置高德 Key 显示明确降级；雨天画面由原始资源检查、分类测试和同一响应式容器覆盖，不伪造实时天气。

### Primary interactions and console

- 已测试：整页点击进入、按钮点击进入、按钮 Enter 进入、逐帧播放、响应式双栏/上下布局、localhost 测试账号入口、`/mobile` 无前置动画。
- 浏览器 console error/warning 数为 0。
- 没有剩余 P0/P1/P2 问题。

final result: passed

## 2026-08-30 物料成本表横向布局复核

- Source visual truth: `browser-comment://财务与成本/Comment-1-2`（用户标注的按钮越界与规格换行状态）
- Implementation screenshot: `design-audit/cost-table-after.png`
- Source viewport: 1117 × 837 CSS px（浏览器标注提供）
- Implementation viewport: 842 × 837 CSS px；截图按 CSS 尺寸归一化为 842 × 837 px；browser devicePixelRatio=2
- State: 财务角色 → 采购与成本 → 物料成本管理

### Full-view comparison evidence

源图中表格把整个桌面布局撑出右边界，“建立新价格版本”按钮被裁切；规格 `500mm / 20寸` 分成两行。最终实现中页面文档宽度与视口同为 842px，表格在卡片内部形成 568px 可视区和 1368px 内容区；左右固定列均在卡片边界内。

### Focused region comparison evidence

- 规格单元格：`white-space: nowrap`，`500mm / 20寸` 保持一行。
- 操作列：固定在右侧，最终坐标 left=628、right=823，处于 842px 视口内。
- 横向滚动：表格 body 为 `overflow-x: auto`，clientWidth=568、scrollWidth=1368；底部滚动条可见，滑块宽约236px。
- 卡片边界：left=254、right=824，没有页面级横向溢出；documentWidth=viewportWidth=842。

### Comparison history

1. 初始证据：P1 操作按钮越出卡片/视口；P2 规格和日期发生不必要换行。
2. 第一轮：增加列宽、单行文本、表格横向滚动和右侧固定操作列。检查发现旧的 `body min-width:1180px` 仍会让较窄窗口产生页面级溢出，因此结果保持 blocked。
3. 第二轮：移除页面最小宽度，并给主 Layout 设置 `min-width:0`。复查确认滚动被限制在表格内部，操作列完整，规格单行，页面无横向溢出。

### Required fidelity surfaces

- Fonts and typography: 保留现有 Noto Sans SC / PingFang SC 字体栈、字号和字重；表格文本统一单行，长来源字段继续省略显示。
- Spacing and layout rhythm: 卡片、标签页、表格行高与原系统保持不变；只改变宽表的溢出策略。
- Colors and tokens: 继续使用既有深绿、青绿色动作色和语义状态色，无新增视觉漂移。
- Image quality and assets: 本屏无业务图片资产；现有 Remix 图标与 Ant Design 控件未被替换。
- Copy and content: 物料、规格、价格和操作文案保持不变，没有为了适配宽度删减业务信息。

### Findings and interactions

- 没有剩余 P0、P1 或 P2 问题。
- 已测试侧边栏进入“采购与成本”、切换“物料成本管理”、表格内部横向滚动容器、左右固定列和单行规格。
- 已检查浏览器控制台；仅存在项目原有的 Ant Design deprecated 警告，与本次表格交互无关。
- P3：未来可为“首次发现来源”的省略内容增加悬停提示，不影响当前操作。

final result: passed

## Source truth

- UI reference: `/var/folders/pk/h06v193j56nbbfgvj0ypkrc00000gp/T/TemporaryItems/NSIRD_screencaptureui_MM8V9m/截屏2026-08-24 22.22.41.png`
- Secondary UI reference: `/var/folders/pk/h06v193j56nbbfgvj0ypkrc00000gp/T/codex-clipboard-7da67a6b-387c-48ff-902b-25814f991901.png`
- Business source: `/Users/cj25/Desktop/全屋定制家具ERP需求分析与实施蓝图_V3.0.pdf`
- Material-sheet source: `/var/folders/pk/h06v193j56nbbfgvj0ypkrc00000gp/T/codex-clipboard-1746c2e3-932c-416a-bcbe-436f98861cef.jpg`

- Procurement workflow source: `/Users/cj25/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_cw0srn05qmbs12_844f/temp/drag/产品采购流程(1).doc`
- Countertop workflow source: `/Users/cj25/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_cw0srn05qmbs12_844f/temp/drag/台面订单流程.doc`
- Financial-ledger source: `/Users/cj25/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_cw0srn05qmbs12_844f/temp/drag/26台帐07月.xls`
- Installation-application source: `/Users/cj25/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_cw0srn05qmbs12_844f/temp/drag/安装申请表(2)(1).xlsx`
- Formal workflow source: `/Users/cj25/Desktop/流程图(2).xls`
- Follow-up statistics source: `/Users/cj25/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_cw0srn05qmbs12_844f/temp/drag/2022年跟单统计表 (2)(1)(1)(1).xls`
- Department-progress UI reference: `/var/folders/pk/h06v193j56nbbfgvj0ypkrc00000gp/T/TemporaryItems/NSIRD_screencaptureui_5lVVuw/截屏2026-08-27 17.59.43.png`
- Status-only interaction-gap reference: `/var/folders/pk/h06v193j56nbbfgvj0ypkrc00000gp/T/TemporaryItems/NSIRD_screencaptureui_UfH263/截屏2026-08-27 19.53.19.png`

## Comparison artifacts

- Reference vs implementation: `qa-comparison.png`
- Order detail implementation: `qa-order-detail.png`
- Order list implementation: `qa-order-list.png`
- Comparison viewport: 1476 × 824 px
- Current reference comparison: `qa/current/reference-vs-prototype.png`
- Material readiness branch: `qa/current/material-readiness.png`
- Workshop permission state: `qa/current/worker-permissions.png`
- Finance ledger state: `qa/current/finance-ledger.png`
- Current side-by-side comparison: `qa/current/reference-vs-prototype-v2.png`
- Technical capacity schedule: `qa/current/capacity-schedule-v2.png`
- Mandatory installation application: `qa/current/installation-application-v2.png`
- Current workshop permission state: `qa/current/worker-permissions-v2.png`
- Chairman finance/margin state: `qa/current/chairman-finance-v2.png`
- Current browser viewport: 1280 × 720 CSS px; DPR 2.
- V3 before/after role-action comparison: `qa/current-v3/reference-vs-role-actions.png`
- V3 sales signature and designer assignment: `qa/current-v3/01-sales-order-assignment.png`
- V3 designer CAD submission: `qa/current-v3/02-designer-cad-submit.png`
- V3 order-admin front review: `qa/current-v3/03-order-admin-front-review.png`
- V3 production execution phase: `qa/current-v3/04-production-execution.png`
- V3 countertop finance approval: `qa/current-v3/05-countertop-finance-approval.png`
- State-linkage comparison: `qa/state-linkage/reference-vs-linked-final.png`
- Review → production linked state: `qa/state-linkage/01-review-to-production.png`
- Production/payment/application → shipment released: `qa/state-linkage/02-shipment-gate-released.png`

## Visual checks

| Check | Result | Notes |
|---|---|---|
| Dark-green sidebar hierarchy | Pass | Width, contrast, active state and dense vertical navigation follow the reference. |
| Teal action/status language | Pass | Primary actions, active tabs and progress use one semantic teal family. |
| Dense enterprise information layout | Pass | Compact header, saved views, toolbars, table rows and side panels preserve scanability. |
| Table treatment | Pass | Strong identifiers, secondary metadata, subtle borders and row hover match the reference pattern. |
| List/detail relationship | Pass | Order list keeps the reference density; detail page reuses the same shell and tokens. |
| Typography and spacing | Pass | Chinese system font fallback, restrained type scale, 8–16 px local spacing rhythm. |
| Status clarity | Pass | Progress never exceeds 100%; risks, state and financial gate are separate signals. |
| Responsive safety | Pass | Desktop is primary; compact sidebar and stacked detail layout activate below 800 px. |

## Functional checks

| Journey | Result |
|---|---|
| Order list → order detail | Pass |
| Search/filter/saved-view controls | Pass for prototype scope |
| New tracking order three-step flow | Pass |
| Role switch: finance navigation/tab appears only for 财务 and 董事长管理员 | Pass |
| Other roles cannot see margin entry points | Pass |
| HaiXun import: upload → validation → version confirmation | Pass |
| QR report: select workshop + exact process; start/complete/issue large actions | Pass |
| Production handoff success feedback | Pass |
| Payment confirmation and shipment-gate messaging | Pass |
| Exception registration and supplement-order intent | Pass |
| Material readiness: all-stock order skips procurement | Pass |
| Material readiness: shortage generates procurement task | Pass |
| Optional countertop external-purchase workflow | Pass |
| Workshop role: whole-order amount/contact/finance tab not rendered | Pass |
| Finance: payment plan, multi-receipt ledger and unapplied receipts | Pass |
| Browser console warnings/errors | Pass — none detected |
| Sales contract → deposit proof → designer assignment | Pass |
| Designer scope → four required drawing/attachment uploads → front review | Pass |
| Order-admin checklist → reject or approve and generate formal number | Pass |
| Countertop requirements → quote → finance approval → procurement issue | Pass |
| Technical review approval → production becomes current stage | Pass |
| Four workshops → every detailed process checked independently → aggregate production completion | Pass |
| Tail payment alone does not prematurely release shipment | Pass |
| Tail payment is the financial shipment gate; installation application remains informational and its piece total is read-only | Pass |
| Order state persists after browser reload | Pass — local prototype persistence verified |

## Current business-model verification

| Check | Result |
|---|---|
| Design SLA and reminder | Pass — 精装修 3 个工作日、毛坯 7 个工作日可切换并重算截止；D-1、到期前 2 小时、逾期升级规则可见。 |
| Technical capacity | Pass — 每名拆单员 ¥60,000/工作日；¥286,000 折算 5 个工作日；同一人多订单连续顺排、周末跳过且不重叠。 |
| Review gates | Pass — 订单管理员前置审单与独立拆单审核保持分离。 |
| Production workshops | Pass — 仅板式、木工（实木）、油漆、组装四车间；工序按《流程图(2).xls》逐项展开。 |
| Fulfillment readiness | Pass — 五金与外购移出生产进度，仅作为履约准备和缺口提醒，不阻塞送货。 |
| Open outsource model | Pass — 成品、铝框门/玻璃、艾格门板、台面及未来类别可配置。 |
| Installation application | Pass — 预计件数只读汇总五金包、自产品入库和外购入库；晚到外购可继续补充。 |
| Delivery gate | Pass — 尾款为财务门禁；安装申请不阻断发货，发货批次不再填写件数。 |
| Workshop isolation | Pass — 页面 DOM 不渲染整单金额与客户联系方式，财务入口不存在。 |
| Chairman access | Pass — 可见全部导航、合同金额、收款、成本与毛利。 |

## Accessibility and UX checks

- Icon-only controls have accessible labels and visible tooltips.
- Interactive elements have keyboard focus styles.
- Status is expressed with text in addition to color.
- Worker reporting uses three large, plain-language actions and an explicit workshop/process selector; it does not require navigating the full ERP.
- Financial isolation is implemented through navigation and page composition, not merely a visual blur.
- Sensitive fields are conditionally excluded from the rendered role view; workshop users do not receive the contract-total value in the page DOM.

## Issue history

- P2: initial JSX return block had a malformed prop closure; fixed before browser QA.
- P2: legacy labels `门板组` and `板材组` conflicted with the formal department model; corrected to `组装车间` and `板式车间`.
- P2: older wording merged the two review gates; corrected to `前置审单` and `拆单审核`.

## 2026-08-28 补单、技术改图、延期与编号切换复核

| Check | Result |
|---|---|
| Supplement entry | Pass — 订单头、关联补单卡、安装售后页均可发起。 |
| Parent relation | Pass — 自动生成 `正单-Bxx`，正单中展示关联、来源、费用类型和完整阶段链。 |
| Delay evidence | Pass — 已完成状态与独立的 `延期 1 天` 标识同时保留。 |
| Technical revision | Pass — 原图只读、生成 `Vx-Txx`、设计师确认前暂停拆单。 |
| Number identity | Pass — 设计下单前以跟单流水号为主；设计提交后生产编号成为主标识，流水号保留为副标识。 |
| Review rejection | Pass — 前置审单退回不撤销已生成的生产编号。 |
| Narrow modal usability | Pass — 弹窗宽度受视口约束、内容区滚动、底部操作区固定。 |
| Runtime | Pass — 补单、技术改图、安装延期和设计编号切换均在本地预览验证，控制台无错误。 |
- P0: order-detail scheduling screen only recorded states and did not let sales, designers or the order administrator perform their actual tasks; fixed with role-scoped action centers and complete step-by-step forms.
- P1: countertop external-purchase card showed a timeline but had no data-entry or approval interaction; fixed with requirement, supplier-quote and finance-approval steps.
- P1: production responsibility units looked like stages beside production; corrected to four production workshops only, while hardware and outsource became pre-shipment readiness gates.
- P2: the sales-order submit button inherited a higher-specificity white background; fixed and rechecked in a fresh browser session.
- P0: workflow actions previously closed modals with a toast but did not update the lifecycle component, order list, owner, next task or gates; replaced with one shared order workflow state and event-driven transitions.
- P1: production reporting was hard-coded to one whole-workshop completion; replaced with exact workshop/process selection and independent completion for every formal process.
- P1: installation application had previously been modeled as a shipment gate; corrected to an informational planning fact with a live, read-only package total. Product readiness remains evaluated by the appropriate manufactured or outsourced track.
- P0: time boundaries existed only as static labels; added configurable 3/7-workday design deadlines, pre-deadline reminders, completion stop rules and overdue escalation semantics.
- P0: technical capacity was modeled as a shared pool; corrected to each assignee's personal ¥60,000/day calendar with sequential non-overlapping order blocks.
- No open P0/P1/P2 visual or functional defects after final verification.

final result: passed

## 2026-09-09 奶油粉手帐主题复核

- Visual source: `/Users/cj25/Desktop/ui参考案例.JPG`，用于情绪、材质和插画方向，不逐像素复刻页面布局。
- Target direction: 奶油粉个人手帐、暖深绿导航、登录/工作台富表现、业务操作页克制。
- Primary review viewport: 1280 × 720 desktop；手机只读登录页单独复核。

| Surface | Check | Result |
| --- | --- | --- |
| Desktop login | 橘猫与登录卡形成完整构图；瞳孔随指针移动；localhost 测试账号入口保持可见 | Pass |
| Dashboard | 小屋不破坏内容层级；晴天/雨天切换可读；雨滴落到屋顶并沿屋面滑落 | Pass |
| Business pages | 奶油纸张与灰粉状态色进入订单、表单、弹窗和表格，但不在密集操作区增加装饰组件 | Pass |
| Mobile readonly | 同步浅色调；不渲染橘猫、天气场景与装饰动画 | Pass |
| Accessibility | 动效控件有文本标签；系统开启 reduced motion 时不运行眼神跟随和雨滴动画 | Pass |
| Build handoff | 客户端 TypeScript、全仓类型检查、生产构建与 Sites worker 测试通过 | Pass |

### Deliberate differences from the reference

- 参考图的大留白与编辑感主要落在登录页、工作台头图，ERP 表格和流程继续维持高信息密度。
- 深绿色侧栏继续承担定位与对比，用灰粉色选中态衔接新主题。
- AI 生成插画不包含功能文字、控件或业务数据；所有功能内容仍由可访问的 HTML 承载。

final result: passed

## 2026-10-16 客服 Demo 工作台

### Comparison target and evidence

- Source visual truth: `/Users/cj25/Desktop/1c913afc51b7c648162138c8b6ec078f.jpg`（1440 × 818，空会话）；执行轨迹参考 `/Users/cj25/Desktop/73270277074722a37cfaa3dd12a5719a.jpg`。
- Implementation: `http://127.0.0.1:5174/customer`。
- Browser screenshots: `test-results/customer-agent-empty-20261016.png` 和 `test-results/customer-agent-workbench-20261016.png`，均 1440 × 818 pixels / CSS viewport，按 1:1 尺寸比较。
- 空会话参考与空会话实现、真实调用实现放在同一次图像查看中比较。执行案例不同（参考为退货、实现为材料），只比较轨迹结构与可读性，不宣称文案逐字还原。
- Full view: 深色侧边栏、标题状态区、快速提问、会话、诊断四个主要区域保留；在 1440px 下中央会话占最大宽度，输入与发送操作可见。
- Focused review: 对照查看中央输入区和右侧诊断；事件类型、工具名、耗时、折叠参数、结果证据和校验状态都可读。导航采用项目已有 Remix Icon，替换初版符号图标。

### Fidelity surfaces and intentional adaptations

- 字体：沿用 ERP 中文系统无衬线字体，标题 27px、会话正文 14px；诊断正文 12–13px、辅助文字 11px。未复刻参考的衬线标题。
- 布局：保留三栏工作台与独立导航；输入框固定在会话卡片底部，消息与轨迹内部滚动。较窄桌面把快速入口移到上方；390px 实测页面宽度与 scrollWidth 均为 390px，没有页面横向溢出。
- 色彩：按现有产品约束使用 #06251f 深绿、青绿操作按钮、灰白页面与白色卡片，替换参考的米色背景。
- 图像：参考没有业务内容图片；不引入无关插画。品牌文字使用本产品名称，标准导航图标使用现有库。
- 文案：保留受控单 Agent，而非参考的多 Agent。所有模型、检索和校验状态来自实际运行；不展示虚构成功状态或模型隐藏推理。新增待审核知识与人工请求符合本次用户要求。

### Findings and comparison history

- 初版 P2：消息自动滚动会带动整页滚动，影响标题与导航的查看。已改为仅滚动消息容器；2026-10-16 两份截图中标题及输入区完整可见。
- 初版 P2：导航使用字符符号，跨字体显示不稳定。已替换 Remix Icon；最终截图中线性图标一致。
- 最终无待修复 P0/P1/P2。P3：辅助文字可按用户实际显示器继续微调对比度和字号。

### Verification

- 已操作：快速提问、订单查询、材料知识问答、同会话 SSE、展开轨迹、新建会话、知识筛选、运行状态与评测导航。
- 真实 DeepSeek 决策/工具/模型草稿/校验降级已通过浏览器观察，4298ms 为单例结果。
- 客户权限隔离、人工请求幂等和回复通过本地端到端测试。未执行完整线上验收或新一轮 LLM judge。
- 浏览器页面 error 日志为空；工具自身 Statsig 遥测网络报错不属于应用页面。
- Implementation checklist: 布局、状态真实性、核心交互、响应式和代码检查完成；未部署。

final result: passed
