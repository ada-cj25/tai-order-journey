import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("design acceptance enforces the 1–7 day boundary in the client form", () => {
  const source = readFileSync(new URL("../src/WorkflowActionModal.tsx", import.meta.url), "utf8");
  const field = source.match(/<Form\.Item name="designLeadDays"[\s\S]*?<\/Form\.Item>/)?.[0] ?? "";
  assert.match(field, /type:\s*"number"/);
  assert.match(field, /min:\s*1/);
  assert.match(field, /max:\s*7/);
  const input = field.match(/<InputNumber[\s\S]*?\/>/)?.[0] ?? "";
  assert.doesNotMatch(input, /\smin=\{/);
  assert.doesNotMatch(input, /\smax=\{/);
});

test("single-page pre-review exposes a draft action without enabling drafts for payment verification", () => {
  const source = readFileSync(new URL("../src/WorkflowActionModal.tsx", import.meta.url), "utf8");
  const preReview = source.slice(source.indexOf('case "APPROVE_PRE_REVIEW"'), source.indexOf('case "APPROVE_TECH_REVIEW"'));
  assert.match(preReview, /form\.setFieldValue\("checklist", PRE_REVIEW_ITEMS\)/);
  assert.match(preReview, />一键全部通过<\/Button>/);
  const footer = source.slice(source.indexOf('<div className="erp-modal-actions">'));
  const directFooter = footer.slice(0, footer.indexOf("</> :"));
  assert.match(directFooter, /command === "APPROVE_PRE_REVIEW" && <Button[^>]*onClick=\{saveDraft\}>保存当前进度/);
  assert.match(directFooter, /loading=\{savingDraft\} disabled=\{saving\}/);
  assert.match(directFooter, /loading=\{saving\} disabled=\{savingDraft\}/);
});

test("drafts use unvalidated form values and restore the saved payload on reopening", () => {
  const source = readFileSync(new URL("../src/WorkflowActionModal.tsx", import.meta.url), "utf8");
  const saveDraft = source.slice(source.indexOf("async function saveDraft()"), source.indexOf("async function submit()"));
  assert.match(saveDraft, /form\.getFieldsValue\(true\)/);
  assert.doesNotMatch(saveDraft, /validateFields|collectPreservedFormValues/);
  assert.match(saveDraft, /\/drafts/);
  assert.match(saveDraft, /onDraftSaved\?\.\(updated\)/);
  const restore = source.slice(source.indexOf("function restoreFormSubmission"), source.indexOf("const dateValue"));
  assert.match(restore, /submission\.command === action\.command && submission\.status === "DRAFT"/);
  assert.match(restore, /Object\.entries\(restored\)/);
  assert.match(restore, /form\.setFieldsValue\(restored\)/);
  assert.match(restore, /submission\.payload\.productionAreaId/);
  assert.match(restore, /selectTechnicalArea/);
});

test("new formal contracts collect deposit and prepayment before finance joint verification", () => {
  const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const createForm = appSource.slice(appSource.indexOf("function CreateOrderModal"), appSource.indexOf("function OrderPage"));
  assert.match(createForm, /name="depositAmount"/);
  assert.match(createForm, /name="prepaymentAmount"/);
  assert.match(createForm, /DEPOSIT_RECEIPT/);
  assert.match(createForm, /PREPAYMENT_RECEIPT/);
  assert.match(createForm, /REPORT_DEPOSIT/);
  assert.match(createForm, /REPORT_PREPAYMENT/);
  assert.match(createForm, /签订合同并报备两笔首付款/);

  const actionSource = readFileSync(new URL("../src/WorkflowActionModal.tsx", import.meta.url), "utf8");
  const jointReview = actionSource.slice(actionSource.indexOf('case "CONFIRM_INITIAL_PAYMENTS"'), actionSource.indexOf('case "ACCEPT_DESIGN"'));
  assert.match(jointReview, /name="depositVerified"/);
  assert.match(jointReview, /name="prepaymentVerified"/);
  assert.match(jointReview, /两笔都确认后订单才交予设计师/);
});

test("internal exceptional orders expose proposal-only creation and atomic commercial review", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /\["SALES", "DESIGNER", "TECHNICAL", "ORDER_ADMIN", "CHAIRMAN"\]/);
  assert.match(app, /非常规订单先记录业务资料与收费意向，不在建单时填写金额/);
  assert.match(app, /employee\.role === "DESIGNER" \? employee\.id/);
  assert.match(app, /exception-commercial-review/);
  assert.match(app, /免费单 · 无合同金额，付款与尾款不适用/);

  const controller = readFileSync(new URL("../server/orders.controller.ts", import.meta.url), "utf8");
  assert.match(controller, /exception-commercial-review/);
  const service = readFileSync(new URL("../server/orders.service.ts", import.meta.url), "utf8");
  assert.match(service, /非常规订单建单时不得提交合同金额/);
  assert.match(service, /chargeMode: "FREE", amount: null/);
  assert.match(service, /command: "REPORT_DEPOSIT"/);
});

test("desktop workflow exposes one shipment registration from materials onward", () => {
  const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const stages = appSource.slice(appSource.indexOf("const STAGES"), appSource.indexOf("const COMMANDS"));
  assert.match(stages, /\["PRODUCTION", "四车间生产"\][\s\S]*\["DELIVERY", "发货"\][\s\S]*\["INSTALLATION", "安装"\]/);
  assert.doesNotMatch(stages, /发货门禁/);
  const productionCommands = appSource.slice(appSource.indexOf("PRODUCTION: ["), appSource.indexOf("DELIVERY: ["));
  assert.match(productionCommands, /RECORD_DELIVERY[^\n]*登记发货/);
  const deliveryCommands = appSource.slice(appSource.indexOf("DELIVERY: ["), appSource.indexOf("INSTALLATION_APPLICATION: ["));
  assert.match(deliveryCommands, /RECORD_DELIVERY[^\n]*登记发货/);
  const materialsCommands = appSource.slice(appSource.indexOf("MATERIALS:"), appSource.indexOf("PRODUCTION: ["));
  assert.match(materialsCommands, /RECORD_DELIVERY[^\n]*登记发货/);
});

test("personal task page refreshes live design-intake projections while it remains open", () => {
  const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /const \[taskRefreshNonce, setTaskRefreshNonce\] = useState\(0\)/);
  assert.match(source, /page !== "tasks"[\s\S]*setInterval\(\(\) => setTaskRefreshNonce\(\(value\) => value \+ 1\), 30_000\)/);
  assert.match(source, /\[employee, page\]/);
  assert.match(source, /page, api\.call, taskRefreshNonce/);
  assert.match(source, />刷新待办<\/Button>/);
});

test("a completed technical area plan is autosaved and has no manual draft button", () => {
  const source = readFileSync(new URL("../src/WorkflowActionModal.tsx", import.meta.url), "utf8");
  assert.match(source, /onValuesChange=\{scheduleTechnicalAreaAutosave\}/);
  assert.match(source, /hasCompleteTechnicalAreaRequiredFields\(values\)/);
  assert.match(source, /setTechnicalAutosaveStatus\("saving"\)/);
  assert.match(source, /setTechnicalAutosaveStatus\("saved"\)/);
  assert.match(source, /已自动保存/);
  const footer = source.slice(source.indexOf('<div className="erp-modal-actions">'));
  assert.match(footer, /command !== "SUBMIT_TECHNICAL" && <Button[^>]*onClick=\{saveDraft\}>保存当前进度/);
});

test("order-area cards surface autosaved technical plans and a direct continuation action", () => {
  const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const areaCard = source.slice(source.indexOf('<Card title="生产区域总览"'), source.indexOf('<OutsourceRequirementEditor'));
  assert.match(areaCard, /projectTechnicalAreaPlan\(area, selected\.stageSubmissions\)/);
  assert.match(areaCard, /\{plan\.label\}/);
  assert.match(areaCard, /继续提交技术包/);
  assert.match(areaCard, /productionAreaId: area\.id/);
  assert.match(areaCard, /全部区域与外购声明已就绪/);
  assert.match(areaCard, /aria-label="生产区域横向滚动列表"/);
  assert.match(styles, /\.erp-production-area-grid \{ display:flex; flex-wrap:nowrap;[^}]*overflow-x:auto;/);
  assert.match(styles, /\.erp-production-area-card \{ flex:0 0 280px;/);
});

test("authenticated desktop surfaces keep the compact business-console density", () => {
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.erp-shell \{[^}]*font-size: 13px;/);
  assert.match(styles, /\.erp-shell \.ant-btn \{[^}]*height: 30px;[^}]*font-size: 12px;/);
  assert.match(styles, /\.erp-shell \.ant-table-tbody > tr > td \{ padding: 9px 12px; font-size: 12px;/);
  assert.match(styles, /\.erp-content \{ padding: 20px 24px 34px;/);
  assert.match(styles, /\.erp-order-hero \{ min-height: 104px; padding: 16px 20px;/);
  assert.match(styles, /\.erp-panel \{[^}]*\}\.erp-panel \.ant-card-head \{ min-height: 44px;/);
  assert.doesNotMatch(styles, /\.erp-login[^\n{]*\{[^}]*font-size: 13px/);
  assert.doesNotMatch(styles, /\.erp-mobile[^\n{]*\{[^}]*font-size: 13px/);
});

test("personal task table keeps business text on one line and scrolls inside its card", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const operations = readFileSync(new URL("../server/operations.controller.ts", import.meta.url), "utf8");
  const taskPageStart = app.indexOf(': page === "tasks" ? <div className="erp-module-page">');
  const taskPage = app.slice(taskPageStart, app.indexOf(': page === "procurement"', taskPageStart));
  assert.match(taskPage, /className="erp-task-table"/);
  assert.match(taskPage, /tableLayout="fixed"/);
  assert.match(taskPage, /scroll=\{\{ x:/);
  assert.match(taskPage, /title: "销售编号 \/ 客户", key: "order", width: 260/);
  assert.match(taskPage, /order\?\.customerName \?\? "客户待补充"/);
  assert.match(taskPage, /employee\.role === "WORKSHOP" \? \[\{ title: "生产区域 \/ 生产编号", key: "productionArea", width: 220/);
  assert.match(taskPage, /className="erp-task-production-area"/);
  assert.match(taskPage, /employee\.role === "WORKSHOP" \? \[\] : \[\{ title: "任务"/);
  assert.match(styles, /\.erp-task-production-area \{[^}]*white-space:nowrap;/);
  assert.match(operations, /productionRoutes: \{ where: \{ cancelledAt: null \}, select: \{ id: true, productionProcesses:/);
  assert.match(operations, /const scopedPersistedTasks = tasks\.flatMap/);
  assert.match(operations, /productionRouteId: routeScope\?\.route\.id \?\? null/);
  assert.match(app, /openOrder\(String\(order\.id\), focus\)/);
  assert.match(app, /visibleTechnicalRoutes\.map/);
  assert.match(taskPage, /ellipsis: \{ showTitle: true \}/);
  assert.match(styles, /\.erp-task-table \.ant-table-cell \{ white-space:nowrap; \}/);
  assert.match(styles, /\.erp-task-table \.ant-table-content \{[^}]*overflow-x:scroll !important;/);
  assert.match(styles, /\.erp-task-business-link \{[^}]*white-space:nowrap;/);
});

test("task deep-link focuses the area and route without hiding sibling workshops on that route", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const productionExecution = app.slice(app.indexOf("function ProductionExecution"), app.indexOf("function useApi"));
  assert.match(app, /visibleTechnicalRoutes\.map/);
  assert.doesNotMatch(productionExecution, /WORKSHOP_ORDER\.filter\(\(workshop\) => !focusedWorkshop \|\| workshop === focusedWorkshop\)/);
  assert.doesNotMatch(app, /focusedWorkshop=\{selectedProductionTaskFocus\?\.workshop\}/);
});

test("each technical area advances independently before the whole order is locked", () => {
  const modal = readFileSync(new URL("../src/WorkflowActionModal.tsx", import.meta.url), "utf8");
  const advance = modal.slice(modal.indexOf("async function validateAndNext()"), modal.indexOf("function serializeValues"));
  assert.doesNotMatch(advance, /incompleteAreas|请先完成以下生产区域/);

  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const areaOverview = app.slice(app.indexOf('<Card title="生产区域总览"'), app.indexOf("<OutsourceRequirementEditor"));
  assert.match(areaOverview, /提交并锁定所有区域/);
  assert.match(app, /outsourceRequirement\?\.status === "DRAFT"/);
  const server = readFileSync(new URL("../server/orders.service.ts", import.meta.url), "utf8");
  assert.match(server, /分区域提交技术包；全部完成后提交并锁定所有区域/);
});

test("one or many ready technical areas can be submitted together", () => {
  const modal = readFileSync(new URL("../src/WorkflowActionModal.tsx", import.meta.url), "utf8");
  assert.match(modal, /保存本区域，稍后批量提交/);
  assert.match(modal, /一次提交所选区域/);
  assert.match(modal, /technical-packages\/bulk-submit/);
  assert.match(modal, /selectedTechnicalDraftAreaIds/);
  assert.match(modal, /technicalAreaSubmissionGaps/);
  assert.match(modal, /计划已完成 · 待补资料/);
  assert.match(modal, /待补：/);
  assert.match(modal, /仅提交当前区域/);

  const controller = readFileSync(new URL("../server/orders.controller.ts", import.meta.url), "utf8");
  assert.match(controller, /technical-packages\/bulk-submit/);
  const server = readFileSync(new URL("../server/orders.service.ts", import.meta.url), "utf8");
  const handler = server.slice(server.indexOf("async submitTechnicalDrafts"), server.indexOf("async completeInstallationBatch"));
  assert.match(handler, /runMutation/);
  assert.match(handler, /for \(let index = 0; index < selectedIds\.length/);
  assert.match(handler, /validateEvidence\("SUBMIT_TECHNICAL", payload\)/);
});

test("technical review no longer collects first-batch installation fees", () => {
  const modal = readFileSync(new URL("../src/WorkflowActionModal.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(modal, /各区域首批安装费用/);
  assert.match(modal, /本车次区域安装费/);
  assert.doesNotMatch(modal, /发货日期由系统自动记录为今天/);
  assert.match(modal, /className="span-2" name="vehicle" label="车辆\/司机"/);
});

test("technical submission accepts multiple HaiXun and decomposition files", () => {
  const modal = readFileSync(new URL("../src/WorkflowActionModal.tsx", import.meta.url), "utf8");
  const definitions = modal.slice(modal.indexOf("SUBMIT_TECHNICAL: ["), modal.indexOf("REPORT_TAIL_PAYMENT:"));
  assert.match(definitions, /haixunAttachmentIds[^\n]*multiple: true/);
  assert.match(definitions, /decompositionAttachmentIds[^\n]*multiple: true/);
  assert.match(definitions, /haixunAttachmentIds[^\n]*multiple: true[^\n]*required: false/);
  assert.match(definitions, /decompositionAttachmentIds[^\n]*multiple: true[^\n]*required: false/);
  assert.match(modal, /<Upload multiple/);
  assert.match(modal, /可上传多个/);
  assert.match(modal, /均为可选资料/);
  assert.match(modal, /整单共用文件/);
  assert.match(modal, /只需上传一次/);
  assert.match(modal, /整单资料与逐项核对/);
  assert.doesNotMatch(modal, /body\.append\("productionAreaId"/);

  const packageService = readFileSync(new URL("../server/material-package.service.ts", import.meta.url), "utf8");
  assert.match(packageService, /supportingAttachmentIds/);
  assert.match(packageService, /workbookAttachmentIds/);
  assert.match(packageService, /workbookAttachmentIds\.includes\(attachment\.id\)/);
  assert.doesNotMatch(packageService, /技术资料必须全部属于当前生产区域/);

  const schema = readFileSync(new URL("../server/prisma/schema.prisma", import.meta.url), "utf8");
  assert.match(schema, /haixunAttachmentId\s+String\?/);
  assert.match(schema, /decompositionAttachmentId\s+String\?/);
  assert.match(packageService, /haixunAttachmentId: haixunAttachmentIds\[0\] \?\? null/);
  assert.match(packageService, /decompositionAttachmentId: decompositionAttachmentIds\[0\] \?\? null/);
});

test("技术生产计划将两条路线的面积完整分区", () => {
  const modal = readFileSync(new URL("../src/WorkflowActionModal.tsx", import.meta.url), "utf8");
  const technical = modal.slice(modal.indexOf('case "SUBMIT_TECHNICAL"'), modal.indexOf('case "START_PRODUCTION"'));
  const panel = technical.slice(technical.indexOf('erp-panel-route-plan'), technical.indexOf('erp-wood-paint-route-plan'));
  const woodPaint = technical.slice(technical.indexOf('erp-wood-paint-route-plan'));
  assert.match(panel, /panelEnabled/);
  assert.match(panel, /panelQty/);
  assert.match(panel, /panelAssemblyQty/);
  assert.doesNotMatch(panel, /woodQty|paintQty|woodPaintAssemblyQty/);
  assert.match(woodPaint, /woodPaintEnabled/);
  assert.match(woodPaint, /veneerRequired/);
  assert.match(woodPaint, /woodQty/);
  assert.match(woodPaint, /paintQty/);
  assert.match(woodPaint, /woodPaintAssemblyQty/);
});

test("pending payment-account approvals are projected into personal tasks and open the review dialog", () => {
  const server = readFileSync(new URL("../server/operations.controller.ts", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(server, /projectPendingPaymentAccountTasks/);
  assert.match(server, /paymentAccount\.findMany\(\{\s*where:\s*\{ status: "PENDING" \}/s);
  assert.match(app, /row\.action === "REVIEW_PAYMENT_ACCOUNT"/);
  assert.match(app, /setPaymentAccountOpen\(true\)/);
  assert.match(app, /非订单事项/);
  assert.match(app, /await loadPaymentAccounts\(\);\s*setTaskRefreshNonce/s);
});

test("installation-batch issue conclusion is optional in both the form and submission handler", () => {
  const modal = readFileSync(new URL("../src/WorkflowActionModal.tsx", import.meta.url), "utf8");
  const form = modal.slice(modal.indexOf('case "COMPLETE_INSTALLATION_BATCH"'), modal.indexOf('case "ACCEPT_CUSTOMER"'));
  assert.match(form, /name="issueConclusion" label="遗留问题\/处理结论（选填）"/);
  assert.doesNotMatch(form, /name="issueConclusion"[^>]*rules=/);

  const server = readFileSync(new URL("../server/orders.service.ts", import.meta.url), "utf8");
  const handler = server.slice(server.indexOf("async completeInstallationBatch"), server.indexOf("async saveDraft"));
  assert.doesNotMatch(handler, /!issueConclusion/);
  assert.match(handler, /issueConclusion: issueConclusion \|\| null/);
  assert.match(handler, /!installer \|\| !photoAttachmentIds\.length/);
});

test("aftersales registration requires the initial cost and exposes no cost action to other roles", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const form = app.slice(app.indexOf('<Modal title="登记售后问题"'), app.indexOf('<Modal title={`新增售后费用'));
  assert.match(form, /name="incurredOn" label="本次费用发生日期"/);
  assert.match(form, /name="amount" label="本次售后费用"/);
  assert.match(form, /登记问题并计入成本/);
  assert.match(app, /selected\.stage === "BUSINESS_COMPLETE" && employee\.costModuleEnabled && \["CHAIRMAN", "AFTERSALES"\]\.includes\(employee\.role\)/);

  const service = readFileSync(new URL("../server/aftersales.service.ts", import.meta.url), "utf8");
  const create = service.slice(service.indexOf("async create("), service.indexOf("async addCostBatch("));
  assert.match(create, /afterSalesCase\.create/);
  assert.match(create, /afterSalesCostBatch\.create/);
  assert.match(create, /AFTERSALES_COST_ADDED/);
});

test("business cards omit redundant ERP explanatory alerts", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(app, /发货登记自动引用本合计/);
  assert.doesNotMatch(app, /板式完成，或木工与油漆完成后即可开放组装/);
  assert.doesNotMatch(app, /物料版用于采购登记与成本核算/);
  const materialSummary = app.slice(app.indexOf("区域物料发布汇总"), app.indexOf('id="order-material-cost"'));
  assert.doesNotMatch(materialSummary, /title: "来源位置"/);
});

test("procurement confirmation is scoped to each production area with an explicit bulk action", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("../src/ProcurementWorkspace.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const service = readFileSync(new URL("../server/material-cost.service.ts", import.meta.url), "utf8");
  assert.match(app, /按生产区域确认采购/);
  assert.match(app, /selectedProcurementAreas\.map/);
  assert.match(app, /className="erp-procurement-area-scroll"/);
  assert.match(app, /setProcurementAreaId\(area\.id\)/);
  assert.match(app, /确认\{label\}采购完成/);
  assert.match(app, /一键确认全部/);
  assert.match(app, /productionAreaId: area\.id/);
  assert.match(styles, /\.erp-procurement-area-scroll \{[^}]*display:flex;[^}]*flex-wrap:nowrap;[^}]*overflow-x:auto;/);
  assert.match(styles, /\.erp-procurement-area-card \{[^}]*flex:0 0 300px;/);
  assert.match(workspace, /确认该区域采购完成/);
  assert.match(workspace, /一键确认全部/);
  assert.match(service, /requestedAreaId/);
  assert.match(service, /matchingRoutes\.filter\(\(route\) => !route\.releasedAt\)/);
  assert.match(service, /gate\.routes\.every\(\(route\) => Boolean\(route\.releasedAt\) \|\| releasedRouteIds\.includes\(route\.id\)\)/);
});

test("procurement order detail omits workshop process execution cards", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const routeExecution = app.slice(app.indexOf('className="erp-route-execution-list"') - 120, app.indexOf('className="erp-route-execution-list"') + 1800);
  assert.match(routeExecution, /!\["FINANCE", "PROCUREMENT"\]\.includes\(employee\.role\)/);
  assert.match(routeExecution, /<ProductionExecution/);
});

test("procurement confirmation sits immediately below the control panel for procurement users", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const gridStart = app.indexOf('<div className="erp-detail-grid">');
  const controlPanel = app.indexOf('<Card title="当前控制面"', gridStart);
  const procurementAfterControl = app.indexOf('employee.role === "PROCUREMENT" && procurementConfirmationCard', controlPanel);
  const productionOverview = app.indexOf('<Card title="生产区域总览"', controlPanel);
  const otherRoles = app.indexOf('employee.role !== "PROCUREMENT" && procurementConfirmationCard', controlPanel);
  assert.ok(gridStart >= 0);
  assert.ok(controlPanel > gridStart);
  assert.ok(procurementAfterControl > controlPanel && procurementAfterControl < productionOverview);
  assert.ok(otherRoles > controlPanel);
});
