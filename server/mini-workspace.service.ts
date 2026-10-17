import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Employee, WorkflowStage } from "./generated/prisma/client.js";
import { costEnabled } from "./runtime-config.js";
import { miniEmployeeView } from "./domain/mini-program-access.js";
import { taskUrgency } from "./domain/task-priority.js";
import { orderScope } from "./order-access.js";
import { PrismaService } from "./prisma.service.js";
import { businessTypeLabels } from "./domain/rules.js";
import { tailPaymentSatisfied } from "./domain/commercial-policy.js";
import { projectActionableOutsourceArrivalTasks } from "./domain/outsource-arrival-task-projection.js";

const journeyStages: WorkflowStage[] = ["DEPOSIT_PENDING", "DESIGN_PENDING", "DESIGN_ACCEPTED", "PRE_REVIEW", "TECHNICAL", "TECH_REVIEW", "MATERIALS", "PRODUCTION", "DELIVERY", "INSTALLATION", "ACCEPTANCE", "BUSINESS_COMPLETE"];

const stageLabels: Record<WorkflowStage, string> = {
  DEPOSIT_PENDING: "签订合同", DESIGN_PENDING: "设计待接单", DESIGN_ACCEPTED: "设计交付", PRE_REVIEW: "前置审单", TECHNICAL: "技术拆单", TECH_REVIEW: "技术审单", MATERIALS: "采购准备", PRODUCTION: "生产执行", INSTALLATION_APPLICATION: "发货安排", DELIVERY: "发货", INSTALLATION: "安装", ACCEPTANCE: "客户验收", BUSINESS_COMPLETE: "履约完成",
};

function journeyStageIndex(stage: WorkflowStage): number {
  // Historical installation applications share the delivery step in the current timeline.
  const timelineStage = stage === "INSTALLATION_APPLICATION" ? "DELIVERY" : stage;
  return Math.max(0, journeyStages.indexOf(timelineStage));
}

function dateLabel(value: Date | null) {
  if (!value) return "暂无截止日期";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit" }).format(value).replace("/", "月") + "日前";
}

type TaskOrderFacts = { id: string; prepaymentRequired?: boolean; depositReported?: boolean; prepaymentReported?: boolean; tailPaymentReported?: boolean; tailPaymentConfirmed?: boolean; creationMode?: "SALES_STANDARD" | "INTERNAL_EXCEPTION"; chargeMode?: "CHARGED" | "FREE"; commercialConfirmedAt?: Date | null };
type RoleAction = { type: string; actionCode: string | null; actionLabel: string; actionRoute?: string; desktopOnly?: boolean; presentation: "NATIVE" | "DESKTOP_HANDOFF" | "READ_ONLY" };

function roleTask(role: Employee["role"], stage: WorkflowStage, order: TaskOrderFacts): RoleAction {
  const actionRoute = (command: string) => `/pages/role-action/index?orderId=${order.id}&command=${command}`;
  if (role === "CHAIRMAN") {
    if (stage === "DEPOSIT_PENDING") {
      const command = order.prepaymentRequired && order.depositReported && order.prepaymentReported ? "CONFIRM_INITIAL_PAYMENTS" : !order.prepaymentRequired && order.depositReported ? "CONFIRM_DEPOSIT" : null;
      if (!command) return { type: "DESKTOP_REVIEW", actionCode: null, actionLabel: "查看订单", actionRoute: `/pages/order-detail/index?id=${order.id}`, presentation: "READ_ONLY" as const };
      return { type: "FINANCE_PAYMENT", actionCode: command, actionLabel: "关键确认", actionRoute: actionRoute(command), presentation: "NATIVE" as const };
    }
    if (order.tailPaymentReported && ["PRODUCTION", "DELIVERY", "INSTALLATION"].includes(stage)) return { type: "FINANCE_PAYMENT", actionCode: "CONFIRM_TAIL_PAYMENT", actionLabel: "关键确认", actionRoute: actionRoute("CONFIRM_TAIL_PAYMENT"), presentation: "NATIVE" as const };
    if (stage === "ACCEPTANCE") return { type: "CUSTOMER_ACCEPTANCE", actionCode: "ACCEPT_CUSTOMER", actionLabel: "验收覆盖", actionRoute: actionRoute("ACCEPT_CUSTOMER"), presentation: "NATIVE" as const };
    if (stage === "MATERIALS") return { type: "PROCUREMENT_ROUTE", actionCode: "COMPLETE_PROCUREMENT_ROUTE", actionLabel: "查看采购", actionRoute: `/pages/role-center/index?section=procurement&orderId=${order.id}`, presentation: "NATIVE" as const };
    return { type: "DESKTOP_REVIEW", actionCode: null, actionLabel: "查看订单", actionRoute: `/pages/order-detail/index?id=${order.id}`, presentation: "READ_ONLY" as const };
  }
  if (role === "SALES") {
    if (stage === "DEPOSIT_PENDING") return { type: "INITIAL_PAYMENT", actionCode: "REPORT_INITIAL_PAYMENT", actionLabel: "去补充", presentation: "NATIVE" as const };
    if (stage === "DESIGN_PENDING") return { type: "DESIGN_REASSIGN", actionCode: "ASSIGN_DESIGNER", actionLabel: "重新分配", presentation: "NATIVE" as const };
    return { type: "TAIL_PAYMENT", actionCode: "REPORT_TAIL_PAYMENT", actionLabel: "报备尾款", actionRoute: `/pages/tail-payment/index?orderId=${order.id}`, presentation: "NATIVE" as const };
  }
  if (role === "ORDER_ADMIN") {
    if (["PRE_REVIEW", "TECH_REVIEW", "TECHNICAL"].includes(stage)) return { type: "DESKTOP_REVIEW", actionCode: null, actionLabel: "电脑端办理", desktopOnly: true, presentation: "DESKTOP_HANDOFF" as const };
    if (["DELIVERY", "INSTALLATION_APPLICATION", "PRODUCTION"].includes(stage)) return tailPaymentSatisfied(order)
      ? { type: "SHIPMENT", actionCode: "RECORD_DELIVERY", actionLabel: "登记发货", presentation: "NATIVE" as const }
      : { type: "TAIL_PAYMENT", actionCode: null, actionLabel: "查看订单", actionRoute: `/pages/order-detail/index?id=${order.id}`, presentation: "READ_ONLY" as const };
    if (stage === "ACCEPTANCE") return { type: "CUSTOMER_ACCEPTANCE", actionCode: "ACCEPT_CUSTOMER", actionLabel: "登记验收", presentation: "NATIVE" as const };
    return { type: "DESKTOP_REVIEW", actionCode: null, actionLabel: "查看订单", actionRoute: `/pages/order-detail/index?id=${order.id}`, presentation: "READ_ONLY" as const };
  }
  if (role === "FINANCE") {
    if (stage === "DEPOSIT_PENDING") {
      const command = order.prepaymentRequired && order.depositReported && order.prepaymentReported ? "CONFIRM_INITIAL_PAYMENTS" : !order.prepaymentRequired && order.depositReported ? "CONFIRM_DEPOSIT" : null;
      if (!command) return { type: "DESKTOP_REVIEW", actionCode: null, actionLabel: "查看订单", actionRoute: `/pages/order-detail/index?id=${order.id}`, presentation: "READ_ONLY" as const };
      return { type: "FINANCE_PAYMENT", actionCode: command, actionLabel: "核验到账", actionRoute: actionRoute(command), presentation: "NATIVE" as const };
    }
    if (order.tailPaymentReported) return { type: "FINANCE_PAYMENT", actionCode: "CONFIRM_TAIL_PAYMENT", actionLabel: "核验尾款", actionRoute: actionRoute("CONFIRM_TAIL_PAYMENT"), presentation: "NATIVE" as const };
    return { type: "DESKTOP_REVIEW", actionCode: null, actionLabel: "查看订单", actionRoute: `/pages/order-detail/index?id=${order.id}`, presentation: "READ_ONLY" as const };
  }
  if (role === "DESIGNER") {
    if (stage === "DESIGN_PENDING") return { type: "DESIGN_INTAKE", actionCode: "ACCEPT_DESIGN", actionLabel: "接受任务", actionRoute: actionRoute("ACCEPT_DESIGN"), presentation: "NATIVE" as const };
    if (stage === "DESIGN_ACCEPTED") return { type: "DESIGN_SUBMISSION", actionCode: "SUBMIT_DESIGN", actionLabel: "提交设计", actionRoute: `/pages/design-submit/index?orderId=${order.id}`, presentation: "NATIVE" as const };
    return { type: "DESKTOP_REVIEW", actionCode: null, actionLabel: "电脑端提交", desktopOnly: true, presentation: "DESKTOP_HANDOFF" as const };
  }
  if (role === "TECHNICAL") return { type: "TECHNICAL_DESKTOP", actionCode: null, actionLabel: "电脑端办理", desktopOnly: true, presentation: "DESKTOP_HANDOFF" as const };
  if (role === "PROCUREMENT") return { type: "PROCUREMENT_ROUTE", actionCode: "COMPLETE_PROCUREMENT_ROUTE", actionLabel: "处理采购", actionRoute: `/pages/role-center/index?section=procurement&orderId=${order.id}`, presentation: "NATIVE" as const };
  if (role === "INSTALLER") return stage === "ACCEPTANCE"
    ? { type: "CUSTOMER_ACCEPTANCE", actionCode: "ACCEPT_CUSTOMER", actionLabel: "登记验收", presentation: "NATIVE" as const }
    : { type: "INSTALLATION", actionCode: "COMPLETE_INSTALLATION_BATCH", actionLabel: "填写安装记录", presentation: "NATIVE" as const };
  return { type: "WORKSHOP_PROCESS", actionCode: null, actionLabel: "查看", presentation: "READ_ONLY" as const };
}

@Injectable()
export class MiniWorkspaceService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async workspace(employee: Employee) {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60_000);
    const [notifications, tasks, visibleOrderCount, paymentAccountApprovals, packageOrders, salesFollowups, outsourceArrivalOrders] = await Promise.all([
      this.prisma.notification.count({ where: { employeeId: employee.id, readAt: null } }),
      employee.role === "AFTERSALES" ? Promise.resolve([]) : this.prisma.task.findMany({
        where: employee.role === "CHAIRMAN"
          ? { status: { in: ["PENDING", "OVERDUE"] }, order: orderScope(employee), OR: [{ status: "OVERDUE" }, { dueAt: { lte: tomorrow } }, { order: { rush: true } }] }
          : { ownerId: employee.id, status: { in: ["PENDING", "OVERDUE"] }, order: orderScope(employee) },
        include: { order: { select: { id: true, trackingSerial: true, salesNumber: true, customerName: true, rush: true, updatedAt: true, prepaymentRequired: true, depositReported: true, prepaymentReported: true, tailPaymentReported: true, tailPaymentConfirmed: true, creationMode: true, chargeMode: true, commercialConfirmedAt: true, events: { where: { type: { in: ["RETURN_DESIGN", "REJECT_PRE_REVIEW", "REJECT_TECH_REVIEW", "TECHNICAL_REVISION_REQUIRED"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { description: true } } } } },
        orderBy: { dueAt: "asc" }, take: 100,
      }),
      employee.role === "WORKSHOP" ? Promise.resolve(0) : this.prisma.order.count({ where: orderScope(employee) }),
      employee.role === "CHAIRMAN" ? this.prisma.paymentAccount.findMany({ where: { status: "PENDING" }, select: { id: true, name: true, requestedAt: true, updatedAt: true }, orderBy: { requestedAt: "asc" } }) : Promise.resolve([]),
      employee.role === "PROCUREMENT" ? this.prisma.order.findMany({
        where: { stage: { in: ["MATERIALS", "PRODUCTION", "DELIVERY", "INSTALLATION"] }, productionAreas: { some: { cancelledAt: null } }, ...orderScope(employee) },
        select: { id: true, trackingSerial: true, salesNumber: true, customerName: true, rush: true, internalDueAt: true, updatedAt: true, productionAreas: { where: { cancelledAt: null }, select: { id: true } }, packageCountSources: { where: { kind: "HARDWARE_AREA" }, select: { productionAreaId: true, status: true } } },
        orderBy: { internalDueAt: "asc" }, take: 50,
      }) : Promise.resolve([]),
      employee.role === "SALES" ? this.prisma.order.findMany({
        where: { ...orderScope(employee), salesId: employee.id, stage: "DEPOSIT_PENDING", depositReported: true,
          OR: [{ prepaymentRequired: false }, { prepaymentRequired: true, prepaymentReported: true }] },
        select: { id: true, trackingSerial: true, salesNumber: true, customerName: true, rush: true, prepaymentRequired: true, updatedAt: true },
        orderBy: { updatedAt: "desc" }, take: 50,
      }) : Promise.resolve([]),
      employee.role === "ORDER_ADMIN" ? this.prisma.order.findMany({
        where: { stage: { in: ["MATERIALS", "PRODUCTION", "INSTALLATION_APPLICATION", "DELIVERY", "INSTALLATION"] }, outsourceRequirementMode: "REQUIRED", ...orderScope(employee) },
        select: {
          id: true, trackingSerial: true, salesNumber: true, productionNumber: true, customerName: true, stage: true, rush: true, internalDueAt: true, updatedAt: true, outsourceRequirementMode: true,
          outsourceRequirementVersions: { where: { status: "APPROVED" }, orderBy: { version: "desc" }, take: 1,
            select: { lines: { select: { plannedQty: true, arrivals: { select: { quantity: true, voidedAt: true } } } } } },
        },
        orderBy: { internalDueAt: "asc" }, take: 100,
      }) : Promise.resolve([]),
    ]);
    const aftersales = employee.role === "AFTERSALES" ? await this.prisma.afterSalesCase.findMany({
      where: { order: { stage: "BUSINESS_COMPLETE" }, status: { in: ["OPEN", "IN_PROGRESS"] } },
      include: { order: { select: { id: true, trackingSerial: true, salesNumber: true, customerName: true, updatedAt: true } } },
      orderBy: { updatedAt: "asc" }, take: 100,
    }) : [];
    const taskCards = tasks.filter((task) => employee.role !== "ORDER_ADMIN" || !task.uniqueKey.endsWith(":OUTSOURCE_ARRIVAL")).map((task) => {
      const action: RoleAction = roleTask(employee.role, task.stage ?? "PRODUCTION", task.order);
      const urgency = taskUrgency(task, now);
      const shipmentId = action.type === "INSTALLATION" ? task.uniqueKey.split(":").at(-1) ?? null : null;
      const feedback = ["DESIGNER", "TECHNICAL"].includes(employee.role) ? task.order.events[0]?.description : null;
      return {
        id: task.id, type: action.type, orderId: task.order.id, trackingSerial: task.order.trackingSerial, salesNumber: task.order.salesNumber,
        customerName: task.order.customerName, title: action.type === "SHIPMENT" ? "登记发货车次" : action.type === "TAIL_PAYMENT" && employee.role === "ORDER_ADMIN" ? "待核验尾款后发货" : task.title, description: feedback ? `最近退回原因：${feedback}` : action.type === "TAIL_PAYMENT" && employee.role === "ORDER_ADMIN" ? "尾款尚未核验，完成财务核验后可登记发货。" : `${stageLabels[task.stage ?? "PRODUCTION"]}·由${task.department}处理`, status: task.status,
        urgency, urgencyLabel: urgency === "OVERDUE" ? "已逾期" : urgency === "RUSH" ? "加急" : urgency === "DUE_SOON" ? "24小时内" : "按计划",
        dueAt: task.dueAt, dueLabel: dateLabel(task.dueAt), actionCode: action.actionCode, actionLabel: action.actionLabel,
        actionRoute: action.actionRoute ?? (action.type === "SHIPMENT" ? `/pages/shipment/index?orderId=${task.order.id}` : action.type === "INSTALLATION" ? `/pages/installation/index?taskId=${task.id}&orderId=${task.order.id}&shipmentId=${shipmentId ?? ""}` : action.type === "CUSTOMER_ACCEPTANCE" && employee.role !== "CHAIRMAN" ? `/pages/installation/index?mode=acceptance&orderId=${task.order.id}` : `/pages/order-detail/index?id=${task.order.id}`),
        expectedUpdatedAt: task.order.updatedAt, desktopOnly: action.desktopOnly ?? false, presentation: action.presentation,
        desktopHandoff: action.presentation === "DESKTOP_HANDOFF" ? { reason: employee.role === "TECHNICAL" ? "该任务需要海迅、物料Excel或完整拆单资料" : "该任务需要CAD、客户确认图或完整审单资料", moduleLabel: employee.role === "TECHNICAL" ? "技术拆单" : "订单详情", identifier: task.order.salesNumber ?? task.order.trackingSerial } : undefined,
        meta: shipmentId ? { shipmentId } : undefined,
      };
    });
    const arrivalOrdersById = new Map(outsourceArrivalOrders.map((order) => [order.id, order]));
    const arrivalCards = projectActionableOutsourceArrivalTasks(employee, outsourceArrivalOrders.map((order) => ({
      ...order, outsourceLines: (order.outsourceRequirementVersions[0]?.lines ?? []).map((line) => ({
        plannedQty: Number(line.plannedQty), arrivals: line.arrivals.map((arrival) => ({ quantity: Number(arrival.quantity), voidedAt: arrival.voidedAt })),
      })),
    })), now).map((item) => {
      const urgency = taskUrgency(item, now);
      return {
        id: item.id, type: "OUTSOURCE_ARRIVAL", orderId: item.orderId, trackingSerial: item.order.trackingSerial,
        salesNumber: item.order.salesNumber, customerName: item.order.customerName, title: item.title,
        description: `${item.pendingCount} 项外购产品尚未齐套，请按实际批次登记到货。`, status: item.status,
        urgency, urgencyLabel: urgency === "OVERDUE" ? "已逾期" : urgency === "RUSH" ? "加急" : urgency === "DUE_SOON" ? "24小时内" : "按计划",
        dueAt: item.dueAt, dueLabel: dateLabel(item.dueAt), actionCode: "RECORD_OUTSOURCE_ARRIVAL",
        actionLabel: "登记到货", actionRoute: `/pages/supply/index?orderId=${encodeURIComponent(item.orderId)}`,
        expectedUpdatedAt: arrivalOrdersById.get(item.orderId)!.updatedAt, desktopOnly: false, presentation: "NATIVE" as const,
      };
    });
    const followupCards = salesFollowups.filter((order) => !taskCards.some((task) => task.orderId === order.id)).map((order) => ({
      id: `sales-followup:${order.id}`, type: "INITIAL_PAYMENT", orderId: order.id, trackingSerial: order.trackingSerial,
      salesNumber: order.salesNumber, customerName: order.customerName, title: "等待财务核验首付款",
      description: order.prepaymentRequired ? "定金和预付款已报备，请跟进财务到账核验。" : "定金已报备，请跟进财务到账核验。",
      status: "PENDING", urgency: order.rush ? "RUSH" : "NORMAL",
      urgencyLabel: order.rush ? "加急" : "待核验", dueAt: null, dueLabel: "财务待核验",
      actionCode: null, actionLabel: "查看订单", actionRoute: `/pages/order-detail/index?id=${order.id}`,
      expectedUpdatedAt: order.updatedAt, desktopOnly: false, presentation: "READ_ONLY" as const,
    }));
    const approvalCards = paymentAccountApprovals.map((account) => ({
      id: `payment-account:${account.id}`, type: "CHAIRMAN_APPROVAL", orderId: "", trackingSerial: "", salesNumber: null, customerName: "非订单事项",
      title: "审批新增收款账户", description: account.name, status: "PENDING", urgency: "NORMAL", urgencyLabel: "待审批", dueAt: null, dueLabel: "财务申请",
      actionCode: "REVIEW_PAYMENT_ACCOUNT", actionLabel: "去审批", actionRoute: "/pages/role-center/index?section=risk", expectedUpdatedAt: account.updatedAt,
      desktopOnly: false, presentation: "NATIVE" as const, meta: { accountId: account.id },
    }));
    const packageCards = packageOrders.filter((order) => order.productionAreas.some((area) => !order.packageCountSources.some((source) => source.productionAreaId === area.id && source.status === "FINALIZED"))).map((order) => {
      const pending = order.productionAreas.filter((area) => !order.packageCountSources.some((source) => source.productionAreaId === area.id && source.status === "FINALIZED")).length;
      const urgency = taskUrgency({ dueAt: order.internalDueAt, status: order.internalDueAt < now ? "OVERDUE" : "PENDING", order: { rush: order.rush } }, now);
      return {
        id: `package-count:${order.id}`, type: "PROCUREMENT_PACKAGE", orderId: order.id, trackingSerial: order.trackingSerial, salesNumber: order.salesNumber, customerName: order.customerName,
        title: "确认区域五金包数量", description: `${pending}个生产区域等待最终数量`, status: "PENDING", urgency, urgencyLabel: urgency === "OVERDUE" ? "已逾期" : urgency === "RUSH" ? "加急" : urgency === "DUE_SOON" ? "24小时内" : "按计划",
        dueAt: order.internalDueAt, dueLabel: dateLabel(order.internalDueAt), actionCode: "FINALIZE_HARDWARE_PACKAGES", actionLabel: "填写数量", actionRoute: `/pages/role-center/index?section=procurement&orderId=${order.id}`,
        expectedUpdatedAt: order.updatedAt, desktopOnly: false, presentation: "NATIVE" as const,
      };
    });
    const aftersalesCards = aftersales.map((item) => ({
      id: item.id, type: "AFTERSALES_CASE", orderId: item.order.id, trackingSerial: item.order.trackingSerial, salesNumber: item.order.salesNumber, customerName: item.order.customerName,
      title: item.issueType, description: `${item.caseNumber}·${item.description}`, status: item.status, urgency: "NORMAL", urgencyLabel: item.status === "OPEN" ? "新问题" : "处理中",
      dueAt: null, dueLabel: "共享售后队列", actionCode: item.status === "OPEN" ? "START_AFTERSALES" : "RESOLVE_AFTERSALES", actionLabel: item.status === "OPEN" ? "开始处理" : "填写结果",
      actionRoute: `/pages/aftersales/index?caseId=${item.id}`, expectedUpdatedAt: item.updatedAt, desktopOnly: false,
    }));
    const cards = [...approvalCards, ...packageCards, ...arrivalCards, ...taskCards, ...followupCards, ...aftersalesCards];
    const roleContent = this.roleContent(employee, cards, visibleOrderCount);
    return { employee: miniEmployeeView(employee), ...roleContent, tasks: cards, unreadCount: notifications, serverTime: now, updatedAt: cards.reduce((latest, task) => task.expectedUpdatedAt > latest ? task.expectedUpdatedAt : latest, now), costModuleEnabled: costEnabled() };
  }

  private roleContent(employee: Employee, tasks: Array<{ type: string; status: string; urgency: string; desktopOnly?: boolean }>, visibleOrderCount: number) {
    const role = employee.role;
    if (role === "SALES") {
      const brand = employee.businessUnit === "NOERLI" ? "诺尔丽" : employee.businessUnit === "AIKEJU" ? "艾可居" : "当前品牌";
      const supervisor = employee.level === "SUPERVISOR";
      return {
        title: supervisor ? `${brand}销售主管工作台` : "销售工作台",
        subtitle: supervisor ? `查看${brand}全部销售订单，个人待办仍按责任人分配` : "跟进我负责的客户、付款和交付",
        scopeTitle: supervisor ? `${brand}品牌订单范围` : "本人订单范围",
        scopeDescription: supervisor ? "可查看本品牌所有销售订单；不能代替其他销售提交收款报备或付款凭证。" : "只显示由你本人负责的订单；其他销售和其他品牌订单不可见。",
        visibleOrderCount,
        stats: supervisor ? [
          { key: "brand", value: visibleOrderCount, label: "品牌订单", tone: "active" as const },
          { key: "mine", value: tasks.length, label: "本人待办" },
          { key: "designer", value: tasks.filter((item) => item.type === "DESIGN_REASSIGN").length, label: "待处理" },
          { key: "urgent", value: tasks.filter((item) => item.urgency !== "NORMAL").length, label: "本人临期", tone: "warning" as const },
        ] : [
          { key: "payment", value: tasks.filter((item) => item.type === "INITIAL_PAYMENT").length, label: "待补付款" }, { key: "designer", value: tasks.filter((item) => item.type === "DESIGN_REASSIGN").length, label: "设计待分配", tone: "active" as const }, { key: "tail", value: tasks.filter((item) => item.type === "TAIL_PAYMENT").length, label: "尾款待报" }, { key: "urgent", value: tasks.filter((item) => item.urgency !== "NORMAL").length, label: "临期/加急", tone: "warning" as const },
        ],
      };
    }
    if (role === "CHAIRMAN") return { title: "全局经营工作台", subtitle: "查看全局风险并处理关键审批", scopeTitle: "全公司订单范围", scopeDescription: "关键覆盖必须说明原因；员工、编号池、成本调价和批量生产仍在电脑端办理。", visibleOrderCount, stats: [
      { key: "orders", value: visibleOrderCount, label: "全部订单", tone: "active" as const }, { key: "approval", value: tasks.filter((item) => item.type === "CHAIRMAN_APPROVAL").length, label: "待审批" }, { key: "urgent", value: tasks.filter((item) => item.urgency !== "NORMAL").length, label: "风险/临期", tone: "warning" as const }, { key: "desktop", value: tasks.filter((item) => item.type === "DESKTOP_REVIEW").length, label: "电脑端办" },
    ] };
    if (role === "ORDER_ADMIN") return { title: "订单与发货", subtitle: "处理订单节点和发货车次", stats: [
      { key: "mine", value: tasks.length, label: "我的待办" }, { key: "shipment", value: tasks.filter((item) => item.type === "SHIPMENT").length, label: "可发货", tone: "active" }, { key: "arrival", value: tasks.filter((item) => item.type === "OUTSOURCE_ARRIVAL").length, label: "待到货" }, { key: "desktop", value: tasks.filter((item) => item.type === "DESKTOP_REVIEW").length, label: "电脑端办", tone: "warning" },
    ] };
    if (role === "INSTALLER") return { title: "安装工作台", subtitle: "每个发货批次都有明确负责人", stats: [
      { key: "today", value: tasks.filter((item) => item.type === "INSTALLATION").length, label: "待安装", tone: "active" }, { key: "overdue", value: tasks.filter((item) => item.urgency === "OVERDUE").length, label: "已逾期" }, { key: "active", value: tasks.filter((item) => item.status === "PENDING").length, label: "进行中" }, { key: "acceptance", value: tasks.filter((item) => item.type === "CUSTOMER_ACCEPTANCE").length, label: "待验收" },
    ] };
    if (role === "FINANCE") return { title: "财务收款工作台", subtitle: "核验到账事实，成本长表仍在电脑端", visibleOrderCount, stats: [
      { key: "payment", value: tasks.filter((item) => item.type === "FINANCE_PAYMENT").length, label: "待核验", tone: "active" }, { key: "urgent", value: tasks.filter((item) => item.urgency !== "NORMAL").length, label: "临期/逾期", tone: "warning" }, { key: "orders", value: visibleOrderCount, label: "可见订单" }, { key: "desktop", value: tasks.filter((item) => item.type === "DESKTOP_REVIEW").length, label: "电脑端办" },
    ] };
    if (role === "DESIGNER") return { title: "设计任务工作台", subtitle: "接单、转交、填写并提交设计资料", visibleOrderCount, stats: [
      { key: "intake", value: tasks.filter((item) => item.type === "DESIGN_INTAKE").length, label: "待接单", tone: "active" }, { key: "accepted", value: tasks.filter((item) => item.type === "DESIGN_SUBMISSION").length, label: "待交付" }, { key: "urgent", value: tasks.filter((item) => item.urgency !== "NORMAL").length, label: "临期/逾期", tone: "warning" }, { key: "orders", value: visibleOrderCount, label: "本人订单" },
    ] };
    if (role === "TECHNICAL") return { title: "技术拆单工作台", subtitle: "手机查看队列，文件与解析在电脑端完成", visibleOrderCount, stats: [
      { key: "queue", value: tasks.length, label: "拆单队列", tone: "active" }, { key: "urgent", value: tasks.filter((item) => item.urgency !== "NORMAL").length, label: "临期/逾期", tone: "warning" }, { key: "orders", value: visibleOrderCount, label: "可见订单" }, { key: "desktop", value: tasks.filter((item) => item.desktopOnly).length, label: "电脑端办" },
    ] };
    if (role === "PROCUREMENT") return { title: "采购工作台", subtitle: "确认路线采购和区域五金包", visibleOrderCount, stats: [
      { key: "route", value: tasks.filter((item) => item.type === "PROCUREMENT_ROUTE").length, label: "路线待确认", tone: "active" }, { key: "package", value: tasks.filter((item) => item.type === "PROCUREMENT_PACKAGE").length, label: "五金包" }, { key: "urgent", value: tasks.filter((item) => item.urgency !== "NORMAL").length, label: "临期/逾期", tone: "warning" }, { key: "orders", value: visibleOrderCount, label: "可见订单" },
    ] };
    if (role === "AFTERSALES") return { title: "售后工作台", subtitle: "记录问题、证据和处理结果", stats: [
      { key: "new", value: tasks.filter((item) => item.status === "OPEN").length, label: "新问题", tone: "warning" }, { key: "active", value: tasks.filter((item) => item.status === "IN_PROGRESS").length, label: "处理中", tone: "active" }, { key: "missing", value: 0, label: "待补资料" }, { key: "done", value: 0, label: "今日完成" },
    ] };
    throw new ForbiddenException("该岗位使用专用车间工作台");
  }

  async orders(employee: Employee) {
    const rows = await this.prisma.order.findMany({ where: orderScope(employee), select: { id: true, trackingSerial: true, salesNumber: true, customerName: true, businessType: true, stage: true, rush: true, internalDueAt: true, currentOwnerLabel: true, nextAction: true, updatedAt: true, sales: { select: { id: true, name: true } }, designer: { select: { id: true, name: true } }, tasks: { where: { status: { in: ["PENDING", "OVERDUE"] } }, orderBy: { createdAt: "desc" }, select: { stage: true, dueAt: true } }, aftersales: { select: { status: true } }, productionAreas: { where: { cancelledAt: null }, select: { id: true, productionProcesses: { select: { plannedQty: true, completedQty: true, status: true, metricMode: true } } } } }, orderBy: { updatedAt: "desc" }, take: 100 });
    return rows.map((row) => {
      const included = (process: { metricMode: string }) => !["REFERENCE_CONFIRMATION", "PACKAGE_COUNT"].includes(process.metricMode);
      const processes = row.productionAreas.flatMap((area) => area.productionProcesses.filter(included));
      const planned = processes.reduce((sum, item) => sum + Number(item.plannedQty), 0);
      const completed = processes.reduce((sum, item) => sum + Math.min(Number(item.completedQty), Number(item.plannedQty)), 0);
      const afterSalesCount = row.stage === "BUSINESS_COMPLETE" ? (row.aftersales?.length ?? 0) : 0;
      const afterSalesActive = afterSalesCount > 0 && row.aftersales.some((item) => item.status !== "RESOLVED");
      const currentTaskDueAt = row.tasks?.find((task) => task.stage === row.stage)?.dueAt ?? row.internalDueAt;
      return {
        id: row.id, trackingSerial: row.trackingSerial, salesNumber: row.salesNumber, customerName: row.customerName, businessType: row.businessType, businessUnit: row.businessType.split("_")[0], salesOwnerId: row.sales?.id ?? null, salesOwnerName: row.sales?.name ?? null, designerOwnerId: row.designer?.id ?? null, designerOwnerName: row.designer?.name ?? null,
        brandLabel: businessTypeLabels[row.businessType], stageLabel: stageLabels[row.stage], stageIndex: afterSalesCount ? journeyStages.length + 1 : journeyStageIndex(row.stage) + 1, stageTotal: journeyStages.length + (afterSalesCount ? 1 : 0), afterSalesActive, afterSalesCount, nextAction: row.nextAction,
        dueAt: row.internalDueAt, dueLabel: dateLabel(row.internalDueAt), currentTaskDueAt, currentTaskDueLabel: dateLabel(currentTaskDueAt), rush: row.rush, updatedAt: row.updatedAt,
        areaSummary: { total: row.productionAreas.length, completed: row.productionAreas.filter((area) => area.productionProcesses.some(included) && area.productionProcesses.filter(included).every((item) => item.status === "COMPLETE")).length, inProgress: row.productionAreas.filter((area) => area.productionProcesses.filter(included).some((item) => item.status !== "PENDING") && !area.productionProcesses.filter(included).every((item) => item.status === "COMPLETE")).length, waiting: row.productionAreas.filter((area) => !area.productionProcesses.some(included) || area.productionProcesses.filter(included).every((item) => item.status === "PENDING")).length, percent: planned > 0 ? Math.round(completed / planned * 100) : 0 },
      };
    });
  }

  async order(id: string, employee: Employee) {
    const row = await this.prisma.order.findFirst({
      where: { id, ...orderScope(employee) },
      select: {
        id: true,
        trackingSerial: true,
        salesNumber: true,
        customerName: true,
        customerPhone: true,
        address: true,
        businessType: true,
        stage: true,
        rush: true,
        internalDueAt: true,
        currentOwnerLabel: true,
        nextAction: true,
        updatedAt: true,
        tasks: { where: { status: { in: ["PENDING", "OVERDUE"] } }, orderBy: { createdAt: "desc" }, select: { stage: true, dueAt: true } },
        sales: { select: { id: true, name: true } },
        designer: { select: { id: true, name: true } },
        attachments: { select: { category: true, createdAt: true } },
        stageSubmissions: { where: { command: { in: ["SUBMIT_DESIGN", "SUBMIT_TECHNICAL"] }, status: { not: "DRAFT" } }, select: { command: true, version: true, status: true, submittedAt: true }, orderBy: { submittedAt: "desc" } },
        aftersales: { select: { id: true, status: true } },
        productionAreas: {
          where: { cancelledAt: null },
          orderBy: { sequence: "asc" },
          select: {
            id: true,
            name: true,
            productionNumber: true,
            status: true,
            productionProcesses: {
              orderBy: [{ workshop: "asc" }, { sequence: "asc" }],
              select: { id: true, workshop: true, workshopLabel: true, processCode: true, processName: true, sequence: true, plannedQty: true, completedQty: true, unit: true, metricMode: true, status: true, productionRoute: { select: { kind: true } } },
            },
          },
        },
        shipments: {
          where: employee.role === "INSTALLER" ? { assignedInstallerId: employee.id } : {},
          select: { id: true, vehicle: true, deliveredAt: true, assignedInstallerId: true, installationTeamLabel: true, siteContact: true, plannedInstallationAt: true, siteConditions: true, installedAt: true, areas: { select: { areaName: true, productionNumber: true, sequence: true, isFinalBatch: true } } },
        },
      },
    });
    if (!row) throw new NotFoundException("订单不存在或无权访问");
    const currentIndex = journeyStageIndex(row.stage);
    const productionAreas = row.productionAreas.map((area) => {
      const progressProcesses = area.productionProcesses.filter((item) => !["REFERENCE_CONFIRMATION", "PACKAGE_COUNT"].includes(item.metricMode));
      const planned = progressProcesses.reduce((sum, item) => sum + Number(item.plannedQty), 0);
      const completed = progressProcesses.reduce((sum, item) => sum + Math.min(Number(item.completedQty), Number(item.plannedQty)), 0);
      const percent = planned > 0 ? Math.round(completed / planned * 100) : 0;
      const routes = [...new Set(area.productionProcesses.map((item) => item.productionRoute?.kind).filter(Boolean))];
      const flows = new Map<string, typeof area.productionProcesses>();
      for (const process of area.productionProcesses) {
        const key = process.productionRoute?.kind ? `${process.workshop}_${process.productionRoute.kind}` : process.workshop;
        flows.set(key, [...(flows.get(key) ?? []), process]);
      }
      return {
        id: area.id, name: area.name, productionNumber: area.productionNumber,
        routeLabel: routes.map((kind) => kind === "PANEL" ? "板式路线" : "实木油漆路线").join(" + ") || "待确定路线",
        statusLabel: area.status === "SHIPPED" ? "已发货" : percent >= 100 ? "已完工" : percent > 0 ? "生产中" : "待生产",
        dueLabel: dateLabel(row.internalDueAt), percent, complete: percent >= 100,
        workshopFlows: [...flows.entries()].map(([key, processes]) => ({ key, label: `${processes[0]?.workshopLabel ?? key}${key.startsWith("ASSEMBLY_") ? `·${key.endsWith("PANEL") ? "板式路线" : "实木油漆路线"}` : ""}`, processes: processes.map((process) => ({ id: process.id, processCode: process.processCode, title: process.processName, workshopLabel: process.workshopLabel, sequence: process.sequence, plannedQty: Number(process.plannedQty), completedQty: Number(process.completedQty), unit: process.unit, dueLabel: dateLabel(row.internalDueAt), status: process.status === "COMPLETE" ? "DONE" : process.status === "ISSUE" ? "ISSUE" : Number(process.completedQty) > 0 ? "IN_PROGRESS" : "LOCKED", statusLabel: process.status === "COMPLETE" ? "已完成" : process.status === "ISSUE" ? "异常" : Number(process.completedQty) > 0 ? "加工中" : "待解锁", progressIncluded: !["REFERENCE_CONFIRMATION", "PACKAGE_COUNT"].includes(process.metricMode), canReport: false })) })),
      };
    });
    const allProcesses = row.productionAreas.flatMap((area) => area.productionProcesses);
    const currentTaskDueAt = row.tasks?.find((task) => task.stage === row.stage)?.dueAt ?? row.internalDueAt;
    const afterSalesActive = row.stage === "BUSINESS_COMPLETE" && row.aftersales.some((item) => item.status !== "RESOLVED");
    const afterSalesCount = row.stage === "BUSINESS_COMPLETE" ? row.aftersales.length : 0;
    const areaSummary = { total: productionAreas.length, completed: productionAreas.filter((area) => area.complete).length, inProgress: productionAreas.filter((area) => area.percent > 0 && !area.complete).length, waiting: productionAreas.filter((area) => area.percent === 0).length, percent: productionAreas.length ? Math.round(productionAreas.reduce((sum, area) => sum + area.percent, 0) / productionAreas.length) : 0 };
    return {
      id: row.id, trackingSerial: row.trackingSerial, salesNumber: row.salesNumber, customerName: row.customerName, customerPhone: row.customerPhone, address: row.address, businessType: row.businessType, businessUnit: row.businessType.split("_")[0], salesOwnerId: row.sales?.id ?? null, salesOwnerName: row.sales?.name ?? null, designerOwnerId: row.designer?.id ?? null, designerOwnerName: row.designer?.name ?? null,
      brandLabel: businessTypeLabels[row.businessType], stageLabel: stageLabels[row.stage], stageIndex: afterSalesCount ? journeyStages.length + 1 : currentIndex + 1, stageTotal: journeyStages.length + (afterSalesCount ? 1 : 0),
      currentOwnerLabel: row.currentOwnerLabel, nextAction: row.nextAction, dueAt: row.internalDueAt, dueLabel: dateLabel(row.internalDueAt), currentTaskDueAt, currentTaskDueLabel: dateLabel(currentTaskDueAt), updatedAt: row.updatedAt,
      riskCount: allProcesses.filter((item) => item.status === "ISSUE").length + row.aftersales.filter((item) => item.status !== "RESOLVED").length, rush: row.rush,
      afterSalesActive, afterSalesCount,
      journey: [...journeyStages.map((stage, index) => ({ key: stage, label: stageLabels[stage], state: afterSalesCount && index === currentIndex || index < currentIndex ? "complete" : index === currentIndex ? "current" : "future" })), ...(afterSalesCount ? [{ key: "AFTERSALES", label: "售后", state: afterSalesActive ? "current" : "complete" }] : [])],
      productionAreas, areaSummary, shipments: row.shipments,
      evidenceSummary: {
        design: { count: row.attachments.filter((item) => ["DESIGN_CAD", "DESIGN_CONFIRMATION", "CUSTOMER_SAMPLE_BLOCK"].includes(item.category)).length, latestVersion: row.stageSubmissions.find((item) => item.command === "SUBMIT_DESIGN")?.version ?? null, status: row.stageSubmissions.find((item) => item.command === "SUBMIT_DESIGN")?.status ?? "NOT_SUBMITTED" },
        technical: { count: row.attachments.filter((item) => ["HAIXUN_EXPORT", "DECOMPOSITION_SHEET", "HARDWARE_MATERIALS", "PAINT_WOOD", "SOLID_WOOD_DOOR", "VENEER_DOOR"].includes(item.category)).length, latestVersion: row.stageSubmissions.find((item) => item.command === "SUBMIT_TECHNICAL")?.version ?? null, status: row.stageSubmissions.find((item) => item.command === "SUBMIT_TECHNICAL")?.status ?? "NOT_SUBMITTED" },
        desktopOnly: true,
      },
    };
  }

  async shipmentQueue(employee: Employee) {
    if (employee.role !== "ORDER_ADMIN") throw new ForbiddenException("仅订单管理员可访问发货订单列表");
    const orders = await this.prisma.order.findMany({
      where: {
        ...orderScope(employee),
        stage: { in: ["PRODUCTION", "INSTALLATION_APPLICATION", "DELIVERY", "INSTALLATION", "ACCEPTANCE", "BUSINESS_COMPLETE"] },
      },
      select: {
        id: true, customerName: true, salesNumber: true, trackingSerial: true, amount: true, creationMode: true, chargeMode: true, commercialConfirmedAt: true,
        depositConfirmed: true, prepaymentRequired: true, prepaymentConfirmed: true, tailPaymentConfirmed: true,
        productionRoutes: { where: { cancelledAt: null }, select: {
          shippedAt: true, productionArea: { select: { name: true } }, kind: true,
          productionProcesses: { select: { status: true, metricMode: true } },
          shipmentLines: { select: { isFinalBatch: true } },
        } },
        outsourceRequirementVersions: { where: { status: "APPROVED" }, orderBy: { version: "desc" }, take: 1,
          select: { lines: { select: { name: true, plannedQty: true, arrivals: { where: { voidedAt: null }, select: { quantity: true } }, shipmentLine: { select: { id: true } } } } } },
        shipments: { select: { id: true, vehicle: true, deliveredAt: true, areas: { select: { areaName: true } }, outsourceLines: { select: { id: true } } }, orderBy: { deliveredAt: "desc" } },
      },
      orderBy: { updatedAt: "desc" },
    });
    return orders.flatMap((order) => {
      const routes = order.productionRoutes.filter((route) =>
        !route.shippedAt && !route.shipmentLines.some((line) => line.isFinalBatch) && route.productionProcesses.length > 0 &&
        route.productionProcesses.every((process) => ["REFERENCE_CONFIRMATION", "PACKAGE_COUNT"].includes(process.metricMode) || process.status === "COMPLETE"));
      const outsourced = (order.outsourceRequirementVersions[0]?.lines ?? []).filter((line) =>
        !line.shipmentLine && line.arrivals.reduce((sum, arrival) => sum + Number(arrival.quantity), 0) >= Number(line.plannedQty));
      if (!routes.length && !outsourced.length && !order.shipments.length) return [];
      return [{
        orderId: order.id, customerName: order.customerName, salesNumber: order.salesNumber, trackingSerial: order.trackingSerial,
        tailPaymentConfirmed: tailPaymentSatisfied(order), readyRoutes: routes.length, readyOutsource: outsourced.length,
        readyLabels: [...routes.map((route) => `${route.productionArea.name}·${route.kind === "PANEL" ? "板式路线" : "实木油漆路线"}`), ...outsourced.map((line) => line.name)].slice(0, 3),
        shipmentCount: order.shipments.length, lastShipmentAt: order.shipments[0]?.deliveredAt ?? null,
        records: order.shipments.map((shipment) => ({ id: shipment.id, vehicle: shipment.vehicle, deliveredAt: shipment.deliveredAt,
          summary: [shipment.areas.map((area) => area.areaName).join("、"), shipment.outsourceLines.length ? `外购 ${shipment.outsourceLines.length} 项` : ""].filter(Boolean).join(" · ") || "已登记车次" })),
      }];
    });
  }

  async shipmentForm(id: string, employee: Employee) {
    if (employee.role !== "ORDER_ADMIN") throw new ForbiddenException("仅订单管理员可访问移动发货表单");
    const order = await this.prisma.order.findFirst({
      where: { id, ...orderScope(employee) },
      select: {
        id: true, trackingSerial: true, salesNumber: true, customerName: true, updatedAt: true, amount: true, creationMode: true, chargeMode: true, commercialConfirmedAt: true, depositConfirmed: true, prepaymentRequired: true, prepaymentConfirmed: true, tailPaymentConfirmed: true,
        productionRoutes: { where: { cancelledAt: null }, select: { id: true, kind: true, shippedAt: true, productionAreaId: true, productionArea: { select: { name: true, productionNumber: true } }, productionProcesses: { select: { status: true, metricMode: true } }, shipmentLines: { select: { isFinalBatch: true } } }, orderBy: [{ productionAreaId: "asc" }, { kind: "asc" }] },
        outsourceRequirementVersions: { where: { status: "APPROVED" }, orderBy: { version: "desc" }, take: 1, select: { lines: { orderBy: { sequence: "asc" }, select: { id: true, name: true, usageArea: true, plannedQty: true, unit: true, arrivals: { where: { voidedAt: null }, select: { quantity: true } }, shipmentLine: { select: { id: true } } } } } },
      },
    });
    if (!order) throw new NotFoundException("订单不存在或无权发货");
    return {
      order: { id: order.id, trackingSerial: order.trackingSerial, salesNumber: order.salesNumber, customerName: order.customerName, updatedAt: order.updatedAt },
      tailPaymentConfirmed: tailPaymentSatisfied(order),
      routes: order.productionRoutes.map((route) => ({
        id: route.id, areaId: route.productionAreaId, areaName: route.productionArea.name, productionNumber: route.productionArea.productionNumber,
        routeLabel: route.kind === "PANEL" ? "板式路线" : "实木油漆路线",
        completed: route.productionProcesses.length > 0 && route.productionProcesses.every((process) => ["REFERENCE_CONFIRMATION", "PACKAGE_COUNT"].includes(process.metricMode) || process.status === "COMPLETE"),
        batchCount: route.shipmentLines.length, finalBatchRecorded: Boolean(route.shippedAt) || route.shipmentLines.some((line) => line.isFinalBatch),
      })),
      outsourceLines: (order.outsourceRequirementVersions[0]?.lines ?? []).map((line) => ({ id: line.id, name: line.name, usageArea: line.usageArea, plannedQty: Number(line.plannedQty), arrivedQty: line.arrivals.reduce((sum, item) => sum + Number(item.quantity), 0), unit: line.unit, shipped: Boolean(line.shipmentLine) })),
    };
  }

  async paymentForm(id: string, employee: Employee) {
    if (!["FINANCE", "CHAIRMAN"].includes(employee.role)) throw new ForbiddenException("仅财务或董事长可访问移动收款核验");
    const order = await this.prisma.order.findFirst({
      where: { id, ...orderScope(employee) },
      select: {
        id: true, trackingSerial: true, salesNumber: true, customerName: true, stage: true, updatedAt: true,
        prepaymentRequired: true, depositReported: true, depositConfirmed: true, prepaymentReported: true, prepaymentConfirmed: true, tailPaymentReported: true, tailPaymentConfirmed: true,
        stageSubmissions: { where: { command: { in: ["REPORT_DEPOSIT", "REPORT_PREPAYMENT", "REPORT_TAIL_PAYMENT"] }, status: { not: "DRAFT" } }, orderBy: { createdAt: "desc" }, select: { command: true, payload: true } },
      },
    });
    if (!order) throw new NotFoundException("订单不存在或无权核验");
    const latest = new Map<string, Record<string, unknown>>();
    for (const submission of order.stageSubmissions) if (!latest.has(submission.command)) latest.set(submission.command, submission.payload as Record<string, unknown>);
    const facts = [
      { key: "DEPOSIT", label: "定金", command: "REPORT_DEPOSIT", reported: order.depositReported, confirmed: order.depositConfirmed },
      ...(order.prepaymentRequired ? [{ key: "PREPAYMENT", label: "预付款", command: "REPORT_PREPAYMENT", reported: order.prepaymentReported, confirmed: order.prepaymentConfirmed }] : []),
      { key: "TAIL", label: "尾款", command: "REPORT_TAIL_PAYMENT", reported: order.tailPaymentReported, confirmed: order.tailPaymentConfirmed },
    ].map((fact) => {
      const payload = latest.get(fact.command) ?? {};
      return { ...fact, amount: payload.receivedAmount ?? null, receivedAt: payload.receivedAt ?? null, account: payload.account ?? null, receiptAttachmentIds: employee.role === "FINANCE" && Array.isArray(payload.receiptAttachmentIds) ? payload.receiptAttachmentIds.filter((value): value is string => typeof value === "string") : [] };
    });
    const receiptIds = facts.flatMap((fact) => fact.receiptAttachmentIds);
    const receipts = receiptIds.length ? await this.prisma.attachment.findMany({ where: { id: { in: receiptIds }, orderId: order.id }, select: { id: true, originalName: true, mimeType: true, size: true } }) : [];
    const availableCommands = [
      !order.prepaymentRequired && order.depositReported && !order.depositConfirmed ? "CONFIRM_DEPOSIT" : null,
      order.prepaymentRequired && order.depositReported && order.prepaymentReported && (!order.depositConfirmed || !order.prepaymentConfirmed) ? "CONFIRM_INITIAL_PAYMENTS" : null,
      order.tailPaymentReported && !order.tailPaymentConfirmed ? "CONFIRM_TAIL_PAYMENT" : null,
    ].filter((value): value is string => Boolean(value));
    return { order: { id: order.id, trackingSerial: order.trackingSerial, salesNumber: order.salesNumber, customerName: order.customerName, updatedAt: order.updatedAt }, facts, receipts, receiptRestricted: employee.role === "CHAIRMAN", availableCommands };
  }

  async procurementForm(id: string, employee: Employee) {
    if (!["PROCUREMENT", "CHAIRMAN"].includes(employee.role)) throw new ForbiddenException("仅采购或董事长可访问移动采购确认");
    const order = await this.prisma.order.findFirst({
      where: { id, ...orderScope(employee) },
      select: {
        id: true, trackingSerial: true, salesNumber: true, customerName: true, updatedAt: true,
        procurementRouteGates: { orderBy: { kind: "asc" }, select: { id: true, kind: true, dueAt: true, completedAt: true, routes: { where: { cancelledAt: null }, select: { id: true, productionAreaId: true, releasedAt: true, productionArea: { select: { id: true, name: true, productionNumber: true } } } } } },
        productionAreas: { where: { cancelledAt: null }, orderBy: { sequence: "asc" }, select: { id: true, name: true, productionNumber: true } },
        packageCountSources: { where: { kind: "HARDWARE_AREA" }, select: { productionAreaId: true, status: true, entries: { where: { voidedAt: null }, select: { quantity: true } } } },
      },
    });
    if (!order) throw new NotFoundException("订单不存在或无权处理采购");
    const sources = new Map(order.packageCountSources.map((source) => [source.productionAreaId, source]));
    return {
      order: { id: order.id, trackingSerial: order.trackingSerial, salesNumber: order.salesNumber, customerName: order.customerName, updatedAt: order.updatedAt },
      routes: order.procurementRouteGates.map((gate) => ({ id: gate.id, kind: gate.kind, label: gate.kind === "PANEL" ? "板式路线" : "实木油漆路线", dueAt: gate.dueAt, completedAt: gate.completedAt, productionNumbers: gate.routes.map((route) => route.productionArea.productionNumber), areas: gate.routes.map((route) => ({ routeId: route.id, productionAreaId: route.productionAreaId, name: route.productionArea.name, productionNumber: route.productionArea.productionNumber, completedAt: route.releasedAt })) })),
      hardwareAreas: order.productionAreas.map((area) => { const source = sources.get(area.id); return { id: area.id, name: area.name, productionNumber: area.productionNumber, total: source?.entries.reduce((sum, entry) => sum + Number(entry.quantity), 0) ?? 0, finalized: source?.status === "FINALIZED" }; }),
    };
  }
}
