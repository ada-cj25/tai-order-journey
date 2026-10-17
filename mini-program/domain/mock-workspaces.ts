import { getMockDesignState, getMockPackageSummary, getMockPaymentState, getMockPreReviewState, getMockTechnicalState, getOrders, getStoredSession, mockTailPaymentReady } from "./store";
import { getMockOutsourceLines } from "./mock-outsource";
import { mockShipmentQueueItem } from "./mock-shipment";
import { getMockShipmentState } from "./mock-shipment-state";
import { getMockAfterSalesCases } from "./mock-aftersales";
import type { MiniNotification, MiniRole, MiniWorkspace, MiniWorkspaceTask, TaskUrgency } from "./types";

const now = "2026-09-13T18:40:00+08:00";

function task(input: Partial<MiniWorkspaceTask> & Pick<MiniWorkspaceTask, "id" | "type" | "title" | "customerName">): MiniWorkspaceTask {
  const urgency = input.urgency ?? "NORMAL";
  const labels: Record<TaskUrgency, string> = { OVERDUE: "已逾期", RUSH: "加急", DUE_SOON: "24小时内", NORMAL: "按计划" };
  return {
    orderId: input.orderId ?? "TEST-DEMO-ZHOU-ORDER-001",
    trackingSerial: input.trackingSerial ?? "TEST-DEMO-ZHOU-ORDER-001",
    salesNumber: input.salesNumber ?? "TEST-SALES-ZHOU-001",
    description: input.description ?? "请核对订单信息后办理",
    status: input.status ?? "PENDING",
    urgency,
    urgencyLabel: input.urgencyLabel ?? labels[urgency],
    dueAt: input.dueAt ?? "2026-09-16T17:00:00+08:00",
    dueLabel: input.dueLabel ?? "09月16日前",
    actionCode: input.actionCode ?? null,
    actionLabel: input.actionLabel ?? null,
    actionRoute: input.actionRoute ?? null,
    expectedUpdatedAt: input.expectedUpdatedAt ?? now,
    desktopOnly: input.desktopOnly ?? false,
    presentation: input.presentation ?? (input.desktopOnly ? "DESKTOP_HANDOFF" : input.actionCode ? "NATIVE" : "READ_ONLY"),
    desktopHandoff: input.desktopHandoff,
    meta: input.meta,
    id: input.id,
    type: input.type,
    title: input.title,
    customerName: input.customerName,
  };
}

const tasks: Record<Exclude<MiniRole, "WORKSHOP">, MiniWorkspaceTask[]> = {
  CHAIRMAN: [
    task({ id: "chair-approval-1", type: "CHAIRMAN_APPROVAL", title: "审批新增收款账户", customerName: "非订单事项", salesNumber: null, trackingSerial: "PAYMENT-ACCOUNT-001", description: "财务申请：招商银行上海基本户", actionCode: "REVIEW_PAYMENT_ACCOUNT", actionLabel: "去审批", actionRoute: "/pages/role-center/index?section=risk", meta: { accountId: "mock-account-1" } }),
    task({ id: "chair-risk-1", type: "DESKTOP_REVIEW", title: "订单风险待关注", customerName: "林先生", description: "生产节点已逾期，请查看责任人与处理路径", urgency: "OVERDUE", actionLabel: "查看订单", actionRoute: "/pages/order-detail/index?id=TEST-DEMO-LIN-ORDER-002", presentation: "READ_ONLY" }),
  ],
  SALES: [
    task({ id: "sales-payment-1", type: "INITIAL_PAYMENT", title: "补充预付款凭证", customerName: "周女士", description: "定金已报备，还需上传预付款凭证", urgency: "DUE_SOON", actionCode: "REPORT_PREPAYMENT", actionLabel: "去补充", actionRoute: "/pages/sales-create/index", meta: { salesOwnerId: "TEST-SALES-NORLI-01", businessUnit: "NOERLI" } }),
    task({ id: "sales-designer-1", type: "DESIGN_REASSIGN", title: "重新分配设计师", customerName: "林先生", salesNumber: null, trackingSerial: "GD-260913-006", description: "设计已退回，请重新指定设计师", urgency: "OVERDUE", dueLabel: "已逾期 1 天", actionCode: "ASSIGN_DESIGNER", actionLabel: "立即处理", actionRoute: "/pages/order-detail/index?id=TEST-DEMO-LIN-ORDER-002", meta: { salesOwnerId: "TEST-SALES-NORLI-02", businessUnit: "NOERLI" } }),
    task({ id: "sales-tail-1", type: "TAIL_PAYMENT", title: "报备尾款收款", customerName: "方女士", salesNumber: "N26090018", trackingSerial: "TEST-DEMO-MINI-001", description: "首条生产路线已完工，发货前需报备尾款", urgency: "RUSH", actionCode: "REPORT_TAIL_PAYMENT", actionLabel: "报备尾款", actionRoute: "/pages/order-detail/index?id=TEST-DEMO-MINI-001", meta: { salesOwnerId: "TEST-SALES-NORLI-01", businessUnit: "NOERLI" } }),
  ],
  ORDER_ADMIN: [
    task({ id: "admin-shipment-1", type: "SHIPMENT", title: "登记发货车次", customerName: "周女士", description: "儿童房·板式路线已完工，尾款已确认", urgency: "DUE_SOON", actionCode: "RECORD_DELIVERY", actionLabel: "登记发货", actionRoute: "/pages/shipment/index?orderId=TEST-DEMO-ZHOU-ORDER-001" }),
    task({ id: "admin-review-1", type: "DESKTOP_REVIEW", title: "技术审单", customerName: "方女士", description: "包含材料表和宽表格，请在电脑端办理", urgency: "OVERDUE", dueLabel: "已逾期 1 天", actionCode: null, actionLabel: "电脑端办理", actionRoute: null, desktopOnly: true }),
  ],
  FINANCE: [],
  DESIGNER: [
    task({ id: "design-intake-1", type: "DESIGN_INTAKE", title: "接受设计任务", customerName: "赵女士", salesNumber: "A26090001", trackingSerial: "TEST-AIKEJU-GD-001", description: "首付款已确认，请承诺1—7个工作日", actionCode: "ACCEPT_DESIGN", actionLabel: "接受任务", actionRoute: "/pages/role-action/index?orderId=TEST-DEMO-AIKEJU-001&command=ACCEPT_DESIGN" }),
  ],
  TECHNICAL: [
    task({ id: "technical-1", type: "TECHNICAL_DESKTOP", title: "儿童房技术拆单", customerName: "周女士", description: "3个生产区域待拆分，需上传海迅与物料Excel", urgency: "DUE_SOON", actionLabel: "电脑端办理", desktopOnly: true, presentation: "DESKTOP_HANDOFF", desktopHandoff: { reason: "该任务需要海迅、分解单和物料Excel解析", moduleLabel: "订单详情 · 技术拆单", identifier: "TEST-SALES-ZHOU-001" } }),
  ],
  PROCUREMENT: [
    task({ id: "procurement-route-1", type: "PROCUREMENT_ROUTE", title: "确认板式路线采购完成", customerName: "周女士", description: "涉及儿童房、衣帽间2个生产区域", urgency: "DUE_SOON", actionCode: "COMPLETE_PROCUREMENT_ROUTE", actionLabel: "处理采购", actionRoute: "/pages/role-center/index?section=procurement&orderId=TEST-DEMO-ZHOU-ORDER-001" }),
    task({ id: "procurement-package-1", type: "PROCUREMENT_PACKAGE", title: "确认区域五金包数量", customerName: "林先生", description: "3个生产区域等待最终数量", actionCode: "FINALIZE_HARDWARE_PACKAGES", actionLabel: "填写数量", actionRoute: "/pages/role-center/index?section=procurement&orderId=TEST-DEMO-LIN-ORDER-002" }),
  ],
  INSTALLER: [],
  AFTERSALES: [],
};

function stats(role: Exclude<MiniRole, "WORKSHOP">, roleTasks: MiniWorkspaceTask[]) {
  if (role === "CHAIRMAN") return [{ key: "orders", value: getOrders().length, label: "全部订单", tone: "active" as const }, { key: "approval", value: 1, label: "待审批" }, { key: "risk", value: 1, label: "风险/临期", tone: "warning" as const }, { key: "desktop", value: 0, label: "电脑端办" }];
  if (role === "SALES") return [{ key: "payment", value: roleTasks.filter((item) => item.type === "INITIAL_PAYMENT").length, label: "待补付款" }, { key: "designer", value: roleTasks.filter((item) => item.type === "DESIGN_REASSIGN").length, label: "设计待分配", tone: "active" as const }, { key: "tail", value: roleTasks.filter((item) => item.type === "TAIL_PAYMENT").length, label: "尾款待报" }, { key: "urgent", value: roleTasks.filter((item) => item.urgency !== "NORMAL").length, label: "临期/加急", tone: "warning" as const }];
  if (role === "ORDER_ADMIN") return [{ key: "mine", value: roleTasks.length, label: "我的待办" }, { key: "shipment", value: roleTasks.filter((item) => item.type === "SHIPMENT").length, label: "可发货", tone: "active" as const }, { key: "arrival", value: roleTasks.filter((item) => item.type === "OUTSOURCE_ARRIVAL").length, label: "待到货" }, { key: "desktop", value: roleTasks.filter((item) => item.type === "DESKTOP_REVIEW").length, label: "电脑端办", tone: "warning" as const }];
  if (role === "FINANCE") return [{ key: "payment", value: roleTasks.length, label: "待核验", tone: "active" as const }, { key: "urgent", value: roleTasks.filter((item) => item.urgency !== "NORMAL").length, label: "临期/逾期", tone: "warning" as const }, { key: "orders", value: getMockRoleOrders().length, label: "可见订单" }, { key: "desktop", value: 0, label: "电脑端办" }];
  if (role === "DESIGNER") return [{ key: "intake", value: roleTasks.filter((item) => item.type === "DESIGN_INTAKE").length, label: "待接单", tone: "active" as const }, { key: "delivery", value: roleTasks.filter((item) => item.type === "DESIGN_SUBMISSION").length, label: "待交付" }, { key: "urgent", value: roleTasks.filter((item) => item.urgency !== "NORMAL").length, label: "临期/逾期", tone: "warning" as const }, { key: "orders", value: getMockRoleOrders().length, label: "本人订单" }];
  if (role === "TECHNICAL") return [{ key: "queue", value: roleTasks.length, label: "拆单队列", tone: "active" as const }, { key: "urgent", value: 1, label: "临期/逾期", tone: "warning" as const }, { key: "orders", value: getOrders().length, label: "可见订单" }, { key: "desktop", value: roleTasks.length, label: "电脑端办" }];
  if (role === "PROCUREMENT") return [{ key: "route", value: roleTasks.filter((item) => item.type === "PROCUREMENT_ROUTE").length, label: "路线待确认", tone: "active" as const }, { key: "package", value: roleTasks.filter((item) => item.type === "PROCUREMENT_PACKAGE").length, label: "五金包" }, { key: "urgent", value: roleTasks.filter((item) => item.urgency !== "NORMAL").length, label: "临期/逾期", tone: "warning" as const }, { key: "orders", value: getOrders().length, label: "可见订单" }];
  if (role === "INSTALLER") return [{ key: "today", value: roleTasks.filter((item) => item.type === "INSTALLATION").length, label: "待安装车次", tone: "active" as const }, { key: "overdue", value: roleTasks.filter((item) => item.urgency === "OVERDUE").length, label: "已逾期" }, { key: "active", value: roleTasks.length, label: "我的待办" }, { key: "acceptance", value: roleTasks.filter((item) => item.type === "CUSTOMER_ACCEPTANCE").length, label: "待验收" }];
  return [{ key: "new", value: roleTasks.filter((item) => item.status === "OPEN").length, label: "新问题", tone: "warning" as const }, { key: "active", value: roleTasks.filter((item) => item.status === "IN_PROGRESS").length, label: "处理中", tone: "active" as const }, { key: "orders", value: getMockRoleOrders().filter((item) => item.stageLabel === "验收完成").length, label: "可登记订单" }, { key: "done", value: getMockAfterSalesCases().filter((item) => item.status === "RESOLVED").length, label: "已解决" }];
}

export function getMockWorkspace(): MiniWorkspace {
  const employee = getStoredSession();
  if (!employee || employee.role === "WORKSHOP") throw new Error("当前账号不使用通用工作台");
  const createdTasks = getOrders().filter((order) => order.trackingSerial.startsWith("TEST-DEMO-GD-")).flatMap((order) => {
    const payment = getMockPaymentState(order.id);
    const technical = getMockTechnicalState(order.id);
    const base = { orderId: order.id, trackingSerial: order.trackingSerial, salesNumber: order.salesNumber,
      customerName: order.customerName, status: "PENDING", urgency: order.rush ? "RUSH" as const : "NORMAL" as const,
      dueAt: payment?.designDueAt ?? null, dueLabel: payment?.designDueAt ? `${payment.designDueAt.slice(5, 7)}月${payment.designDueAt.slice(8, 10)}日前` : "本机演示", expectedUpdatedAt: order.updatedAt };
    if (employee.role === "SALES" && order.salesOwnerId === employee.id && !payment && order.businessType?.endsWith("_SUPPLEMENT")) return [task({ ...base,
      id: `sales-supplement:${order.id}`, type: "SALES_CREATE", title: "核对新建补单",
      description: "补单商务和收款事实仍需按正式流程补全。", actionCode: null, actionLabel: "查看补单", actionRoute: `/pages/order-detail/index?id=${order.id}` })];
    if (employee.role === "SALES" && order.salesOwnerId === employee.id && !payment) return [task({ ...base,
      id: `sales-payment:${order.id}`, type: "INITIAL_PAYMENT", title: "补报定金与预付款",
      description: "这份本机订单缺少可核验的付款事实，请重新选择两张凭证并报备。",
      actionCode: "REPORT_INITIAL_PAYMENT", actionLabel: "去报备", actionRoute: `/pages/sales-create/index?orderId=${order.id}` })];
    if (employee.role === "FINANCE" && payment?.status === "AWAITING_FINANCE") return [task({ ...base,
      id: `finance-initial:${order.id}`, type: "FINANCE_PAYMENT", title: "核验定金与预付款",
      description: "销售已报备两笔首付款及凭证，请核对实际到账。",
      actionCode: "CONFIRM_INITIAL_PAYMENTS", actionLabel: "去核验", actionRoute: `/pages/role-action/index?orderId=${order.id}&command=CONFIRM_INITIAL_PAYMENTS` })];
    if (mockTailPaymentReady(order) && payment && !payment.tailConfirmedAt) {
      if (employee.role === "SALES" && order.salesOwnerId === employee.id && !payment.tail) return [task({ ...base,
        id: `sales-tail:${order.id}`, type: "TAIL_PAYMENT", title: "报备尾款收款",
        description: "已有生产区域完工；请报备尾款金额、到账日期、收款账户和凭证，财务核验后才能发货。",
        actionCode: "REPORT_TAIL_PAYMENT", actionLabel: "报备尾款", actionRoute: `/pages/tail-payment/index?orderId=${encodeURIComponent(order.id)}` })];
      if (employee.role === "FINANCE" && payment.tail) return [task({ ...base,
        id: `finance-tail:${order.id}`, type: "FINANCE_PAYMENT", title: "核验尾款到账",
        description: "销售已报备尾款与凭证；请对照实际收款账户核验，核验前发货保持锁定。",
        actionCode: "CONFIRM_TAIL_PAYMENT", actionLabel: "去核验", actionRoute: `/pages/role-action/index?orderId=${encodeURIComponent(order.id)}&command=CONFIRM_TAIL_PAYMENT` })];
    }
    if (employee.role === "DESIGNER" && order.designerOwnerId === employee.id && payment?.status === "AWAITING_DESIGN") return [task({ ...base,
      id: `design-intake:${order.id}`, type: "DESIGN_INTAKE", title: "接受设计任务",
      description: "财务已核验首付款，请确认合同范围和设计承诺时限。",
      actionCode: "ACCEPT_DESIGN", actionLabel: "接受任务", actionRoute: `/pages/role-action/index?orderId=${order.id}&command=ACCEPT_DESIGN` })];
    if (employee.role === "DESIGNER" && order.designerOwnerId === employee.id && payment?.status === "DESIGN_ACCEPTED") return [task({ ...base,
      id: `design-submit:${order.id}`, type: "DESIGN_SUBMISSION", title: "正式提交设计资料",
      description: "填写设计版本并上传CAD和客户确认资料；本机演示数据只保存在手机。", actionCode: "SUBMIT_DESIGN",
      actionLabel: "填写并提交", actionRoute: `/pages/design-submit/index?orderId=${order.id}`, presentation: "NATIVE" })].filter(() => !getMockDesignState(order.id)?.submitted);
    if (employee.role === "ORDER_ADMIN" && getMockDesignState(order.id)?.submitted && !getMockPreReviewState(order.id)) return [task({ ...base,
      id: `admin-pre-review:${order.id}`, type: "DESKTOP_REVIEW", title: "前置审单",
      description: "设计资料已提交。可在订单详情模拟通过，以测试技术岗位接单；正式审单仍须在电脑端完成。", actionCode: null,
      actionLabel: "查看订单", actionRoute: `/pages/order-detail/index?id=${order.id}`, presentation: "READ_ONLY" })];
    if (employee.role === "TECHNICAL" && getMockPreReviewState(order.id) && !technical) return [task({ ...base,
      id: `technical-desktop:${order.id}`, type: "TECHNICAL_DESKTOP", title: "技术拆单",
      description: "正式拆单在电脑端办理；本机可按三区域测试案例模拟生成生产区域。",
      actionCode: null, actionLabel: "查看测试入口", actionRoute: `/pages/order-detail/index?id=${order.id}`, presentation: "READ_ONLY" })];
    if (employee.role === "ORDER_ADMIN" && technical?.phase === "TECH_REVIEW") return [task({ ...base,
      id: `admin-technical-review:${order.id}`, type: "DESKTOP_REVIEW", title: "技术审单",
      description: "模拟技术拆单已提交；本机可模拟技术审单通过，再由采购放行路线。",
      actionCode: null, actionLabel: "查看测试入口", actionRoute: `/pages/order-detail/index?id=${order.id}`, presentation: "READ_ONLY" })];
    if (employee.role === "PROCUREMENT" && technical && ["PROCUREMENT", "PRODUCTION"].includes(technical.phase)) {
      const procurementTasks: MiniWorkspaceTask[] = [];
      if (!technical.panelReleasedAt || !technical.woodPaintReleasedAt) procurementTasks.push(task({ ...base,
        id: `procurement-routes:${order.id}`, type: "PROCUREMENT_ROUTE", title: "放行生产路线",
        description: "按生产区域确认板式与实木油漆路线；放行后对应车间即可报工。",
        actionCode: null, actionLabel: "查看测试入口", actionRoute: `/pages/order-detail/index?id=${order.id}`, presentation: "READ_ONLY" }));
      const pendingHardware = getMockPackageSummary(order.id).sources.filter((source) => source.kind === "HARDWARE_AREA" && source.status !== "FINALIZED").length;
      if (pendingHardware) procurementTasks.push(task({ ...base,
        id: `procurement-hardware:${order.id}`, type: "PROCUREMENT_PACKAGE", title: "确认区域五金包数量",
        description: `${pendingHardware}个生产区域等待最终数量`, actionCode: "FINALIZE_HARDWARE_PACKAGES", actionLabel: "填写数量",
        actionRoute: `/pages/role-center/index?section=procurement&orderId=${order.id}`, presentation: "NATIVE" }));
      return procurementTasks;
    }
    if (employee.role === "ORDER_ADMIN" && technical?.phase === "PRODUCTION" && ((mockShipmentQueueItem(order)?.readyRoutes ?? 0) + (mockShipmentQueueItem(order)?.readyOutsource ?? 0)) > 0) return [task({ ...base,
      id: `admin-production-done:${order.id}`, type: payment?.tailConfirmedAt ? "SHIPMENT" : "TAIL_PAYMENT", title: payment?.tailConfirmedAt ? "登记发货车次" : "生产已完成，待核验尾款",
      description: payment?.tailConfirmedAt ? `${mockShipmentQueueItem(order)?.readyRoutes ?? 0} 条路线、${mockShipmentQueueItem(order)?.readyOutsource ?? 0} 项外购可发货 · 尾款已核验。请核对本单包件和车辆信息。` : payment?.tail ? "销售已报备尾款，等待财务核验；核验前不能发货。" : "请所属销售先报备尾款，财务核验到账后再安排发货。",
      actionCode: payment?.tailConfirmedAt ? "RECORD_DELIVERY" : null, actionLabel: payment?.tailConfirmedAt ? "登记发货" : "查看订单",
      actionRoute: payment?.tailConfirmedAt ? `/pages/shipment/index?orderId=${encodeURIComponent(order.id)}` : `/pages/order-detail/index?id=${order.id}`,
      presentation: payment?.tailConfirmedAt ? "NATIVE" : "READ_ONLY" })];
    return [];
  });
  const arrivalTasks = employee.role === "ORDER_ADMIN" ? getMockRoleOrders().flatMap((order) => {
    if (order.stageIndex < 5 || order.stageIndex > 8) return [];
    const pending = getMockOutsourceLines(order.id).filter((line) => !line.shipped && line.remainingQty > 0);
    if (!pending.length) return [];
    return [task({ id: `admin-arrival:${order.id}`, type: "OUTSOURCE_ARRIVAL", orderId: order.id,
      trackingSerial: order.trackingSerial, salesNumber: order.salesNumber, customerName: order.customerName,
      title: "登记外购到货", description: pending.map((line) => `${line.name}还需 ${line.remainingQty} ${line.unit}`).join("；"),
      dueAt: order.dueAt, dueLabel: order.dueLabel, expectedUpdatedAt: order.updatedAt,
      actionCode: "RECORD_OUTSOURCE_ARRIVAL", actionLabel: "登记到货",
      actionRoute: `/pages/supply/index?orderId=${encodeURIComponent(order.id)}` })];
  }) : [];
  const installationTasks = employee.role === "INSTALLER" ? getMockRoleOrders().flatMap((order) => getMockShipmentState(order.id).shipments
    .filter((shipment) => shipment.areas.length > 0 && shipment.assignedInstallerId === employee.id && !shipment.installedAt)
    .map((shipment) => task({ id: `installation:${shipment.id}`, type: "INSTALLATION", orderId: order.id,
      trackingSerial: order.trackingSerial, salesNumber: order.salesNumber, customerName: order.customerName,
      title: `${shipment.vehicle} · 本批安装`, description: `${shipment.areas.map((area) => area.areaName).join("、")} · ${shipment.installationTeamLabel || "安装"}`,
      dueAt: shipment.plannedInstallationAt, dueLabel: shipment.plannedInstallationAt || "待安排",
      expectedUpdatedAt: order.updatedAt, actionCode: "COMPLETE_INSTALLATION_BATCH", actionLabel: "填写安装记录",
      actionRoute: `/pages/installation/index?orderId=${encodeURIComponent(order.id)}&shipmentId=${encodeURIComponent(shipment.id)}`,
      meta: { vehicle: shipment.vehicle, areas: shipment.areas.map((area) => area.areaName).join("、"), siteConditions: shipment.siteConditions ?? "" } }))) : [];
  const acceptanceTasks = ["INSTALLER", "ORDER_ADMIN"].includes(employee.role) ? getMockRoleOrders()
    .filter((order) => order.stageLabel === "待客户验收" && (employee.role === "ORDER_ADMIN" || getMockShipmentState(order.id).shipments.some((shipment) => shipment.assignedInstallerId === employee.id)))
    .map((order) => task({ id: `acceptance:${order.id}`, type: "CUSTOMER_ACCEPTANCE", orderId: order.id,
      trackingSerial: order.trackingSerial, salesNumber: order.salesNumber, customerName: order.customerName,
      title: "客户验收签字", description: "全部发货车次安装已完成，请登记验收日期、结论和客户签字。",
      dueAt: order.dueAt, dueLabel: order.dueLabel, expectedUpdatedAt: order.updatedAt,
      actionCode: "ACCEPT_CUSTOMER", actionLabel: "登记验收", actionRoute: `/pages/installation/index?mode=acceptance&orderId=${encodeURIComponent(order.id)}` })) : [];
  const afterSalesTasks = employee.role === "AFTERSALES" ? getMockAfterSalesCases().filter((item) => item.status !== "RESOLVED").map((item) => task({ id: item.id, type: "AFTERSALES_CASE", orderId: item.orderId, title: item.issueType, customerName: item.customerName, salesNumber: item.salesNumber, trackingSerial: item.salesNumber, description: `${item.caseNumber} · ${item.description}`, status: item.status, dueAt: null, dueLabel: "售后处理中", expectedUpdatedAt: item.updatedAt, actionCode: item.status === "OPEN" ? "START_AFTERSALES" : "RESOLVE_AFTERSALES", actionLabel: item.status === "OPEN" ? "开始处理" : "填写处理结果", actionRoute: `/pages/aftersales/index?caseId=${encodeURIComponent(item.id)}` })) : [];
  const roleTasks = ([...createdTasks, ...arrivalTasks, ...installationTasks, ...acceptanceTasks, ...afterSalesTasks, ...(employee.role === "SALES"
    ? employee.level === "SUPERVISOR" ? [] : tasks.SALES.filter((item) => item.meta?.salesOwnerId === employee.id)
    : tasks[employee.role])]).filter((item) => {
      if (item.id === "admin-shipment-1") {
        const order = getOrders().find((candidate) => candidate.id === item.orderId);
        if (!order) return false;
        const queueItem = mockShipmentQueueItem(order);
        if (!queueItem || queueItem.readyRoutes + queueItem.readyOutsource === 0) return false;
      }
      return item.type === "OUTSOURCE_ARRIVAL" || item.id.startsWith("sales-tail:") || item.id.startsWith("finance-tail:") || item.id.startsWith("admin-production-done:") || !item.actionCode || !wx.getStorageSync<boolean>(`tai-mini-completed:${item.orderId}:${item.actionCode}`);
    });
  const titles = { CHAIRMAN: "全局经营工作台", SALES: "销售工作台", ORDER_ADMIN: "订单与发货", FINANCE: "财务收款工作台", DESIGNER: "设计任务工作台", TECHNICAL: "技术拆单工作台", PROCUREMENT: "采购工作台", INSTALLER: "安装工作台", AFTERSALES: "售后工作台" } as const;
  const subtitles = { CHAIRMAN: "查看全局风险并处理关键审批", SALES: "跟进我的客户、付款和交付", ORDER_ADMIN: "处理订单节点和发货车次", FINANCE: "核验到账事实，成本长表仍在电脑端", DESIGNER: "接单、转交、填写并提交设计资料", TECHNICAL: "手机查看队列，文件与解析在电脑端完成", PROCUREMENT: "确认路线采购和区域五金包", INSTALLER: "每个发货批次都有明确负责人", AFTERSALES: "记录问题、证据和处理结果" } as const;
  if (employee.role === "SALES") {
    const visibleOrders = getMockRoleOrders();
    const brand = employee.businessUnit === "NOERLI" ? "诺尔丽" : "艾可居";
    const supervisor = employee.level === "SUPERVISOR";
    return {
      employee,
      title: supervisor ? `${brand}销售主管工作台` : titles.SALES,
      subtitle: supervisor ? `查看${brand}全部销售订单，个人待办仍按责任人分配` : "跟进我负责的客户、付款和交付",
      scopeTitle: supervisor ? `${brand}品牌订单范围` : "本人订单范围",
      scopeDescription: supervisor ? "可查看本品牌所有销售订单；不能代替其他销售提交收款报备或付款凭证。" : "只显示由你本人负责的订单；其他销售和其他品牌订单不可见。",
      visibleOrderCount: visibleOrders.length,
      stats: supervisor ? [{ key: "brand", value: visibleOrders.length, label: "品牌订单", tone: "active" }, { key: "mine", value: roleTasks.length, label: "本人待办" }, { key: "designer", value: roleTasks.filter((item) => item.type === "DESIGN_REASSIGN").length, label: "待处理" }, { key: "urgent", value: roleTasks.filter((item) => item.urgency !== "NORMAL").length, label: "本人临期", tone: "warning" }] : stats("SALES", roleTasks),
      tasks: roleTasks, unreadCount: getMockNotifications().filter((item) => !item.read).length, serverTime: now, updatedAt: now, costModuleEnabled: false,
    };
  }
  const scope = employee.role === "CHAIRMAN" ? { scopeTitle: "全公司订单范围", scopeDescription: "关键覆盖必须说明原因；员工、编号池、成本调价和批量生产仍在电脑端办理。", visibleOrderCount: getOrders().length } : {};
  return { employee, title: titles[employee.role], subtitle: subtitles[employee.role], stats: stats(employee.role, roleTasks), tasks: roleTasks, unreadCount: getMockNotifications().filter((item) => !item.read).length, serverTime: now, updatedAt: now, costModuleEnabled: false, ...scope };
}

export function getMockRoleOrders() {
  const employee = getStoredSession();
  const orders = getOrders();
  if (!employee) return [];
  if (employee.role === "SALES") return employee.level === "SUPERVISOR"
    ? orders.filter((order) => order.businessUnit === employee.businessUnit)
    : orders.filter((order) => order.salesOwnerId === employee.id);
  if (employee.role === "DESIGNER") return orders.filter((order) => order.designerOwnerId === employee.id);
  if (employee.role === "AFTERSALES") return orders.filter((order) => order.stageLabel === "验收完成" || order.stageLabel === "履约完成" || getMockAfterSalesCases().some((item) => item.orderId === order.id));
  return orders.filter((order) => order.id !== "TEST-DEMO-MINI-001" || employee.role !== "WORKSHOP");
}

export const mockNotifications: MiniNotification[] = [
  { id: "notice-1", level: "URGENT", title: "一项任务已逾期", body: "请在工作台查看对应订单并处理。", read: false, createdAt: "2026-09-13T17:20:00+08:00" },
  { id: "notice-2", level: "INFO", title: "订单状态已更新", body: "周女士订单的儿童房进入下一处理节点。", read: false, createdAt: "2026-09-13T16:05:00+08:00" },
  { id: "notice-3", level: "INFO", title: "今日数据已同步", body: "当前为本地模拟环境，不包含真实客户数据。", read: true, createdAt: "2026-09-13T09:00:00+08:00" },
];

const mockReadPrefix = "tai-mini-notification-read:";
export function getMockNotifications(): MiniNotification[] {
  const employee = getStoredSession();
  const readIds = employee ? wx.getStorageSync<string[]>(`${mockReadPrefix}${employee.id}`) : [];
  return mockNotifications.map((item) => ({ ...item, read: item.read || Array.isArray(readIds) && readIds.includes(item.id) }));
}

export function markMockNotificationRead(id: string): void {
  const employee = getStoredSession();
  if (!employee || !mockNotifications.some((item) => item.id === id)) throw new Error("消息不存在或未登录");
  const key = `${mockReadPrefix}${employee.id}`;
  const saved = wx.getStorageSync<string[]>(key);
  const readIds = Array.isArray(saved) ? saved : [];
  if (!readIds.includes(id)) wx.setStorageSync(key, [...readIds, id]);
}
