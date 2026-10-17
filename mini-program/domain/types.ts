export type MiniRole = "CHAIRMAN" | "ORDER_ADMIN" | "FINANCE" | "SALES" | "DESIGNER" | "TECHNICAL" | "PROCUREMENT" | "WORKSHOP" | "INSTALLER" | "AFTERSALES";
export type MiniTaskType =
  | "CHAIRMAN_APPROVAL"
  | "FINANCE_PAYMENT"
  | "DESIGN_INTAKE"
  | "DESIGN_TRANSFER"
  | "DESIGN_SUBMISSION"
  | "TECHNICAL_DESKTOP"
  | "PROCUREMENT_ROUTE"
  | "PROCUREMENT_PACKAGE"
  | "WORKSHOP_SUPERVISOR"
  | "SALES_CREATE"
  | "INITIAL_PAYMENT"
  | "DESIGN_REASSIGN"
  | "TAIL_PAYMENT"
  | "SHIPMENT"
  | "OUTSOURCE_ARRIVAL"
  | "DESKTOP_REVIEW"
  | "INSTALLATION"
  | "CUSTOMER_ACCEPTANCE"
  | "AFTERSALES_CASE"
  | "WORKSHOP_PROCESS";
export type TaskStatus = "READY" | "IN_PROGRESS" | "LOCKED" | "OVERDUE" | "ISSUE" | "DONE";
export type WorkshopTaskState = "ACTIONABLE" | "IN_PROGRESS" | "WAITING" | "ISSUE" | "COMPLETED_TODAY";
export type TaskUrgency = "OVERDUE" | "RUSH" | "DUE_SOON" | "NORMAL";

export interface MiniEmployee {
  id: string;
  employeeNo: string;
  username?: string;
  name: string;
  role: MiniRole;
  roleLabel: string;
  department: string;
  level?: "STAFF" | "SUPERVISOR";
  businessUnit?: string | null;
  workshop?: string | null;
  capabilities?: string[];
}

export interface NavigationItem {
  key: string;
  label: string;
  route: string;
  icon: "workspace" | "create" | "orders" | "shipment" | "installation" | "aftersales" | "tracking" | "tasks" | "scan" | "profile" | "risk" | "finance" | "design" | "technical" | "procurement" | "workshop" | "issues";
}

export interface RoleWorkspaceConfig {
  role: MiniRole;
  homeRoute: string;
  navigationItems: NavigationItem[];
  supportedTaskTypes: MiniTaskType[];
  allowedPages: string[];
}

export interface MiniWorkspaceStat {
  key: string;
  value: number;
  label: string;
  tone?: "normal" | "active" | "warning";
}

export interface MiniWorkspaceTask {
  id: string;
  type: MiniTaskType;
  orderId: string;
  trackingSerial: string;
  salesNumber: string | null;
  customerName: string;
  title: string;
  description: string;
  status: string;
  urgency: TaskUrgency;
  urgencyLabel: string;
  dueAt: string | null;
  dueLabel: string;
  actionCode: string | null;
  actionLabel: string | null;
  actionRoute: string | null;
  expectedUpdatedAt: string;
  desktopOnly?: boolean;
  presentation?: "NATIVE" | "DESKTOP_HANDOFF" | "READ_ONLY";
  desktopHandoff?: { reason: string; moduleLabel: string; identifier: string };
  meta?: Record<string, string | number | boolean | null>;
}

export interface MiniWorkspace {
  employee: MiniEmployee;
  title: string;
  subtitle: string;
  stats: MiniWorkspaceStat[];
  tasks: MiniWorkspaceTask[];
  unreadCount: number;
  serverTime: string;
  updatedAt: string;
  costModuleEnabled: boolean;
  scopeTitle?: string;
  scopeDescription?: string;
  visibleOrderCount?: number;
}

export interface MiniNotification {
  id: string;
  level: "INFO" | "WARNING" | "URGENT";
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export interface MiniAfterSalesCase {
  id: string;
  caseNumber: string;
  orderId: string;
  customerName: string;
  salesNumber: string;
  issueType: string;
  description: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  statusLabel: string;
  warrantyLabel: string;
  updatedAt: string;
  resolution?: string | null;
  costSubtotal?: number | null;
  costStatus?: string | null;
  costBatches?: MiniAfterSalesCostBatch[];
}

export interface MiniAfterSalesCostBatch {
  id: string;
  incurredOn: string;
  amount: number;
  description: string;
  recordedAt: string;
  attachmentIds?: string[];
  attachments?: Array<{ id: string; originalName: string; mimeType: string }>;
  voidedAt?: string | null;
  voidReason?: string | null;
}

export interface JourneyStage {
  key: string;
  label: string;
  state: "complete" | "current" | "future";
}

export interface MiniProductionProcess {
  id: string;
  processCode: string;
  title: string;
  workshopLabel: string;
  sequence: number;
  plannedQty?: number;
  completedQty?: number;
  unit?: string;
  dueLabel: string;
  status: TaskStatus;
  statusLabel: string;
  progressIncluded: boolean;
  canReport: boolean;
  assignedEmployeeId?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  lastReportedAt?: string | null;
}

export interface MiniWorkshopFlow {
  key: string;
  label: string;
  processes: MiniProductionProcess[];
}

export interface MiniProductionArea {
  id: string;
  name: string;
  productionNumber: string;
  routeLabel: string;
  statusLabel: string;
  dueLabel: string;
  percent: number;
  complete: boolean;
  cancelled?: boolean;
  workshopFlows: MiniWorkshopFlow[];
}

export interface MiniAreaSummary {
  total: number;
  completed: number;
  inProgress: number;
  waiting: number;
  percent: number;
}

export interface MiniOrder {
  id: string;
  businessType?: string;
  siteType?: "FINISHED" | "ROUGH";
  finishType?: "MELAMINE" | "PAINT";
  villaFloors?: number;
  productionDueAt?: string;
  parentOrderId?: string | null;
  trackingSerial: string;
  salesNumber: string | null;
  customerName: string;
  businessUnit?: string;
  salesOwnerId?: string | null;
  salesOwnerName?: string | null;
  designerOwnerId?: string | null;
  designerOwnerName?: string | null;
  brandLabel: string;
  stageLabel: string;
  stageIndex: number;
  stageTotal: number;
  currentOwnerLabel: string;
  nextAction: string;
  dueLabel: string;
  dueAt: string;
  currentTaskDueAt?: string | null;
  currentTaskDueLabel?: string;
  updatedAt: string;
  riskCount: number;
  rush?: boolean;
  journey: JourneyStage[];
  afterSalesActive?: boolean;
  afterSalesCount?: number;
  productionAreas: MiniProductionArea[];
  areaSummary: MiniAreaSummary;
  customerPhone?: string;
  address?: string;
  shipments?: MiniShipment[];
  evidenceSummary?: {
    design: { count: number; latestVersion: string | null; status: string };
    technical: { count: number; latestVersion: string | null; status: string };
    desktopOnly: true;
  };
}

export interface MiniPackageSource {
  sourceKey: string;
  kind: "HARDWARE_AREA" | "MANUFACTURED_AREA" | "MANUFACTURED_ROUTE" | "OUTSOURCED_PRODUCT";
  label: string;
  productionAreaId?: string;
  status: "OPEN" | "FINALIZED";
  total: number;
  handoffConfirmed: boolean;
  canAdd: boolean;
  canFinalize: boolean;
  canConfirmHandoff?: boolean;
  detail: string;
  entries: Array<{ id: string; quantity: number; recordedAt: string; voidedAt?: string | null }>;
}

export interface MiniPackageSummary {
  currentTotal: number;
  status: "NOT_STARTED" | "PARTIAL" | "COMPLETE" | "LEGACY_UNVERIFIED";
  hardwareTotal: number;
  manufacturedTotal: number;
  outsourcedTotal: number;
  sources: MiniPackageSource[];
}

export interface MiniShipment {
  id: string;
  vehicle: string;
  deliveredAt: string;
  assignedInstallerId: string | null;
  installationTeamLabel: string | null;
  siteContact: string | null;
  plannedInstallationAt: string | null;
  siteConditions: string | null;
  installedAt: string | null;
  areas: Array<{ areaName: string; productionNumber: string; sequence: number; isFinalBatch: boolean }>;
}

export interface MiniReferenceData {
  businessTypes: string[];
  designers: Array<{ id: string; name: string; department: string }>;
  paymentAccounts: string[];
  installers: Array<{ id: string; name: string; department: string }>;
}

export interface MiniTask {
  id: string;
  orderId: string;
  title: string;
  subtitle: string;
  workshopLabel?: string;
  customerName: string;
  salesNumber: string | null;
  productionAreaId: string;
  productionAreaName: string;
  productionNumber: string;
  routeLabel: string;
  routeId?: string;
  routeKind?: "PANEL" | "WOOD_PAINT";
  processId?: string;
  processCode?: string;
  plannedQty?: number;
  completedQty?: number;
  unit?: string;
  dueLabel: string;
  dueAt?: string;
  status: TaskStatus;
  state: WorkshopTaskState;
  statusLabel: string;
  urgency: TaskUrgency;
  urgencyLabel: string;
  waitingReason?: string | null;
  canReport: boolean;
  startedAt?: string | null;
  lastReportedAt?: string | null;
  updatedAt: string;
  orderUpdatedAt: string;
}

export interface WorkshopWorkbenchSummary {
  allUnfinished: number;
  actionable: number;
  waiting: number;
  issue: number;
  completedToday: number;
}

export interface WorkshopWorkbench {
  summary: WorkshopWorkbenchSummary;
  actionable: MiniTask[];
  allUnfinished: MiniTask[];
  completedToday: MiniTask[];
  serverTime: string;
  updatedAt: string;
}

export interface MiniTaskGroup {
  key: string;
  orderId: string;
  customerName: string;
  salesNumber: string;
  tasks: MiniTask[];
}

export type ProductionScanResolution =
  | { status: "DIRECT"; task: MiniTask; tasks: MiniTask[]; message: string }
  | { status: "MULTIPLE"; tasks: MiniTask[]; message: string }
  | { status: "WAITING"; tasks: MiniTask[]; message: string }
  | { status: "UNASSIGNED" | "CANCELLED" | "INVALID"; tasks: MiniTask[]; message: string };

export interface ProductionReportDraft {
  orderId: string;
  processId: string;
  action: "START" | "PROGRESS" | "COMPLETE" | "ISSUE";
  completedQty?: number;
  note?: string;
  attachmentPaths?: string[];
  attachmentIds?: string[];
  idempotencyKey: string;
  expectedUpdatedAt: string;
}
