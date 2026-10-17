import { areaProgressPercent, sortWorkshopTasks, summarizeProductionAreas } from "./projections";
import { createMockCaseAreas, mockRouteComplete, releaseMockRoute, unlockMockNextFlow } from "./mock-production";
import { getMockShipmentState } from "./mock-shipment-state";
import { getMockAfterSalesCases } from "./mock-aftersales";
import { formatMockProductionNumber, mockDueLabel, mockProductionDeadline, mockProductionNumberBase } from "./mock-production-rules";
import type {
  MiniEmployee,
  MiniOrder,
  MiniProductionArea,
  MiniProductionProcess,
  MiniPackageSummary,
  MiniPackageSource,
  MiniTask,
  ProductionReportDraft,
  ProductionScanResolution,
  TaskStatus,
  TaskUrgency,
  WorkshopWorkbench,
} from "./types";

export const SESSION_KEY = "tai-mini-session";
const LOCAL_ORDERS_KEY = "tai-mini-local-orders";
const MOCK_PAYMENT_PREFIX = "tai-mini-payment:";
const MOCK_DESIGN_PREFIX = "tai-mini-design:";
const MOCK_PRE_REVIEW_PREFIX = "tai-mini-pre-review:";
const MOCK_TECHNICAL_PREFIX = "tai-mini-technical:";
const MOCK_NOTIFICATION_READ_PREFIX = "tai-mini-notification-read:";
const MOCK_PACKAGE_PREFIX = "tai-mini-package-count:";
const WORKER_ID = "TEST-WORKER-PANEL-03";
const stageNames = ["签订合同", "设计下单", "设计交付", "审单拆单", "采购准备", "生产执行", "发货", "安装", "验收完成"];
const reportResults = new Map<string, MiniTask>();
const mockEvidenceSummary = {
  design: { count: 4, latestVersion: "V2", status: "SUBMITTED" },
  technical: { count: 5, latestVersion: "T1", status: "SUBMITTED" },
  desktopOnly: true as const,
};

function statusLabel(status: TaskStatus) {
  if (status === "DONE") return "已完成";
  if (status === "READY") return "可报工";
  if (status === "IN_PROGRESS") return "加工中";
  if (status === "OVERDUE") return "已逾期·可报工";
  if (status === "ISSUE") return "存在异常";
  return "等待前序";
}

function process(input: {
  id: string;
  title: string;
  workshopLabel: string;
  sequence: number;
  status?: TaskStatus;
  completedQty?: number;
  plannedQty?: number;
  unit?: string;
  progressIncluded?: boolean;
  assignedEmployeeId?: string;
}): MiniProductionProcess {
  const status = input.status ?? "LOCKED";
  return {
    id: input.id,
    processCode: input.id,
    title: input.title,
    workshopLabel: input.workshopLabel,
    sequence: input.sequence,
    status,
    statusLabel: statusLabel(status),
    completedQty: input.completedQty,
    plannedQty: input.plannedQty,
    unit: input.unit,
    dueLabel: "车间最晚完成",
    progressIncluded: input.progressIncluded ?? true,
    canReport: ["READY", "IN_PROGRESS", "OVERDUE", "ISSUE"].includes(status) && input.assignedEmployeeId === WORKER_ID,
    assignedEmployeeId: input.assignedEmployeeId,
    startedAt: input.completedQty ? "2026-09-13T09:20:00+08:00" : null,
    lastReportedAt: input.completedQty ? "2026-09-13T09:25:00+08:00" : null,
  };
}

function panelFlow(
  prefix: string,
  plannedQty: number,
  state: "CHILD" | "WARDROBE" | "BATHROOM",
  drillOverride?: { status: TaskStatus; completedQty?: number },
) {
  const statuses: Record<string, TaskStatus> = state === "CHILD"
    ? { cut: "DONE", edge: "DONE", drill: "READY" }
    : state === "WARDROBE"
      ? { cut: "DONE", edge: "READY", drill: "LOCKED" }
      : { cut: "READY", edge: "LOCKED", drill: "LOCKED" };
  if (drillOverride) statuses.drill = drillOverride.status;
  const drillCompleted = drillOverride?.completedQty ?? (state === "CHILD" ? 18 : 0);
  return {
    key: "PANEL",
    label: "板式车间",
    processes: [
      process({ id: `${prefix}-panel-cut`, title: "开料", workshopLabel: "板式车间", sequence: 1, status: statuses.cut, completedQty: statuses.cut === "DONE" ? plannedQty : 0, plannedQty, unit: "㎡" }),
      process({ id: `${prefix}-panel-edge`, title: "封边", workshopLabel: "板式车间", sequence: 2, status: statuses.edge, completedQty: statuses.edge === "DONE" ? plannedQty : state === "WARDROBE" ? 12 : 0, plannedQty, unit: "㎡" }),
      process({ id: `${prefix}-panel-drill`, title: "打孔", workshopLabel: "板式车间", sequence: 3, status: statuses.drill, completedQty: drillCompleted, plannedQty, unit: "㎡", assignedEmployeeId: WORKER_ID }),
      process({ id: `${prefix}-panel-trim`, title: "清洗修边", workshopLabel: "板式车间", sequence: 4, completedQty: 0, plannedQty, unit: "㎡" }),
      process({ id: `${prefix}-panel-inspect`, title: "品检并送组装", workshopLabel: "板式车间", sequence: 5, completedQty: 0, plannedQty, unit: "㎡" }),
    ],
  };
}

function woodFlow(prefix: string, plannedQty: number) {
  return {
    key: "WOOD",
    label: "木工车间",
    processes: [
      process({ id: `${prefix}-wood-cut`, title: "开料", workshopLabel: "木工车间", sequence: 1, status: "READY", completedQty: 6, plannedQty, unit: "㎡" }),
      process({ id: `${prefix}-wood-veneer`, title: "贴皮", workshopLabel: "木工车间", sequence: 2, completedQty: 0, plannedQty, unit: "㎡" }),
      process({ id: `${prefix}-wood-make`, title: "制作1＋制作2＋送油漆", workshopLabel: "木工车间", sequence: 3, completedQty: 0, plannedQty, unit: "㎡" }),
    ],
  };
}

function paintFlow(prefix: string, plannedQty: number) {
  return {
    key: "PAINT",
    label: "油漆车间",
    processes: [
      process({ id: `${prefix}-paint-sand`, title: "白坯打磨＋两次油磨", workshopLabel: "油漆车间", sequence: 1, completedQty: 0, plannedQty, unit: "㎡" }),
      process({ id: `${prefix}-paint-spray`, title: "两次喷底漆＋喷面漆", workshopLabel: "油漆车间", sequence: 2, completedQty: 0, plannedQty, unit: "㎡" }),
      process({ id: `${prefix}-paint-inspect`, title: "品检并送组装", workshopLabel: "油漆车间", sequence: 3, completedQty: 0, plannedQty, unit: "㎡" }),
    ],
  };
}

function assemblyFlow(prefix: string, plannedQty: number) {
  return {
    key: "ASSEMBLY",
    label: "组装车间",
    processes: [
      process({ id: `${prefix}-assembly-pack`, title: "打包", workshopLabel: "组装车间", sequence: 1, completedQty: 0, plannedQty, unit: "㎡" }),
      process({ id: `${prefix}-assembly-hardware`, title: "领五金", workshopLabel: "组装车间", sequence: 2, progressIncluded: false }),
      process({ id: `${prefix}-assembly-stock`, title: "入库", workshopLabel: "组装车间", sequence: 3, completedQty: 0, plannedQty: 1, unit: "项", progressIncluded: false }),
      process({ id: `${prefix}-assembly-finish`, title: "订单生产完成", workshopLabel: "组装车间", sequence: 4 }),
    ],
  };
}

function finalizeArea(area: Omit<MiniProductionArea, "percent" | "complete" | "statusLabel">): MiniProductionArea {
  const draft = { ...area, percent: 0, complete: false, statusLabel: "待生产" };
  draft.percent = areaProgressPercent(draft);
  draft.complete = draft.workshopFlows.flatMap((flow) => flow.processes).filter((item) => item.progressIncluded).every((item) => item.status === "DONE");
  draft.statusLabel = draft.complete ? "已完成" : draft.percent > 0 ? "生产中" : "待生产";
  return draft;
}

const zhouAreas: MiniProductionArea[] = [
  finalizeArea({ id: "area-child", name: "儿童房", productionNumber: "TEST-DEMO-AREA-01", routeLabel: "板式路线", dueLabel: "09月16日", workshopFlows: [panelFlow("child", 32, "CHILD"), assemblyFlow("child", 32)] }),
  finalizeArea({ id: "area-wardrobe", name: "衣帽间", productionNumber: "TEST-DEMO-AREA-02", routeLabel: "板式路线＋实木油漆路线", dueLabel: "09月16日", workshopFlows: [panelFlow("wardrobe", 46, "WARDROBE"), woodFlow("wardrobe", 18), paintFlow("wardrobe", 18), assemblyFlow("wardrobe", 64)] }),
  finalizeArea({ id: "area-bathroom", name: "卫生间", productionNumber: "TEST-DEMO-AREA-03", routeLabel: "板式路线", dueLabel: "09月16日", workshopFlows: [panelFlow("bathroom", 14, "BATHROOM"), assemblyFlow("bathroom", 14)] }),
];

const linAreas: MiniProductionArea[] = [
  finalizeArea({ id: "area-lin-living", name: "客厅", productionNumber: "TEST-DEMO-AREA-04", routeLabel: "板式路线", dueLabel: "09月12日", workshopFlows: [panelFlow("lin-living", 28, "CHILD", { status: "OVERDUE", completedQty: 0 }), assemblyFlow("lin-living", 28)] }),
  finalizeArea({ id: "area-lin-study", name: "书房", productionNumber: "TEST-DEMO-AREA-05", routeLabel: "板式路线", dueLabel: "09月12日", workshopFlows: [panelFlow("lin-study", 21, "CHILD", { status: "OVERDUE", completedQty: 8 }), assemblyFlow("lin-study", 21)] }),
  finalizeArea({ id: "area-lin-master", name: "主卧", productionNumber: "TEST-DEMO-AREA-06", routeLabel: "板式路线", dueLabel: "09月12日", workshopFlows: [panelFlow("lin-master", 37, "CHILD", { status: "OVERDUE", completedQty: 0 }), assemblyFlow("lin-master", 37)] }),
];

function journey() {
  return stageNames.map((label, index) => ({
    key: `stage-${index + 1}`,
    label,
    state: index < 5 ? "complete" as const : index === 5 ? "current" as const : "future" as const,
  }));
}

const zhouOrder: MiniOrder = {
  id: "TEST-DEMO-ZHOU-ORDER-001", trackingSerial: "TEST-DEMO-ZHOU-ORDER-001", salesNumber: "TEST-SALES-ZHOU-001", businessType: "NOERLI_FORMAL",
  customerName: "周女士", brandLabel: "诺尔丽正单", businessUnit: "NOERLI", salesOwnerId: "TEST-SALES-NORLI-01", salesOwnerName: "销售郑佳", designerOwnerId: "TEST-DESIGNER-01", designerOwnerName: "设计师郑思雁", stageLabel: "生产执行", stageIndex: 6, stageTotal: 9,
  currentOwnerLabel: "板式车间、木工车间", nextAction: "儿童房打孔；衣帽间封边", dueLabel: "09月16日",
  dueAt: "2026-09-16T17:00:00+08:00", updatedAt: "2026-09-13T09:30:00+08:00", riskCount: 0, rush: false,
  journey: journey(), productionAreas: zhouAreas, areaSummary: summarizeProductionAreas(zhouAreas),
  evidenceSummary: mockEvidenceSummary,
};

const linOrder: MiniOrder = {
  id: "TEST-DEMO-LIN-ORDER-002", trackingSerial: "TEST-DEMO-LIN-ORDER-002", salesNumber: "N26090019", businessType: "NOERLI_FORMAL",
  customerName: "林先生", brandLabel: "诺尔丽正单", businessUnit: "NOERLI", salesOwnerId: "TEST-SALES-NORLI-02", salesOwnerName: "销售陈珊", designerOwnerId: "TEST-DESIGNER-02", designerOwnerName: "设计师林若溪", stageLabel: "生产执行", stageIndex: 6, stageTotal: 9,
  currentOwnerLabel: "板式车间", nextAction: "客厅、书房、主卧打孔", dueLabel: "09月12日",
  dueAt: "2026-09-12T17:00:00+08:00", updatedAt: "2026-09-13T09:35:00+08:00", riskCount: 0, rush: false,
  journey: journey(), productionAreas: linAreas, areaSummary: summarizeProductionAreas(linAreas),
  evidenceSummary: mockEvidenceSummary,
};

const fangOrder: MiniOrder = {
  id: "TEST-DEMO-MINI-001", trackingSerial: "TEST-DEMO-MINI-001", salesNumber: "N26090018", businessType: "NOERLI_FORMAL", customerName: "方女士",
  brandLabel: "诺尔丽正单", businessUnit: "NOERLI", salesOwnerId: "TEST-SALES-NORLI-01", salesOwnerName: "销售郑佳", designerOwnerId: "TEST-DESIGNER-01", designerOwnerName: "设计师郑思雁", stageLabel: "生产执行", stageIndex: 6, stageTotal: 9, currentOwnerLabel: "板式车间",
  nextAction: "历史样例待复核", dueLabel: "09月16日", dueAt: "2026-09-16T17:00:00+08:00",
  updatedAt: "2026-09-11T09:30:00+08:00", riskCount: 1, rush: false, journey: journey(), productionAreas: [],
  areaSummary: { total: 0, completed: 0, inProgress: 0, waiting: 0, percent: 0 },
  evidenceSummary: mockEvidenceSummary,
};

const aikejuOrders: MiniOrder[] = [
  { ...fangOrder, id: "TEST-DEMO-AIKEJU-001", trackingSerial: "TEST-AIKEJU-GD-001", salesNumber: "A26090001", businessType: "AIKEJU_FORMAL", customerName: "赵女士", brandLabel: "艾可居正单", businessUnit: "AIKEJU", salesOwnerId: "TEST-SALES-AIKEJU-01", salesOwnerName: "艾可居测试销售员1", designerOwnerId: "TEST-DESIGNER-01", designerOwnerName: "设计师郑思雁", stageLabel: "设计待接单", stageIndex: 2, currentOwnerLabel: "设计师", nextAction: "设计师接单", riskCount: 0 },
  { ...fangOrder, id: "TEST-DEMO-AIKEJU-002", trackingSerial: "TEST-AIKEJU-GD-002", salesNumber: null, businessType: "AIKEJU_FORMAL", customerName: "顾先生", brandLabel: "艾可居正单", businessUnit: "AIKEJU", salesOwnerId: "TEST-SALES-AIKEJU-02", salesOwnerName: "艾可居测试销售员2", designerOwnerId: "TEST-DESIGNER-02", designerOwnerName: "设计师林若溪", stageLabel: "签订合同", stageIndex: 1, currentOwnerLabel: "所属销售", nextAction: "补充预付款资料", riskCount: 0 },
];

const orders = [zhouOrder, linOrder, fangOrder, ...aikejuOrders];
const workshopEmployee: MiniEmployee = { id: WORKER_ID, employeeNo: "W103", username: "paneldrill", name: "板式打孔工", role: "WORKSHOP", roleLabel: "板式车间工人", department: "板式车间", level: "STAFF", workshop: "PANEL" };

export const mockEmployees: MiniEmployee[] = [
  { id: "TEST-CHAIRMAN-01", employeeNo: "A001", username: "chairman", name: "董事长管理员", role: "CHAIRMAN", roleLabel: "董事长管理员", department: "管理层", level: "STAFF" },
  { id: "TEST-SALES-NORLI-01", employeeNo: "S001", username: "sales", name: "销售郑佳", role: "SALES", roleLabel: "诺尔丽销售员", department: "诺尔丽销售部", level: "STAFF", businessUnit: "NOERLI" },
  { id: "TEST-SALES-NORLI-02", employeeNo: "S002", username: "sales2", name: "销售陈珊", role: "SALES", roleLabel: "诺尔丽销售员", department: "诺尔丽销售部", level: "STAFF", businessUnit: "NOERLI" },
  { id: "TEST-SALES-NORLI-MANAGER", employeeNo: "S010", username: "salesmanager", name: "诺尔丽销售主管", role: "SALES", roleLabel: "诺尔丽销售主管", department: "诺尔丽销售部", level: "SUPERVISOR", businessUnit: "NOERLI" },
  { id: "TEST-SALES-AIKEJU-01", employeeNo: "S201", username: "aikejusales1", name: "艾可居测试销售员1", role: "SALES", roleLabel: "艾可居销售员", department: "艾可居销售部", level: "STAFF", businessUnit: "AIKEJU" },
  { id: "TEST-SALES-AIKEJU-02", employeeNo: "S202", username: "aikejusales2", name: "艾可居测试销售员2", role: "SALES", roleLabel: "艾可居销售员", department: "艾可居销售部", level: "STAFF", businessUnit: "AIKEJU" },
  { id: "TEST-SALES-AIKEJU-MANAGER", employeeNo: "S020", username: "aikejumgr", name: "艾可居销售主管", role: "SALES", roleLabel: "艾可居销售主管", department: "艾可居销售部", level: "SUPERVISOR", businessUnit: "AIKEJU" },
  { id: "TEST-SALES-NORLI-03", employeeNo: "S101", username: "noerlisales1", name: "诺尔丽测试销售员1", role: "SALES", roleLabel: "诺尔丽销售员", department: "诺尔丽销售部", level: "STAFF", businessUnit: "NOERLI" },
  { id: "TEST-SALES-NORLI-04", employeeNo: "S102", username: "noerlisales2", name: "诺尔丽测试销售员2", role: "SALES", roleLabel: "诺尔丽销售员", department: "诺尔丽销售部", level: "STAFF", businessUnit: "NOERLI" },
  { id: "TEST-ORDER-ADMIN-01", employeeNo: "A002", username: "orderadmin", name: "订单管理员", role: "ORDER_ADMIN", roleLabel: "订单管理员", department: "订单中心", level: "STAFF" },
  { id: "TEST-FINANCE-01", employeeNo: "F001", username: "finance", name: "财务王姐", role: "FINANCE", roleLabel: "财务人员", department: "财务部", level: "STAFF" },
  { id: "TEST-DESIGNER-01", employeeNo: "D001", username: "designer", name: "设计师郑思雁", role: "DESIGNER", roleLabel: "设计师", department: "设计部", level: "STAFF" },
  { id: "TEST-DESIGNER-02", employeeNo: "D002", username: "designer2", name: "设计师林若溪", role: "DESIGNER", roleLabel: "设计师", department: "设计部", level: "STAFF" },
  { id: "TEST-TECHNICAL-01", employeeNo: "T001", username: "technical", name: "技术陈工", role: "TECHNICAL", roleLabel: "技术拆单员", department: "技术部", level: "STAFF" },
  { id: "TEST-PROCUREMENT-01", employeeNo: "P001", username: "procurement", name: "采购李姐", role: "PROCUREMENT", roleLabel: "采购人员", department: "采购部", level: "STAFF" },
  { id: "TEST-WORKSHOP-SUPERVISOR", employeeNo: "W001", username: "workshop", name: "板式车间主管", role: "WORKSHOP", roleLabel: "板式车间主管", department: "板式车间", level: "SUPERVISOR", workshop: "PANEL" },
  { id: "TEST-INSTALLER-01", employeeNo: "I001", username: "installer", name: "赵师傅", role: "INSTALLER", roleLabel: "安装一组", department: "安装部", level: "STAFF" },
  { id: "TEST-INSTALLER-02", employeeNo: "I002", username: "installer2", name: "孙师傅", role: "INSTALLER", roleLabel: "安装二组", department: "安装部", level: "STAFF" },
  { id: "TEST-AFTERSALES-01", employeeNo: "C001", username: "aftersales", name: "售后客服", role: "AFTERSALES", roleLabel: "售后专员", department: "售后部", level: "STAFF" },
  workshopEmployee,
  ...([
    ["W002", "woodmanager", "木工车间主管", "WOOD", "木工车间"],
    ["W003", "paintmanager", "油漆车间主管", "PAINT", "油漆车间"],
    ["W004", "assemblymanager", "组装车间主管", "ASSEMBLY", "组装车间"],
  ] as const).map(([employeeNo, username, name, workshop, department]) => ({ id: `TEST-${employeeNo}`, employeeNo, username, name, role: "WORKSHOP" as const, roleLabel: name, department, level: "SUPERVISOR" as const, workshop })),
  ...([
    ["W101", "panelcut", "板式开料工", "PANEL", "板式车间"], ["W102", "paneledge", "板式封边工", "PANEL", "板式车间"],
    ["W104", "panelclean", "板式清洗修边工", "PANEL", "板式车间"], ["W105", "panelquality", "板式品检转运工", "PANEL", "板式车间"],
    ["W201", "woodcut", "木工开料工", "WOOD", "木工车间"], ["W202", "woodveneer", "木工贴皮工", "WOOD", "木工车间"], ["W203", "woodmake", "木工制作转运工", "WOOD", "木工车间"],
    ["W301", "paintsand", "油漆打磨工", "PAINT", "油漆车间"], ["W302", "paintspray", "油漆喷漆工", "PAINT", "油漆车间"], ["W303", "paintquality", "油漆品检转运工", "PAINT", "油漆车间"],
    ["W401", "assemblyworker", "组装综合工", "ASSEMBLY", "组装车间"],
  ] as const).map(([employeeNo, username, name, workshop, department]) => ({ id: `TEST-${employeeNo}`, employeeNo, username, name, role: "WORKSHOP" as const, roleLabel: name, department, level: "STAFF" as const, workshop })),
];

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function findProcess(processId: string) {
  for (const order of [...getOrders().filter((item) => item.trackingSerial.startsWith("TEST-DEMO-GD-")), ...orders]) for (const area of order.productionAreas) for (const flow of area.workshopFlows) {
    const found = flow.processes.find((item) => item.id === processId);
    if (found) return { order, area, flow, process: found };
  }
  return undefined;
}

function taskUrgency(order: MiniOrder, item: MiniProductionProcess): TaskUrgency {
  if (item.status === "OVERDUE" || new Date(order.dueAt).getTime() < Date.now()) return "OVERDUE";
  if (order.rush) return "RUSH";
  if (new Date(order.dueAt).getTime() - Date.now() <= 24 * 60 * 60 * 1000) return "DUE_SOON";
  return "NORMAL";
}

function urgencyLabel(urgency: TaskUrgency) {
  return urgency === "OVERDUE" ? "已逾期" : urgency === "RUSH" ? "加急" : urgency === "DUE_SOON" ? "24小时内到期" : "按计划";
}

function waitingReason(area: MiniProductionArea, item: MiniProductionProcess) {
  for (const flow of area.workshopFlows) {
    const index = flow.processes.findIndex((candidate) => candidate.id === item.id);
    if (index > 0) {
      const previous = flow.processes[index - 1];
      if (previous && previous.status !== "DONE") return `等待${previous.title}完成`;
    }
  }
  return "等待前序工序完成";
}

function toTask(order: MiniOrder, area: MiniProductionArea, flow: MiniProductionArea["workshopFlows"][number], item: MiniProductionProcess): MiniTask {
  const employee = getSession();
  const supervisorOwns = employee.role === "WORKSHOP" && employee.level === "SUPERVISOR" && item.workshopLabel === employee.department;
  const canReport = ["READY", "IN_PROGRESS", "OVERDUE", "ISSUE"].includes(item.status) && (item.assignedEmployeeId === employee.id || supervisorOwns);
  const state = item.status === "DONE" ? "COMPLETED_TODAY"
    : item.status === "LOCKED" ? "WAITING"
      : item.status === "ISSUE" ? "ISSUE"
        : item.status === "IN_PROGRESS" || Number(item.completedQty) > 0 ? "IN_PROGRESS" : "ACTIONABLE";
  const urgency = taskUrgency(order, item);
  const reason = state === "WAITING" ? waitingReason(area, item) : null;
  return {
    id: item.id,
    orderId: order.id,
    title: item.title,
    subtitle: item.statusLabel,
    workshopLabel: item.workshopLabel,
    customerName: order.customerName,
    salesNumber: order.salesNumber,
    productionAreaId: area.id,
    productionAreaName: area.name,
    productionNumber: area.productionNumber,
    routeLabel: flow.key === "WOOD" || flow.key === "PAINT" || flow.key === "ASSEMBLY_WOOD_PAINT" ? "实木油漆路线" : flow.key === "PANEL" || flow.key === "ASSEMBLY_PANEL" ? "板式路线" : area.routeLabel,
    routeId: `${area.id}-${flow.key === "WOOD" || flow.key === "PAINT" || flow.key === "ASSEMBLY_WOOD_PAINT" ? "wood-paint" : "panel"}`,
    routeKind: flow.key === "WOOD" || flow.key === "PAINT" || flow.key === "ASSEMBLY_WOOD_PAINT" ? "WOOD_PAINT" : "PANEL",
    processId: item.id,
    processCode: item.processCode,
    plannedQty: item.plannedQty,
    completedQty: item.completedQty,
    unit: item.unit,
    dueLabel: `车间最晚完成 · ${order.dueLabel}`,
    dueAt: order.dueAt,
    status: item.status,
    state,
    statusLabel: state === "WAITING" ? reason ?? "等待前序" : statusLabel(item.status),
    urgency,
    urgencyLabel: urgencyLabel(urgency),
    waitingReason: reason,
    canReport,
    startedAt: item.startedAt,
    lastReportedAt: item.lastReportedAt,
    updatedAt: item.lastReportedAt ?? order.updatedAt,
    orderUpdatedAt: order.updatedAt,
  };
}

function refreshArea(order: MiniOrder, area: MiniProductionArea) {
  area.percent = areaProgressPercent(area);
  area.complete = area.workshopFlows.flatMap((flow) => flow.processes).filter((item) => item.progressIncluded).every((item) => item.status === "DONE");
  area.statusLabel = area.complete ? "已完成" : area.percent > 0 ? "生产中" : "待生产";
  order.areaSummary = summarizeProductionAreas(order.productionAreas);
}

export function initializeMockSession() {
  const existing = wx.getStorageSync<MiniEmployee | null>(SESSION_KEY);
  if (existing?.role === ("INSTALLATION" as MiniEmployee["role"])) wx.setStorageSync(SESSION_KEY, mockEmployees.find((item) => item.role === "INSTALLER"));
}

export function getSession(): MiniEmployee { return wx.getStorageSync<MiniEmployee>(SESSION_KEY) || workshopEmployee; }
export function getStoredSession(): MiniEmployee | null { return wx.getStorageSync<MiniEmployee>(SESSION_KEY) || null; }
export function setMockSession(employeeId: string): MiniEmployee {
  const employee = mockEmployees.find((item) => item.id === employeeId);
  if (!employee) throw new Error("测试账号不存在");
  wx.setStorageSync(SESSION_KEY, employee);
  return employee;
}
export function saveSession(employee: MiniEmployee) { wx.setStorageSync(SESSION_KEY, employee); }
export function clearSession() {
  for (const key of wx.getStorageInfoSync().keys) if (key.startsWith("tai-mini-") && key !== LOCAL_ORDERS_KEY && key !== "tai-mini-aftersales-cases" && !key.startsWith(MOCK_PAYMENT_PREFIX) && !key.startsWith(MOCK_DESIGN_PREFIX) && !key.startsWith(MOCK_PRE_REVIEW_PREFIX) && !key.startsWith(MOCK_TECHNICAL_PREFIX) && !key.startsWith(MOCK_NOTIFICATION_READ_PREFIX) && !key.startsWith(MOCK_PACKAGE_PREFIX) && !key.startsWith("tai-mini-hardware:") && !key.startsWith("tai-mini-shipment-state:")) wx.removeStorageSync(key);
}
export function getOrders(): MiniOrder[] {
  const saved = wx.getStorageSync<MiniOrder[]>(LOCAL_ORDERS_KEY);
  if (Array.isArray(saved)) {
    migrateMockSalesNumbers(saved);
    migrateMockProductionNumbers(saved);
    migrateMockAssemblyMilestones(saved);
  }
  return clone([...(Array.isArray(saved) ? saved : []), ...orders].map((order) => {
    const projected = projectMockOrder(order);
    const shipments = getMockShipmentState(order.id).shipments;
    return shipments.length ? { ...projected, shipments: [...shipments, ...(projected.shipments ?? [])] } : projected;
  }));
}
export function getOrder(id: string): MiniOrder | undefined { return getOrders().find((item) => item.id === id); }

export interface MockReceipt {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  savedFilePath: string;
}
export interface MockPaymentFact {
  amount: number;
  receivedAt: string;
  account: string;
  receipt: MockReceipt;
}
export interface MockInitialPayments {
  contractAmount: number;
  deposit: MockPaymentFact;
  prepayment: MockPaymentFact;
}
export interface MockPaymentState extends MockInitialPayments {
  status: "AWAITING_FINANCE" | "AWAITING_DESIGN" | "DESIGN_ACCEPTED";
  updatedAt: string;
  designAcceptedAt?: string;
  designLeadDays?: number;
  designDueAt?: string;
  tail?: MockPaymentFact;
  tailConfirmedAt?: string;
}

export interface MockDesignFile { id: string; category: string; originalName: string; mimeType: string; size: number; savedFilePath: string }
export interface MockDesignState { payload: Record<string, unknown>; files: MockDesignFile[]; submitted: boolean; updatedAt: string; salesNumber?: string }
export function getMockDesignState(orderId: string): MockDesignState | null { return wx.getStorageSync<MockDesignState>(`${MOCK_DESIGN_PREFIX}${orderId}`) || null; }
export function getMockPreReviewState(orderId: string): { approvedAt: string } | null { return wx.getStorageSync<{ approvedAt: string }>(`${MOCK_PRE_REVIEW_PREFIX}${orderId}`) || null; }

export interface MockTechnicalState {
  phase: "TECH_REVIEW" | "PROCUREMENT" | "PRODUCTION";
  submittedAt: string;
  reviewedAt?: string;
  panelReleasedAt?: string;
  woodPaintReleasedAt?: string;
  updatedAt: string;
}
export function getMockTechnicalState(orderId: string): MockTechnicalState | null {
  return wx.getStorageSync<MockTechnicalState>(`${MOCK_TECHNICAL_PREFIX}${orderId}`) || null;
}

function saveMockAreas(orderId: string, productionAreas: MiniProductionArea[], updatedAt: string): void {
  const saved = wx.getStorageSync<MiniOrder[]>(LOCAL_ORDERS_KEY);
  if (!Array.isArray(saved) || !saved.some((item) => item.id === orderId)) throw new Error("本机订单不存在");
  wx.setStorageSync(LOCAL_ORDERS_KEY, saved.map((item) => item.id === orderId
    ? { ...item, productionAreas, areaSummary: summarizeProductionAreas(productionAreas), updatedAt } : item));
}

type MockPackageRecord = { entries: Array<{ id: string; quantity: number; recordedAt: string }>; finalizedAt?: string; handoffConfirmedAt?: string };
type MockPackageLedger = Record<string, MockPackageRecord>;

function migrateMockAssemblyMilestones(saved: MiniOrder[]): void {
  let changed = false;
  for (const order of saved.filter((item) => item.trackingSerial.startsWith("TEST-DEMO-GD-"))) {
    const ledger = wx.getStorageSync<MockPackageLedger>(`${MOCK_PACKAGE_PREFIX}${order.id}`) || {};
    for (const area of order.productionAreas) {
      for (const flow of area.workshopFlows.filter((item) => item.key.startsWith("ASSEMBLY"))) {
        for (const item of flow.processes.filter((process) => ["ASSEMBLY-02", "ASSEMBLY-03"].includes(process.processCode))) {
          const confirmed = item.processCode === "ASSEMBLY-02"
            ? Boolean(ledger[`HARDWARE_AREA:${area.id}`]?.handoffConfirmedAt)
            : Boolean(ledger[`MANUFACTURED_ROUTE:${area.id}-${flow.key}`]?.finalizedAt);
          const nextStatus = confirmed ? "DONE" : "LOCKED";
          if (item.progressIncluded || item.canReport || item.status !== nextStatus || item.plannedQty !== 1 || item.unit !== "项") {
            item.progressIncluded = false; item.canReport = false; item.plannedQty = 1; item.completedQty = confirmed ? 1 : 0; item.unit = "项";
            item.status = nextStatus; item.statusLabel = confirmed ? "已完成" : "在包件台账办理";
            if (!confirmed) item.completedAt = null;
            changed = true;
          }
        }
        const packing = flow.processes.find((item) => item.processCode === "ASSEMBLY-01");
        const finish = flow.processes.find((item) => item.processCode === "ASSEMBLY-04");
        if (packing?.status === "DONE" && finish?.status === "LOCKED") { finish.status = "READY"; finish.statusLabel = "可报工"; changed = true; }
      }
      area.percent = areaProgressPercent(area);
      area.complete = area.workshopFlows.flatMap((flow) => flow.processes).filter((item) => item.progressIncluded).every((item) => item.status === "DONE");
      area.statusLabel = area.complete ? "已完成" : area.percent > 0 ? "生产中" : "待生产";
    }
    order.areaSummary = summarizeProductionAreas(order.productionAreas);
  }
  if (changed) wx.setStorageSync(LOCAL_ORDERS_KEY, saved);
}

export function getMockPackageSummary(orderId: string): MiniPackageSummary {
  const order = getOrder(orderId);
  if (!order) throw new Error("订单不存在");
  const ledger = wx.getStorageSync<MockPackageLedger>(`${MOCK_PACKAGE_PREFIX}${orderId}`) || {};
  const hardware = wx.getStorageSync<Record<string, number>>(`tai-mini-hardware:${orderId}`) || {};
  const sources: MiniPackageSource[] = [];
  for (const area of order.productionAreas) {
    const hardwareKey = `HARDWARE_AREA:${area.id}`;
    const hardwareFinalized = Object.prototype.hasOwnProperty.call(hardware, area.id);
    sources.push({ sourceKey: hardwareKey, kind: "HARDWARE_AREA", label: `${area.name}·五金包`, productionAreaId: area.id,
      status: hardwareFinalized ? "FINALIZED" : "OPEN", total: hardware[area.id] ?? 0,
      handoffConfirmed: Boolean(ledger[hardwareKey]?.handoffConfirmedAt), canAdd: false, canFinalize: false,
      canConfirmHandoff: hardwareFinalized && !ledger[hardwareKey]?.handoffConfirmedAt,
      detail: hardwareFinalized ? "采购已确认，待组装领用" : "待采购登记并最终确认本区域五金包数", entries: [] });
    for (const flow of area.workshopFlows.filter((candidate) => candidate.key.startsWith("ASSEMBLY"))) {
      const key = `MANUFACTURED_ROUTE:${area.id}-${flow.key}`;
      const record = ledger[key];
      const packed = flow.processes.some((item) => item.processCode === "ASSEMBLY-01" && item.status === "DONE");
      sources.push({ sourceKey: key, kind: "MANUFACTURED_ROUTE", label: `${area.name}·${flow.key.includes("WOOD_PAINT") ? "实木油漆" : "板式"}路线·自产成品入库`, productionAreaId: area.id,
        status: record?.finalizedAt ? "FINALIZED" : "OPEN", total: (record?.entries ?? []).reduce((sum, entry) => sum + entry.quantity, 0),
        handoffConfirmed: false, canAdd: packed && !record?.finalizedAt, canFinalize: packed && !record?.finalizedAt,
        detail: packed ? "打包已完成，可逐次累计包件并最终确认" : "待对应路线完成组装打包", entries: record?.entries ?? [] });
    }
  }
  const hardwareTotal = sources.filter((source) => source.kind === "HARDWARE_AREA").reduce((sum, source) => sum + source.total, 0);
  const manufacturedTotal = sources.filter((source) => source.kind === "MANUFACTURED_ROUTE").reduce((sum, source) => sum + source.total, 0);
  return { sources, hardwareTotal, manufacturedTotal, outsourcedTotal: 0, currentTotal: hardwareTotal + manufacturedTotal,
    status: sources.length && sources.every((source) => source.status === "FINALIZED") ? "COMPLETE" : hardwareTotal + manufacturedTotal ? "PARTIAL" : "NOT_STARTED" };
}

export function runMockPackageCountCommand(orderId: string, sourceKey: string, command: "ADD_COUNT" | "FINALIZE_SOURCE" | "CONFIRM_HARDWARE_HANDOFF", quantity?: number): MiniPackageSummary {
  const employee = getStoredSession();
  if (employee?.role !== "WORKSHOP" || employee.workshop !== "ASSEMBLY") throw new Error("只有组装车间可办理包件与五金领用");
  const order = getOrder(orderId);
  if (!order || !order.trackingSerial.startsWith("TEST-DEMO-GD-") || !getMockTechnicalState(orderId)) throw new Error("仅已技术拆单的本机测试订单可模拟包件统计");
  const source = getMockPackageSummary(orderId).sources.find((item) => item.sourceKey === sourceKey);
  if (!source) throw new Error("包件来源不存在");
  const ledger = wx.getStorageSync<MockPackageLedger>(`${MOCK_PACKAGE_PREFIX}${orderId}`) || {};
  const record = ledger[sourceKey] ?? { entries: [] };
  const now = new Date().toISOString();
  if (command === "CONFIRM_HARDWARE_HANDOFF") {
    if (source.kind !== "HARDWARE_AREA" || !source.canConfirmHandoff) throw new Error("请等待采购最终确认五金包数，或该区域已领用");
    record.handoffConfirmedAt = now;
    for (const flow of order.productionAreas.find((area) => area.id === source.productionAreaId)?.workshopFlows ?? []) {
      for (const item of flow.processes.filter((candidate) => candidate.processCode === "ASSEMBLY-02")) {
        item.status = "DONE"; item.statusLabel = "已领用"; item.completedQty = 1; item.completedAt = now;
      }
    }
  } else {
    if (source.kind === "HARDWARE_AREA" || source.status !== "OPEN") throw new Error("当前包件来源不可由组装车间修改");
    if (command === "ADD_COUNT") {
      if (!source.canAdd) throw new Error(source.detail);
      if (!Number.isInteger(quantity) || !quantity || quantity <= 0) throw new Error("本次追加包件数须为大于0的整数");
      record.entries.push({ id: `TEST-PACKAGE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, quantity, recordedAt: now });
    } else {
      if (!source.canFinalize || source.total <= 0) throw new Error("请先完成打包并登记实际包件数");
      record.finalizedAt = now;
      const flow = order.productionAreas.find((area) => area.id === source.productionAreaId)?.workshopFlows.find((candidate) => sourceKey.endsWith(`-${candidate.key}`));
      for (const item of flow?.processes.filter((candidate) => candidate.processCode === "ASSEMBLY-03") ?? []) {
        item.status = "DONE"; item.statusLabel = "已入库"; item.completedQty = 1; item.completedAt = now;
      }
    }
  }
  ledger[sourceKey] = record;
  wx.setStorageSync(`${MOCK_PACKAGE_PREFIX}${orderId}`, ledger);
  saveMockAreas(orderId, order.productionAreas, now);
  return getMockPackageSummary(orderId);
}

function migrateMockProductionNumbers(saved: MiniOrder[]): void {
  const used = new Map<string, number>();
  for (const order of saved) for (const area of order.productionAreas) {
    const match = /^TEST-(?:补单-B)?(\d{5})(\d{3})$/.exec(area.productionNumber);
    if (match) used.set(match[1]!, Math.max(used.get(match[1]!) ?? 0, Number(match[2])));
  }
  let changed = false;
  for (const order of [...saved].reverse()) {
    const assignedAt = getMockTechnicalState(order.id)?.submittedAt ?? getMockDesignState(order.id)?.updatedAt ?? order.updatedAt;
    if (!order.businessType) continue;
    const base = mockProductionNumberBase(order, assignedAt);
    for (const area of order.productionAreas) {
      if (!area.productionNumber.startsWith("TEST-AREA-")) continue;
      const next = (used.get(base) ?? 0) + 1;
      area.productionNumber = formatMockProductionNumber(order, assignedAt, next);
      used.set(base, next);
      changed = true;
    }
  }
  if (changed) wx.setStorageSync(LOCAL_ORDERS_KEY, saved);
}

function nextMockProductionNumbers(order: MiniOrder, assignedAt: string, count: number): string[] {
  const saved = wx.getStorageSync<MiniOrder[]>(LOCAL_ORDERS_KEY) ?? [];
  const base = mockProductionNumberBase(order, assignedAt);
  const existing = (Array.isArray(saved) ? saved : []).flatMap((item) => item.productionAreas)
    .map((area) => /^TEST-(?:补单-B)?(\d{5})(\d{3})$/.exec(area.productionNumber))
    .filter((match): match is RegExpExecArray => Boolean(match && match[1] === base))
    .map((match) => Number(match[2]));
  const last = Math.max(0, ...existing);
  return Array.from({ length: count }, (_, index) => formatMockProductionNumber(order, assignedAt, last + index + 1));
}

export function submitMockTechnicalSplit(orderId: string): MiniOrder {
  const employee = getStoredSession();
  const order = getOrder(orderId);
  if (employee?.role !== "TECHNICAL") throw new Error("只有技术拆单员可模拟技术拆单");
  if (!order?.trackingSerial.startsWith("TEST-DEMO-GD-") || !getMockPreReviewState(orderId)) throw new Error("请先完成本机前置审单测试");
  if (getMockTechnicalState(orderId)) throw new Error("技术拆单已模拟提交");
  const now = new Date().toISOString();
  const areas = createMockCaseAreas(orderId, order.dueLabel, nextMockProductionNumbers(order, now, 3));
  saveMockAreas(orderId, areas, now);
  wx.setStorageSync(`${MOCK_TECHNICAL_PREFIX}${orderId}`, { phase: "TECH_REVIEW", submittedAt: now, updatedAt: now } satisfies MockTechnicalState);
  return getOrder(orderId)!;
}

export function approveMockTechnicalReview(orderId: string): MiniOrder {
  const employee = getStoredSession();
  const state = getMockTechnicalState(orderId);
  if (employee?.role !== "ORDER_ADMIN") throw new Error("只有订单管理员可模拟技术审单");
  if (state?.phase !== "TECH_REVIEW") throw new Error("当前没有待审核的本机技术拆单");
  const now = new Date().toISOString();
  wx.setStorageSync(`${MOCK_TECHNICAL_PREFIX}${orderId}`, { ...state, phase: "PROCUREMENT", reviewedAt: now, updatedAt: now } satisfies MockTechnicalState);
  return getOrder(orderId)!;
}

export function completeMockProcurementRoute(orderId: string, kind: "PANEL" | "WOOD_PAINT"): MiniOrder {
  const employee = getStoredSession();
  const state = getMockTechnicalState(orderId);
  const order = getOrder(orderId);
  if (employee?.role !== "PROCUREMENT") throw new Error("只有采购人员可模拟路线放行");
  if (!state || !["PROCUREMENT", "PRODUCTION"].includes(state.phase) || !order?.productionAreas.length) throw new Error("请先完成本机技术审单测试");
  if (kind === "PANEL" && state.panelReleasedAt || kind === "WOOD_PAINT" && state.woodPaintReleasedAt) throw new Error("这条采购路线已经放行");
  if (!order.productionAreas.some((area) => area.workshopFlows.some((flow) => flow.key === (kind === "PANEL" ? "PANEL" : "WOOD")))) throw new Error("订单没有这条生产路线");
  const now = new Date().toISOString();
  releaseMockRoute(order.productionAreas, kind);
  saveMockAreas(orderId, order.productionAreas, now);
  wx.setStorageSync(`${MOCK_TECHNICAL_PREFIX}${orderId}`, {
    ...state, phase: "PRODUCTION", updatedAt: now,
    ...(kind === "PANEL" ? { panelReleasedAt: now } : { woodPaintReleasedAt: now }),
  } satisfies MockTechnicalState);
  return getOrder(orderId)!;
}

export function approveMockPreReview(orderId: string): MiniOrder {
  const employee = getStoredSession();
  const order = getOrder(orderId);
  if (employee?.role !== "ORDER_ADMIN") throw new Error("只有订单管理员可模拟前置审单通过");
  if (!order?.trackingSerial.startsWith("TEST-DEMO-GD-") || !getMockDesignState(orderId)?.submitted) throw new Error("仅已提交设计资料的本机订单可模拟前置审单");
  if (getMockPreReviewState(orderId)) throw new Error("本机前置审单已经模拟通过");
  wx.setStorageSync(`${MOCK_PRE_REVIEW_PREFIX}${orderId}`, { approvedAt: new Date().toISOString() });
  return getOrder(orderId)!;
}

const mockSalesPrefixes: Record<string, string> = { NOERLI: "N", AIKEJU: "A", CHANNEL: "C", ENGINEERING: "E", WORKWEAR: "W" };
function mockSalesNumber(order: MiniOrder, submittedAt: string): string {
  const prefix = mockSalesPrefixes[order.businessUnit ?? ""];
  if (!prefix) throw new Error("订单品牌无法生成测试销售编号");
  const monthParts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "2-digit", month: "2-digit" }).formatToParts(new Date(submittedAt));
  const month = `${monthParts.find((part) => part.type === "year")?.value ?? ""}${monthParts.find((part) => part.type === "month")?.value ?? ""}`;
  const leading = `TEST-${prefix}${month}`;
  const existing = wx.getStorageInfoSync().keys.filter((key) => key.startsWith(MOCK_DESIGN_PREFIX) && key !== `${MOCK_DESIGN_PREFIX}${order.id}`)
    .map((key) => wx.getStorageSync<MockDesignState>(key)?.salesNumber ?? "")
    .filter((value) => value.startsWith(leading) && /^TEST-[NACEW]\d{8}$/.test(value))
    .map((value) => Number(value.slice(-4)));
  const next = Math.max(0, ...existing) + 1;
  if (next > 9999) throw new Error("本月测试销售编号已满");
  return `${leading}${String(next).padStart(4, "0")}`;
}

function migrateMockSalesNumbers(savedOrders: MiniOrder[]): void {
  const pending = savedOrders.map((order) => ({ order, design: getMockDesignState(order.id) }))
    .filter((entry): entry is { order: MiniOrder; design: MockDesignState } => Boolean(entry.design?.submitted && !entry.design.salesNumber))
    .sort((a, b) => a.design.updatedAt.localeCompare(b.design.updatedAt));
  for (const { order, design } of pending) wx.setStorageSync(`${MOCK_DESIGN_PREFIX}${order.id}`, {
    ...design, salesNumber: mockSalesNumber(order, design.updatedAt),
  } satisfies MockDesignState);
}

export function getMockPaymentState(orderId: string): MockPaymentState | null {
  return wx.getStorageSync<MockPaymentState>(`${MOCK_PAYMENT_PREFIX}${orderId}`) || null;
}

export function mockTailPaymentReady(order: MiniOrder): boolean {
  return order.trackingSerial.startsWith("TEST-DEMO-GD-") && getMockTechnicalState(order.id)?.phase === "PRODUCTION"
    && order.productionAreas.some((area) => mockRouteComplete(area, "PANEL") || mockRouteComplete(area, "WOOD_PAINT"));
}

export function reportMockTailPayment(orderId: string, fact: MockPaymentFact): MiniOrder {
  const employee = getStoredSession();
  const order = getOrder(orderId);
  const payment = getMockPaymentState(orderId);
  if (!order || !payment || !mockTailPaymentReady(order) || employee?.role !== "SALES" || order.salesOwnerId !== employee.id) throw new Error("只有所属销售可在生产路线完工后报备尾款");
  if (payment.tail || payment.tailConfirmedAt) throw new Error("尾款已经报备或核验");
  const receivable = payment.contractAmount - payment.deposit.amount - payment.prepayment.amount;
  if (!Number.isFinite(fact.amount) || fact.amount <= 0 || fact.amount !== receivable) throw new Error("尾款金额应等于合同金额减去已核验首付款");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fact.receivedAt) || !fact.account.trim() || !fact.receipt.savedFilePath) throw new Error("请填写到账日期、收款账户并保存凭证");
  wx.setStorageSync(`${MOCK_PAYMENT_PREFIX}${orderId}`, { ...payment, tail: fact, updatedAt: new Date().toISOString() } satisfies MockPaymentState);
  return getOrder(orderId)!;
}

export function confirmMockTailPayment(orderId: string, payload: Record<string, unknown>): MiniOrder {
  const employee = getStoredSession();
  const order = getOrder(orderId);
  const payment = getMockPaymentState(orderId);
  if (employee?.role !== "FINANCE" || !order || !payment?.tail || payment.tailConfirmedAt || !mockTailPaymentReady(order)) throw new Error("当前订单没有可核验的尾款报备");
  if (payload.verified !== true) throw new Error("请确认尾款实际到账");
  const now = new Date().toISOString();
  wx.setStorageSync(`${MOCK_PAYMENT_PREFIX}${orderId}`, { ...payment, tailConfirmedAt: now, updatedAt: now } satisfies MockPaymentState);
  return getOrder(orderId)!;
}

function projectMockOrder(order: MiniOrder): MiniOrder {
  if (!order.trackingSerial.startsWith("TEST-DEMO-GD-")) return order;
  const payment = getMockPaymentState(order.id);
  const design = getMockDesignState(order.id);
  const review = design?.submitted ? getMockPreReviewState(order.id) : null;
  const technical = getMockTechnicalState(order.id);
  const inferredFinish = order.finishType ?? (order.productionAreas.some((area) => area.workshopFlows.some((flow) => flow.key === "WOOD" || flow.key === "PAINT")) ? "PAINT" : "MELAMINE");
  const productionDueAt = design?.submitted ? order.productionDueAt ?? mockProductionDeadline({ ...order, finishType: inferredFinish }, design.updatedAt) : undefined;
  const productionDueLabel = productionDueAt ? mockDueLabel(productionDueAt) : null;
  const productionComplete = technical?.phase === "PRODUCTION" && order.productionAreas.length > 0 && order.productionAreas.every((area) => area.complete);
  const shipmentState = getMockShipmentState(order.id);
  const afterSalesCases = shipmentState.acceptance ? getMockAfterSalesCases().filter((item) => item.orderId === order.id) : [];
  const afterSalesActive = afterSalesCases.some((item) => item.status !== "RESOLVED");
  const routeIds = order.productionAreas.flatMap((area) => [
    area.workshopFlows.some((flow) => flow.key === "PANEL" || flow.key === "ASSEMBLY_PANEL") ? `${area.id}:PANEL` : null,
    area.workshopFlows.some((flow) => flow.key === "WOOD" || flow.key === "PAINT" || flow.key === "ASSEMBLY_WOOD_PAINT") ? `${area.id}:WOOD_PAINT` : null,
  ].filter((id): id is string => Boolean(id)));
  const allRoutesShipped = productionComplete && routeIds.length > 0 && routeIds.every((id) => shipmentState.routeBatches[id]?.final);
  const manufacturedShipments = shipmentState.shipments.filter((item) => item.areas.length > 0);
  const allInstallationsComplete = allRoutesShipped && manufacturedShipments.length > 0 && manufacturedShipments.every((item) => Boolean(item.installedAt));
  const stageIndex = allInstallationsComplete ? 9 : allRoutesShipped ? 8 : productionComplete ? 7 : technical?.phase === "PRODUCTION" ? 6 : technical?.phase === "PROCUREMENT" ? 5 : design?.submitted ? 4 : !payment || payment.status === "AWAITING_FINANCE" ? 1 : payment.status === "AWAITING_DESIGN" ? 2 : 3;
  const readyForTail = mockTailPaymentReady(order);
  const currentOwnerLabel = shipmentState.acceptance ? "售后服务" : allInstallationsComplete ? "安装部 / 订单管理员" : allRoutesShipped ? "安装部" : readyForTail && !payment?.tailConfirmedAt ? payment?.tail ? "财务部" : order.salesOwnerName || "所属销售" : productionComplete ? "订单管理员" : technical?.phase === "PRODUCTION" ? "已放行路线的四车间" : technical?.phase === "PROCUREMENT" ? "采购部" : technical?.phase === "TECH_REVIEW" ? "订单管理员" : review ? "技术部" : design?.submitted ? "订单管理员" : !payment ? order.salesOwnerName || "所属销售" : payment.status === "AWAITING_FINANCE" ? "财务部" : order.designerOwnerName || "指定设计师";
  const nextAction = shipmentState.acceptance ? "客户验收已归档" : allInstallationsComplete ? "全部车次安装已完成，等待客户签字验收" : allRoutesShipped ? `全部生产路线已发货，安装部处理 ${manufacturedShipments.filter((item) => !item.installedAt).length} 个车次` : readyForTail && !payment?.tailConfirmedAt ? payment?.tail ? "财务核验尾款实际到账，核验前不能发货" : "所属销售报备尾款到账与凭证，财务核验后可发货" : readyForTail && payment?.tailConfirmedAt ? "已完工路线可分批登记发货" : productionComplete ? "三区域生产已完成，等待发货安排" : technical?.phase === "PRODUCTION" ? "四车间按已放行路线逐工序报工" : technical?.phase === "PROCUREMENT" ? "采购分别放行板式与实木油漆路线" : technical?.phase === "TECH_REVIEW" ? "订单管理员技术审单" : review ? "技术拆单需在电脑端完成" : design?.submitted ? "订单管理员前置审单" : !payment ? order.businessType?.endsWith("_SUPPLEMENT") ? "核对补单商务和收款事实" : "补报定金与预付款并上传凭证" : payment.status === "AWAITING_FINANCE" ? "财务核验定金与预付款到账" : payment.status === "AWAITING_DESIGN" ? "设计师下单" : "设计师提交设计资料";
  const stageLabel = shipmentState.acceptance ? "验收完成" : allInstallationsComplete ? "待客户验收" : allRoutesShipped ? "安装" : technical?.phase === "TECH_REVIEW" ? "技术审单" : technical?.phase === "PRODUCTION" ? productionComplete ? "发货" : "生产执行" : technical?.phase === "PROCUREMENT" ? "采购准备" : review ? "技术拆单" : stageNames[stageIndex - 1];
  const employee = getStoredSession();
  const productionAreas = order.productionAreas.map((area) => ({ ...area, dueLabel: productionDueLabel ?? area.dueLabel, workshopFlows: area.workshopFlows.map((flow) => ({ ...flow, processes: flow.processes.map((item) => ({ ...item, dueLabel: productionDueLabel ?? item.dueLabel, canReport: Boolean(employee?.role === "WORKSHOP" && ["READY", "IN_PROGRESS", "OVERDUE", "ISSUE"].includes(item.status) && (item.assignedEmployeeId === employee.id || employee.level === "SUPERVISOR" && item.workshopLabel === employee.department)) })) })) }));
  return { ...order, stageLabel, stageIndex: afterSalesCases.length ? stageNames.length + 1 : stageIndex, stageTotal: afterSalesCases.length ? stageNames.length + 1 : stageNames.length, currentOwnerLabel: afterSalesActive ? "售后服务" : shipmentState.acceptance ? "已履约" : currentOwnerLabel, nextAction: afterSalesActive ? "售后人员处理问题并记录结果" : nextAction, afterSalesActive, afterSalesCount: afterSalesCases.length, productionAreas, areaSummary: summarizeProductionAreas(productionAreas),
    dueAt: productionDueAt ?? order.dueAt, dueLabel: productionDueLabel ?? order.dueLabel, productionDueAt,
    salesNumber: design?.submitted ? design.salesNumber ?? `TEST-SALES-${order.trackingSerial.slice(13)}` : order.salesNumber,
    evidenceSummary: design?.submitted ? { design: { count: design.files.length, latestVersion: String(design.payload.designVersion ?? ""), status: "SUBMITTED" }, technical: { count: 0, latestVersion: technical ? "模拟T1" : null, status: technical ? "MOCK_SUBMITTED" : "PENDING" }, desktopOnly: true } : order.evidenceSummary,
    updatedAt: [order.updatedAt, payment?.updatedAt, design?.updatedAt, review?.approvedAt, technical?.updatedAt, shipmentState.acceptance?.recordedAt, ...shipmentState.shipments.map((item) => item.deliveredAt), ...shipmentState.installationReports.map((item) => item.recordedAt)].filter((value): value is string => Boolean(value)).sort().reverse()[0]!,
    journey: [...stageNames.map((label, index) => ({ key: `stage-${index + 1}`, label, state: shipmentState.acceptance || index < stageIndex - 1 ? "complete" as const : index === stageIndex - 1 ? "current" as const : "future" as const })), ...(afterSalesCases.length ? [{ key: "AFTERSALES", label: "售后", state: afterSalesActive ? "current" as const : "complete" as const }] : [])] };
}

export function reportMockSalesPayments(orderId: string, initialPayments: MockInitialPayments): MiniOrder {
  const employee = getStoredSession();
  const order = getOrder(orderId);
  if (!employee || employee.role !== "SALES" || !order || order.salesOwnerId !== employee.id || !order.trackingSerial.startsWith("TEST-DEMO-GD-") || order.businessType?.endsWith("_SUPPLEMENT")) throw new Error("只有所属销售可以补报本机演示正单的首付款");
  if (getMockPaymentState(orderId)) throw new Error("首付款已经报备，不能重复提交");
  if (!(initialPayments.contractAmount > 0) || !(initialPayments.deposit.amount > 0) || !(initialPayments.prepayment.amount > 0) || initialPayments.deposit.amount + initialPayments.prepayment.amount > initialPayments.contractAmount) throw new Error("首付款金额不符合合同金额");
  if (!initialPayments.deposit.receipt.savedFilePath || !initialPayments.prepayment.receipt.savedFilePath) throw new Error("定金和预付款均需上传凭证");
  wx.setStorageSync(`${MOCK_PAYMENT_PREFIX}${orderId}`, { ...initialPayments, status: "AWAITING_FINANCE", updatedAt: new Date().toISOString() } satisfies MockPaymentState);
  return getOrder(orderId)!;
}

export function confirmMockInitialPayments(orderId: string, payload: Record<string, unknown>): MiniOrder {
  const employee = getStoredSession();
  const payment = getMockPaymentState(orderId);
  if (employee?.role !== "FINANCE" || !payment || payment.status !== "AWAITING_FINANCE") throw new Error("当前订单没有可核验的首付款");
  if (payload.depositVerified !== true || payload.prepaymentVerified !== true) throw new Error("请分别确认定金和预付款实际到账");
  wx.setStorageSync(`${MOCK_PAYMENT_PREFIX}${orderId}`, { ...payment, status: "AWAITING_DESIGN", updatedAt: new Date().toISOString() } satisfies MockPaymentState);
  return getOrder(orderId)!;
}

export function acceptMockDesign(orderId: string, payload: Record<string, unknown>): MiniOrder {
  const employee = getStoredSession();
  const order = getOrder(orderId);
  const payment = getMockPaymentState(orderId);
  if (employee?.role !== "DESIGNER" || !order || order.designerOwnerId !== employee.id || !payment || payment.status !== "AWAITING_DESIGN") throw new Error("当前设计任务不可接单");
  const leadDays = Number(payload.designLeadDays);
  if (!Number.isInteger(leadDays) || leadDays < 1 || leadDays > 7 || payload.scopeConfirmed !== true) throw new Error("请确认合同范围并填写1至7个工作日");
  const now = new Date();
  const dueDate = new Date(now);
  let counted = 0;
  while (counted < leadDays) {
    dueDate.setUTCDate(dueDate.getUTCDate() + 1);
    if (new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", weekday: "short" }).format(dueDate) !== "Sun") counted++;
  }
  const dueAt = dueDate.toISOString();
  wx.setStorageSync(`${MOCK_PAYMENT_PREFIX}${orderId}`, { ...payment, status: "DESIGN_ACCEPTED", designAcceptedAt: now.toISOString(), designLeadDays: leadDays, designDueAt: dueAt, updatedAt: now.toISOString() } satisfies MockPaymentState);
  return getOrder(orderId)!;
}

export function transferMockDesign(orderId: string, payload: Record<string, unknown>): MiniOrder {
  const employee = getStoredSession();
  const order = getOrder(orderId);
  const payment = getMockPaymentState(orderId);
  if (employee?.role !== "DESIGNER" || !order || order.designerOwnerId !== employee.id || payment?.status !== "DESIGN_ACCEPTED" || getMockDesignState(orderId)?.submitted) throw new Error("当前设计任务不可转交");
  const target = mockEmployees.find((item) => item.id === payload.designerId && item.role === "DESIGNER");
  if (!target || target.id === employee.id || String(payload.reason ?? "").trim().length < 2) throw new Error("请选择另一名设计师并填写转交原因");
  const saved = wx.getStorageSync<MiniOrder[]>(LOCAL_ORDERS_KEY);
  if (!Array.isArray(saved) || !saved.some((item) => item.id === orderId)) throw new Error("只能转交已保存的本机设计任务");
  wx.setStorageSync(LOCAL_ORDERS_KEY, saved.map((item) => item.id === orderId ? { ...item, designerOwnerId: target.id, designerOwnerName: target.name, updatedAt: new Date().toISOString() } : item));
  return getOrder(orderId)!;
}

export function saveMockDesign(orderId: string, payload: Record<string, unknown>, files: MockDesignFile[], submitted: boolean): MiniOrder {
  const employee = getStoredSession();
  const order = getOrder(orderId);
  const payment = getMockPaymentState(orderId);
  if (employee?.role !== "DESIGNER" || !order || order.designerOwnerId !== employee.id || payment?.status !== "DESIGN_ACCEPTED" || getMockDesignState(orderId)?.submitted) throw new Error("当前设计任务不可提交");
  if (submitted && (!String(payload.designVersion ?? "").trim() || !payload.surveyedAt || !payload.customerConfirmedAt || !Array.isArray(payload.cadAttachmentIds) || !payload.cadAttachmentIds.length || !Array.isArray(payload.confirmationAttachmentIds) || !payload.confirmationAttachmentIds.length || Array.isArray(payload.sampleBlockAttachmentIds) && payload.sampleBlockAttachmentIds.length > 0 && !String(payload.sampleBlockRemark ?? "").trim())) throw new Error("请填写必填信息、上传CAD与客户确认图，并补齐样块备注");
  if (submitted) {
    const referenced = [payload.cadAttachmentIds, payload.confirmationAttachmentIds, payload.sampleBlockAttachmentIds].flatMap((ids) => Array.isArray(ids) ? ids : []);
    if (referenced.some((id) => !files.some((file) => file.id === id))) throw new Error("设计文件尚未完整保存，请重新上传并保存草稿");
  }
  const updatedAt = new Date().toISOString();
  const existing = getMockDesignState(orderId);
  const salesNumber = submitted ? existing?.salesNumber ?? mockSalesNumber(order, updatedAt) : existing?.salesNumber;
  wx.setStorageSync(`${MOCK_DESIGN_PREFIX}${orderId}`, { payload, files, submitted, updatedAt, salesNumber } satisfies MockDesignState);
  return getOrder(orderId)!;
}

export function createMockSalesOrder(input: {
  businessType: string; parentOrderId?: string; customerName: string; customerPhone: string; address: string;
  promisedDate: string; designerId: string; rush: boolean; initialPayments?: MockInitialPayments;
  siteType?: "FINISHED" | "ROUGH"; finishType?: "MELAMINE" | "PAINT"; villaFloors?: number;
}): MiniOrder {
  const employee = getStoredSession();
  if (!employee || employee.role !== "SALES" || !employee.businessUnit) throw new Error("请先选择销售测试账号");
  if (!input.businessType.startsWith(`${employee.businessUnit}_`)) throw new Error("只能创建所属品牌的订单");
  const supplement = input.businessType.endsWith("_SUPPLEMENT");
  const parent = supplement ? getOrder(input.parentOrderId ?? "") : undefined;
  if (supplement && (!parent || parent.businessUnit !== employee.businessUnit || parent.businessType?.endsWith("_SUPPLEMENT") || (employee.level !== "SUPERVISOR" && parent.salesOwnerId !== employee.id))) throw new Error("请选择权限范围内的同品牌正单");
  const designer = mockEmployees.find((item) => item.id === (parent?.designerOwnerId ?? input.designerId) && item.role === "DESIGNER");
  if (!designer) throw new Error("请选择设计师");
  if (input.initialPayments && (!(input.initialPayments.contractAmount > 0) || !(input.initialPayments.deposit.amount > 0) || !(input.initialPayments.prepayment.amount > 0) || input.initialPayments.deposit.amount + input.initialPayments.prepayment.amount > input.initialPayments.contractAmount || !input.initialPayments.deposit.receipt.savedFilePath || !input.initialPayments.prepayment.receipt.savedFilePath)) throw new Error("签约首付款金额或凭证不完整");
  const now = new Date().toISOString();
  const serial = `TEST-DEMO-GD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const brand = { NOERLI: "诺尔丽", AIKEJU: "艾可居", CHANNEL: "渠道", ENGINEERING: "工程", WORKWEAR: "工装" }[employee.businessUnit] ?? employee.businessUnit;
  const order: MiniOrder = {
    id: serial, trackingSerial: serial, businessType: input.businessType, parentOrderId: parent?.id ?? null,
    siteType: parent?.siteType ?? input.siteType ?? "FINISHED", finishType: parent?.finishType ?? input.finishType ?? "MELAMINE", villaFloors: parent?.villaFloors ?? input.villaFloors ?? 0,
    salesNumber: null, customerName: parent?.customerName ?? input.customerName,
    customerPhone: parent?.customerPhone ?? input.customerPhone, address: parent?.address ?? input.address,
    businessUnit: employee.businessUnit, salesOwnerId: parent?.salesOwnerId ?? employee.id, salesOwnerName: parent?.salesOwnerName ?? employee.name,
    designerOwnerId: designer.id, designerOwnerName: designer.name,
    brandLabel: `${brand}${supplement ? "补单" : "正单"}`, stageLabel: "签订合同", stageIndex: 1, stageTotal: stageNames.length,
    currentOwnerLabel: employee.name, nextAction: "补报定金与预付款并上传凭证",
    dueLabel: input.promisedDate, dueAt: `${input.promisedDate}T17:00:00+08:00`, updatedAt: now,
    riskCount: 0, rush: input.rush, journey: stageNames.map((label, index) => ({ key: `stage-${index + 1}`, label, state: index === 0 ? "current" as const : "future" as const })),
    productionAreas: [], areaSummary: { total: 0, completed: 0, inProgress: 0, waiting: 0, percent: 0 },
  };
  const saved = wx.getStorageSync<MiniOrder[]>(LOCAL_ORDERS_KEY);
  wx.setStorageSync(LOCAL_ORDERS_KEY, [order, ...(Array.isArray(saved) ? saved : [])]);
  if (input.initialPayments) return reportMockSalesPayments(order.id, input.initialPayments);
  return getOrder(order.id)!;
}

function assignedTasks() {
  const employee = getSession();
  return sortWorkshopTasks(getOrders().filter((order) => !order.trackingSerial.startsWith("TEST-DEMO-GD-") || order.stageIndex >= 6).flatMap((order) => order.productionAreas.flatMap((area) => area.workshopFlows.flatMap((flow) => {
    const technical = getMockTechnicalState(order.id);
    const woodPaint = ["WOOD", "PAINT", "ASSEMBLY_WOOD_PAINT"].includes(flow.key);
    if (technical && !(woodPaint ? technical.woodPaintReleasedAt : technical.panelReleasedAt)) return [];
    return flow.processes
      .filter((item) => !["ASSEMBLY-02", "ASSEMBLY-03"].includes(item.processCode))
      .filter((item) => employee.level === "SUPERVISOR" ? flow.label === employee.department : item.assignedEmployeeId === employee.id)
      .map((item) => toTask(order, area, flow, item));
  }))));
}

export function getTasks(): MiniTask[] { return assignedTasks().filter((task) => task.status !== "DONE"); }

export function getTask(id: string): MiniTask | undefined { return getTasks().find((item) => item.id === id); }

export function getMockWorkshopWorkbench(): WorkshopWorkbench {
  const allUnfinished = getTasks();
  const actionable = allUnfinished.filter((task) => task.canReport);
  const serverTime = new Date().toISOString();
  const today = serverTime.slice(0, 10);
  const completedToday = assignedTasks().filter((task) => task.status === "DONE" && task.updatedAt.slice(0, 10) === today);
  const updatedValues = getOrders().map((order) => order.updatedAt).sort();
  return clone({
    summary: {
      allUnfinished: allUnfinished.length,
      actionable: actionable.length,
      waiting: allUnfinished.filter((task) => task.state === "WAITING").length,
      issue: allUnfinished.filter((task) => task.state === "ISSUE").length,
      completedToday: completedToday.length,
    },
    actionable,
    allUnfinished,
    completedToday,
    serverTime,
    updatedAt: updatedValues[updatedValues.length - 1] ?? serverTime,
  });
}

export function resolveMockProductionNumber(productionNumber: string): ProductionScanResolution {
  const areaMatch = getOrders().flatMap((order) => order.productionAreas.map((area) => ({ order, area }))).find(({ area }) => area.productionNumber === productionNumber);
  if (!areaMatch) return { status: "INVALID", tasks: [], message: "二维码无效或生产区域不存在" };
  if (areaMatch.area.cancelled) return { status: "CANCELLED", tasks: [], message: "该生产区域已取消，不能继续报工" };
  const tasks = getTasks().filter((task) => task.productionAreaId === areaMatch.area.id);
  if (!tasks.length) return { status: "UNASSIGNED", tasks: [], message: "该区域没有分配给当前账号的未完成工序" };
  const actionable = tasks.filter((task) => task.canReport);
  if (actionable.length === 1) return { status: "DIRECT", task: actionable[0]!, tasks: actionable, message: "已找到可报工工序" };
  if (actionable.length > 1) return { status: "MULTIPLE", tasks: actionable, message: "请选择要报工的具体工序" };
  return { status: "WAITING", tasks, message: tasks[0]?.waitingReason ?? "当前工序尚未解锁" };
}

export function submitProductionReport(draft: ProductionReportDraft): MiniTask {
  const previousResult = reportResults.get(draft.idempotencyKey);
  if (previousResult) return clone(previousResult);
  const found = findProcess(draft.processId);
  if (!found || found.order.id !== draft.orderId) throw new Error("没有找到对应区域工序");
  const { order, area, flow, process: item } = found;
  if (["ASSEMBLY-02", "ASSEMBLY-03"].includes(item.processCode)) throw new Error("五金领用和包件入库请在组装包件台账办理");
  if ((item.processCode === "ASSEMBLY-04" || flow.key.startsWith("ASSEMBLY") && item.title === "订单生产完成") && !["COMPLETE", "ISSUE"].includes(draft.action)) throw new Error("订单生产完成只支持一键完成打卡");
  if (!["READY", "IN_PROGRESS", "OVERDUE", "ISSUE"].includes(item.status)) throw new Error("当前区域工序尚不可报工");
  if (order.trackingSerial.startsWith("TEST-DEMO-GD-") && (!getMockTechnicalState(order.id) || !toTask(order, area, flow, item).canReport)) throw new Error("当前账号没有这道工序的报工权限");
  if (draft.expectedUpdatedAt !== order.updatedAt) throw new Error("订单状态已变化，请刷新后重新确认");
  const now = new Date().toISOString();

  if (draft.action === "ISSUE") {
    if (!draft.note?.trim()) throw new Error("请填写问题说明");
    item.status = "ISSUE";
    item.statusLabel = statusLabel(item.status);
    item.startedAt = item.startedAt ?? now;
    item.lastReportedAt = now;
    order.riskCount += 1;
    order.nextAction = `处理${area.name}${item.title}异常`;
  } else if (draft.action === "START") {
    item.status = "IN_PROGRESS";
    item.statusLabel = statusLabel(item.status);
    item.startedAt = item.startedAt ?? now;
    item.lastReportedAt = now;
  } else {
    const next = draft.action === "COMPLETE" ? item.plannedQty : draft.completedQty;
    if (next == null || item.plannedQty == null || item.completedQty == null || next < item.completedQty || next > item.plannedQty) throw new Error("累计完成数量必须在当前数量与计划数量之间");
    item.completedQty = next;
    item.status = next >= item.plannedQty ? "DONE" : "IN_PROGRESS";
    item.statusLabel = statusLabel(item.status);
    item.startedAt = item.startedAt ?? now;
    item.lastReportedAt = now;
    item.completedAt = item.status === "DONE" ? now : null;
    if (item.status === "DONE") {
      const following = flow.key.startsWith("ASSEMBLY") && item.processCode === "ASSEMBLY-01"
        ? flow.processes.find((candidate) => candidate.processCode === "ASSEMBLY-04")
        : flow.processes[flow.processes.indexOf(item) + 1];
      if (following && following.status === "LOCKED") {
        following.status = "READY";
        following.statusLabel = statusLabel(following.status);
        following.canReport = following.assignedEmployeeId === WORKER_ID;
      }
      if (!following) unlockMockNextFlow(area, flow);
      order.nextAction = following ? `${area.name}完成${following.title}` : `${area.name}等待下一车间接续`;
    }
  }

  order.updatedAt = now;
  item.canReport = item.status !== "DONE" && item.assignedEmployeeId === WORKER_ID;
  refreshArea(order, area);
  if (order.trackingSerial.startsWith("TEST-DEMO-GD-")) saveMockAreas(order.id, order.productionAreas, now);
  const result = toTask(order, area, flow, item);
  reportResults.set(draft.idempotencyKey, result);
  return clone(result);
}

export function makeIdempotencyKey(prefix: string): string { return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
