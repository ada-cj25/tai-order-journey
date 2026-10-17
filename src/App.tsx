import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  App as AntApp,
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfigProvider,
  DatePicker,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Layout,
  List,
  Menu,
  Modal,
  Progress,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Timeline,
  Tooltip,
  Typography,
  Upload,
  theme,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile } from "antd/es/upload/interface";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import {
  RiAlarmWarningLine,
  RiAttachment2,
  RiArrowLeftLine,
  RiFileCopy2Line,
  RiLogoutBoxRLine,
  RiNotification3Line,
  RiSearchLine,
  RiShoppingCart2Line,
  RiShieldCheckLine,
  RiTaskLine,
  RiToolsLine,
  RiUpload2Line,
} from "@remixicon/react";
import { WorkflowActionModal, type WorkflowAction } from "./WorkflowActionModal";
import { ProcurementWorkspace } from "./ProcurementWorkspace";
import { MaterialImportWorkspace } from "./MaterialImportWorkspace";
import { TechnicalSubmissionDetails } from "./TechnicalSubmissionDetails";
import { MobileReadonly } from "./MobileReadonly";
import { formatUnitCost } from "./cost-format";
import { AccountWorkspace, MiniProgramAccounts, PasswordPanel, NumberReservations } from "./AccountWorkspace";
import { LOCAL_TEST_LOGIN_PAGE_KEY, showLocalTestAccounts } from "./local-test-access";
import { PaymentAccountManager, type PaymentAccount } from "./PaymentAccountManager";
import { OutsourceRequirementEditor } from "./OutsourceRequirementEditor";
import { InteractiveOrangeCat } from "./ScrapbookDecor";
import { LoginWeatherScene } from "./LoginWeatherScene";
import { CustomerDemoAdmin } from "./CustomerDemoAdmin";
import { shouldReleaseIdempotencyKey } from "./idempotency";
import { RESPONSIBILITY_TYPE_OPTIONS, SUPPLEMENT_TYPE_OPTIONS, responsibilityTypeLabel, supplementTypeLabel } from "./order-labels";
import { orderTimelineColor } from "./order-timeline-color";
import { orderTimelineDisplay } from "./order-timeline-display";
import "./styles.css";

const LocalTestAccounts = import.meta.env.DEV ? lazy(() => import("./LocalTestAccounts")) : null;

import { salesBusinessTypes, salesRoleLabel } from "../server/domain/sales-policy";
import { projectTechnicalAreaPlan } from "./technical-area-form";

type Employee = { id: string; employeeNo: string; username: string; name: string; department: string; role: string; level?: string; businessUnit?: string | null; workshop?: string | null; processCode?: string | null; processCodes?: string[]; mustChangePassword?: boolean; costModuleEnabled?: boolean; environment?: string; sessionClient?: "desktop" | "mobile-readonly" };
type Order = {
  id: string;
  updatedAt: string;
  trackingSerial: string;
  salesNumber?: string | null;
  productionNumber?: string | null;
  businessType: string;
  businessTypeLabel: string;
  siteType: "FINISHED" | "ROUGH";
  customerName: string;
  customerPhone?: string;
  address: string;
  amount?: string | number;
  creationMode?: "SALES_STANDARD" | "INTERNAL_EXCEPTION";
  chargeMode?: "CHARGED" | "FREE";
  creationModeLabel?: string;
  chargeModeLabel?: string;
  commercialStatus?: "NOT_APPLICABLE" | "PENDING" | "CONFIRMED";
  commercialConfirmedAt?: string | null;
  exceptionReason?: string | null;
  freeReason?: string | null;
  creator?: { id: string; name: string; role: string } | null;
  commercialConfirmer?: { id: string; name: string } | null;
  stage: string;
  stageLabel?: string;
  currentOwnerLabel: string;
  nextAction: string;
  riskCount: number;
  afterSalesActive?: boolean;
  afterSalesCount?: number;
  risks?: Array<{ id: string; type: string; title: string; description: string; impact: string; responsible: string; resolutionLabel: string; resolutionCommand?: string }>;
  signedAt: string;
  promisedAt: string;
  internalDueAt: string;
  productionDueAt?: string | null;
  designDueAt?: string | null;
  designerAssignedAt?: string | null;
  designIntakeAvailableAt?: string | null;
  designIntakeDueAt?: string | null;
  designAssignmentVersion?: number;
  designLeadDays?: number | null;
  currentTask?: { id: string; title: string; plannedStartAt?: string | null; workloadDays?: number | null; dueAt: string; status: string; delayDays: number } | null;
  finishType: "MELAMINE" | "PAINT";
  leatherDoor: boolean;
  villaFloors: number;
  rush: boolean;
  rushReason?: string;
  productionExecutionMode?: "AREA_LEGACY" | "ROUTE_V2";
  sales?: { id?: string; name: string };
  designer?: { id?: string; name: string } | null;
  shipmentGate?: { allowed: boolean; tailPaymentConfirmed: boolean; installationApplied: boolean; allProductionAreasComplete: boolean; allowedProductionRouteIds?: string[] };
  procurementRoutes?: Array<{ id: string; kind: "PANEL" | "WOOD_PAINT"; startedAt: string; dueAt: string; completedAt?: string | null; completedBy?: string | null; delayDays: number; affectedRouteIds: string[] }>;
  workflowProgress?: { steps: Array<{ key: "MATERIALS" | "PRODUCTION" | "DELIVERY"; status: "PENDING" | "BLOCKED" | "ACTIVE" | "COMPLETE"; percent: number; reason?: string | null }>; procurementPercent: number; productionPercent: number; shipmentPercent: number } | null;
  packageSummary?: {
    currentTotal: number; status: "NOT_STARTED" | "PARTIAL" | "COMPLETE" | "LEGACY_UNVERIFIED"; hardwareTotal: number; manufacturedTotal: number; outsourcedTotal: number;
    sources: Array<{ sourceKey: string; kind: "HARDWARE_AREA" | "MANUFACTURED_AREA" | "MANUFACTURED_ROUTE" | "OUTSOURCED_PRODUCT"; label: string; productionAreaId?: string; productionRouteId?: string; outsourceProductLineId?: string; status: "OPEN" | "FINALIZED"; total: number; handoffConfirmed: boolean; canAdd: boolean; canFinalize: boolean; canConfirmHandoff?: boolean; detail: string; entries: Array<{ id: string; quantity: number; recordedAt: string; voidedAt?: string | null }> }>;
    pendingSources: Array<{ sourceKey: string; label: string }>;
    legacyApplicationEstimate?: number | null; legacyShipmentPieceTotal?: number | null;
  };
  depositReported?: boolean;
  depositConfirmed?: boolean;
  prepaymentRequired?: boolean;
  prepaymentReported?: boolean;
  prepaymentConfirmed?: boolean;
  tailPaymentReported?: boolean;
  tailPaymentConfirmed?: boolean;
  paymentSummary?: { applicable?: boolean; reason?: "FREE_ORDER" | "COMMERCIAL_PENDING"; depositStatus?: "NOT_REPORTED" | "REPORTED" | "CONFIRMED"; depositReceived?: number | null; prepaymentRequired?: boolean; prepaymentStatus?: "NOT_REQUIRED" | "NOT_REPORTED" | "REPORTED" | "CONFIRMED"; prepaymentReceived?: number | null; initialPaymentTotal?: number | null; tailReceivable?: number | null; exception?: "DEPOSIT_EXCEEDS_CONTRACT" | "INITIAL_PAYMENTS_EXCEED_CONTRACT" | null } | null;
  installationApplied?: boolean;
  outsourceRequirementMode?: "UNDECLARED" | "NONE" | "REQUIRED" | "LEGACY_EXEMPT";
  outsourceRequirement?: { id: string; version: number; status: string; declaresNone: boolean; lines: Array<{ id: string; name: string; plannedQty: number; unit: string; usageArea?: string | null; note?: string | null; arrivals?: Array<{ id: string; quantity: number; arrivedOn: string; voidedAt?: string | null }>; shipmentLine?: { shipmentId: string } | null }> } | null;
  fulfillmentTracks?: {
    manufactured: { allProductionAreasComplete: boolean; shipped: boolean; installed: boolean; tailPaymentConfirmed: boolean; installationApplied: boolean; allowed: boolean; routeMode?: boolean; allowedAreaIds: string[]; allowedProductionRouteIds?: string[]; areas: Array<{ id: string; complete: boolean; batchCount: number; finalShipmentRecorded: boolean; installationComplete: boolean }> };
    outsourced: { mode: string; applicable: boolean; readyCount: number; shippedCount: number; allShipped: boolean; canShipAny: boolean; lines: Array<{ id: string; name: string; plannedQty: number; unit: string; usageArea?: string | null; note?: string | null; arrivedQty: number; remainingQty: number; arrivalStatus: string; status: string; latestArrivalOn?: string | null; canShip: boolean; arrivals: Array<{ id: string; quantity: number; arrivedOn: string; voidedAt?: string | null }> }> };
    installationCompletionAllowed: boolean;
  };
  procurementPlanned?: boolean;
  productionReady?: boolean;
  materialSubstatus?: string;
  procurementStartedAt?: string | null;
  procurementDueAt?: string | null;
  procurementCompletedAt?: string | null;
  procurementDelayDays?: number;
  materialCostStatus?: string | null;
  materialCostSubtotal?: number | string;
  materialCostTotal?: number | string | null;
  technicalPackage?: { version: number; designVersion: string; status?: string; haixunAttachmentId: string | null; decompositionAttachmentId: string | null; haixunAttachmentIds?: string[]; decompositionAttachmentIds?: string[]; materialAttachmentId: string; validationSummary: string; rowCount: number; veneerRequired?: boolean; firstBatchInstallationFee?: number | null; materialImports?: Array<{ id?: string; templateType: string; fileName: string; sheetName: string; errors?: unknown[]; normalizedRows?: any[] }>; materialVersion?: Order["materialVersion"] } | null;
  materialVersion?: { id: string; version: number; status: string; lines?: Array<{ id?: string; normalizedName: string; specification?: string | null; unit: string; actualQty: number; purchaseQty: number; sourceFileName?: string; sourceSheet?: string; sourceRow?: number; sourceSubRow?: string; templateType?: string; productionArea?: { id: string; name: string; productionNumber: string } }> } | null;
  warranty?: { automatic: boolean; years: number | null; label: string; startsAt?: string | null; expiresAt?: string | null };
  tasks?: Array<{ id: string; title: string; department: string; status: string; dueAt: string; delayDays: number }>;
  parent?: { id: string; salesNumber?: string | null; productionNumber?: string | null; trackingSerial: string } | null;
  supplements?: Array<{ id: string; salesNumber?: string | null; productionNumber?: string | null; trackingSerial: string; stage: string }>;
  supplementType?: string | null;
  responsibilityType?: string | null;
  supplementReason?: string | null;
  stageSubmissions?: Array<{ id: string; command: string; version?: string | null; status: string; payload: Record<string, unknown>; comment?: string | null; submittedAt: string }>;
  attachments?: Array<{ id: string; category: string; originalName: string; mimeType: string; size: number; createdAt: string }>;
  shipments?: Array<{ id: string; kind: "MANUFACTURED" | "OUTSOURCED"; vehicle: string; deliveredAt: string; createdAt: string; pieceCount: number | null; countBasis?: string; installationDepartment?: string | null; installationTeamLabel?: string | null; assignedInstaller?: { id: string; name: string; department: string } | null; siteContact?: string | null; plannedInstallationAt?: string | null; siteConditions?: string | null; transportCost?: number | null; installedAt?: string | null; installer?: string | null; issueConclusion?: string | null; areas: Array<{ id: string; productionAreaId: string; productionNumber: string; areaName: string; sequence: number; pieceCount?: number | null; isFinalBatch: boolean; installationFee?: number | null; routeLines?: Array<{ id: string; productionRouteId: string; routeKind: "PANEL" | "WOOD_PAINT"; routeLabel: string; sequence: number; isFinalBatch: boolean }> }> }>;
  permissions?: { canReleaseProduction: boolean; workshop?: string | null; processCode?: string | null; processCodes?: string[]; level?: string };
  production?: {
    plannedQty: number;
    completedQty: number;
    percent: number;
    complete: boolean;
    completedSteps?: number;
    totalSteps?: number;
    workshops: Record<string, { plannedQty: number; completedQty: number; percent: number; completedSteps?: number; totalSteps?: number; mixedMetrics?: boolean }>;
    processes: Array<{ id: string; productionAreaId?: string | null; productionRouteId?: string | null; workshop: string; workshopLabel: string; processCode: string; processName: string; sequence: number; plannedQty: number; completedQty: number; unit: string; metricMode?: string; status: string; note?: string | null; canReport?: boolean; available?: boolean; lockedReason?: string | null }>;
  };
  productionAreas?: Array<{
    id: string; name: string; sequence: number; productionNumber: string; status: string; cancelledAt?: string | null; productionCompletedAt?: string | null; shippedAt?: string | null; shipped?: boolean; shipmentBatches?: Array<{ id: string; sequence: number; pieceCount?: number | null; isFinalBatch: boolean; installationFee?: number | null; shipment: { id: string; deliveredAt: string; installedAt?: string | null; transportCost?: number | null } }>;
    route?: { panelEnabled: boolean; woodPaintEnabled: boolean } | null;
    routes?: Array<{ id: string; kind: "PANEL" | "WOOD_PAINT"; label: string; assemblyPlanQty: number; released: boolean; releasedAt?: string | null; complete: boolean; shipped: boolean; percent: number; shipmentBatches?: Array<{ id: string; sequence: number; isFinalBatch: boolean; shipmentAreaSequence: number; shipment: { id: string; deliveredAt: string; installedAt?: string | null } }>; production: NonNullable<Order["production"]> }>;
    production: NonNullable<Order["production"]>;
    technicalPackage?: Order["technicalPackage"];
  }>;
  areaSummary?: { total: number; completed: number; shipped: number; percent: number };
};
type MaterialCostVersion = {
  id: string;
  version: number;
  status: "WAITING_PRICE" | "COMPLETE";
  pricedSubtotal: number;
  totalCost: number | null;
  missingPriceCount: number;
  knownSubtotal: number;
  grandTotal: number | null;
  marginApplicable?: boolean;
  marginStatus?: "NOT_APPLICABLE" | "WAITING_COST" | "AVAILABLE";
  revenue?: number | null;
  grossProfit?: number | null;
  grossMarginRate?: number | null;
  overallStatus: string;
  workshop: { status: string; totalCost: number | null; areas: Array<{ id: string; name: string; productionNumber: string; totalCost: number; lines: Array<{ id: string; workshop: string; workshopLabel: string; quantity: number; unit: string; unitPriceSnapshot: number; lineTotal: number }> }> };
  installation: { status: string; installationFees: number; transportFees: number; subtotal: number; complete: boolean; batches: Array<{ id: string; batchNo: number; vehicle: string; deliveredAt: string; installedAt?: string | null; transportCost?: number | null; areas: Array<{ id: string; areaName: string; sequence: number; pieceCount?: number | null; isFinalBatch: boolean; installationFee?: number | null }> }> };
  aftersales: { status: "CUMULATIVE"; subtotal: number; batches: Array<{ id: string; caseId: string; caseNumber: string; incurredOn: string; amount: number; description: string; recordedAt: string; voidedAt?: string | null; voidReason?: string | null }> };
  outsource: { status: "COMPLETE" | "WAITING_PRICE"; subtotal: number; missingPriceCount: number; complete: boolean; lines: Array<{ id: string; name: string; usageArea?: string | null; plannedQty: number; unit: string; unitPrice: number | null; lineTotal: number | null; priceVersions: Array<{ id: string; version: number; unitPrice: number; createdAt: string; note?: string | null }> }> };
  areas?: Array<{ id: string; name: string; productionNumber: string; costVersionId: string }>;
  lines: Array<{
    id: string;
    quantity: number;
    unit: string;
    unitPriceSnapshot: number | null;
    lineTotal: number | null;
    productionArea?: { id: string; name: string; productionNumber: string };
    sourceRefs: Array<{ templateType?: string; fileName?: string; sheet?: string; row?: number; subRow?: string; rawName?: string; calculationSource?: string }>;
    costItem: { normalizedName: string; specification?: string | null };
  }>;
};
type EventItem = { id: string; title: string; description: string; type: string; createdAt: string; metadata?: Record<string, unknown> | null; actor?: { name: string; department: string } };
type AfterSalesCase = { id: string; updatedAt: string; caseNumber: string; issueType: string; description: string; warrantyYears?: number | null; status: string; costSubtotal?: number | null; costStatus?: string | null; order: { id: string; salesNumber?: string | null; trackingSerial: string; customerName: string }; costBatches?: Array<{ id: string; incurredOn: string; amount: number; description: string; recordedAt: string; attachmentIds?: string[]; voidedAt?: string | null; voidReason?: string | null }> };
type NotificationItem = { id: string; level: string; title: string; body: string; readAt?: string | null; createdAt: string };
type PublicConfig = { productName: string; environment?: string; localTestAccountsEnabled?: boolean; customerDemoEnabled?: boolean; miniProgramEnabled?: boolean; icpFilingNumber?: string | null; publicSecurityFilingNumber?: string | null; publicSecurityFilingUrl?: string | null };

const STAGES = [
  ["DEPOSIT_PENDING", "签订合同"],
  ["DESIGN_PENDING", "设计下单"],
  ["DESIGN_ACCEPTED", "设计提交"],
  ["PRE_REVIEW", "前置审单"],
  ["TECHNICAL", "技术拆单"],
  ["TECH_REVIEW", "技术审单"],
  ["MATERIALS", "物料采购"],
  ["PRODUCTION", "四车间生产"],
  ["DELIVERY", "发货"],
  ["INSTALLATION", "安装"],
  ["ACCEPTANCE", "客户验收"],
  ["BUSINESS_COMPLETE", "履约完成"],
  ["AFTERSALES", "售后"],
] as const;

const COMMANDS: Record<string, Array<{ command: string; label: string; danger?: boolean }>> = {
  DEPOSIT_PENDING: [{ command: "REPORT_DEPOSIT", label: "报备定金" }, { command: "REPORT_PREPAYMENT", label: "报备预付款" }, { command: "CONFIRM_DEPOSIT", label: "核验历史订单定金" }, { command: "CONFIRM_INITIAL_PAYMENTS", label: "同时核验定金与预付款" }],
  DESIGN_PENDING: [{ command: "ACCEPT_DESIGN", label: "设计师下单" }, { command: "RETURN_DESIGN", label: "退回销售", danger: true }, { command: "ASSIGN_DESIGNER", label: "重新分配设计师" }],
  DESIGN_ACCEPTED: [{ command: "SUBMIT_DESIGN", label: "正式提交并生成销售编号" }, { command: "TRANSFER_DESIGN", label: "转给其他设计师" }],
  PRE_REVIEW: [{ command: "APPROVE_PRE_REVIEW", label: "前置审单通过" }, { command: "REJECT_PRE_REVIEW", label: "退回设计", danger: true }],
  TECHNICAL: [{ command: "SUBMIT_TECHNICAL", label: "提交拆单版本" }],
  TECH_REVIEW: [{ command: "APPROVE_TECH_REVIEW", label: "技术审单通过" }, { command: "REJECT_TECH_REVIEW", label: "退回拆单", danger: true }],
  MATERIALS: [{ command: "RECORD_DELIVERY", label: "登记发货" }],
  PRODUCTION: [
    { command: "REPORT_TAIL_PAYMENT", label: "报备尾款收款" },
    { command: "CONFIRM_TAIL_PAYMENT", label: "核验尾款到账" },
    { command: "RECORD_DELIVERY", label: "登记发货" },
  ],
  DELIVERY: [
    { command: "REPORT_TAIL_PAYMENT", label: "报备尾款收款" },
    { command: "CONFIRM_TAIL_PAYMENT", label: "核验尾款到账" },
    { command: "RECORD_DELIVERY", label: "登记发货" },
  ],
  INSTALLATION_APPLICATION: [
    { command: "REPORT_TAIL_PAYMENT", label: "报备尾款收款" },
    { command: "CONFIRM_TAIL_PAYMENT", label: "核验尾款到账" },
    { command: "RECORD_DELIVERY", label: "登记发货" },
  ],
  INSTALLATION: [{ command: "RECORD_DELIVERY", label: "登记发货" }],
  ACCEPTANCE: [{ command: "ACCEPT_CUSTOMER", label: "客户最终验收" }],
};

function availableActions(order: Order, employee: Employee) {
  const actions = COMMANDS[order.stage] ?? [];
  return actions.filter(({ command }) => {
    const isChairman = employee.role === "CHAIRMAN";
    if (command === "REPORT_DEPOSIT") return order.creationMode !== "INTERNAL_EXCEPTION" && employee.role === "SALES" && order.sales?.id === employee.id && !order.depositReported && !order.depositConfirmed;
    if (command === "REPORT_PREPAYMENT") return Boolean(order.prepaymentRequired) && employee.role === "SALES" && order.sales?.id === employee.id && !order.prepaymentReported && !order.prepaymentConfirmed;
    if (command === "CONFIRM_DEPOSIT") return !order.prepaymentRequired && (isChairman || employee.role === "FINANCE") && Boolean(order.depositReported) && !order.depositConfirmed;
    if (command === "CONFIRM_INITIAL_PAYMENTS") return Boolean(order.prepaymentRequired) && (isChairman || employee.role === "FINANCE") && Boolean(order.depositReported) && Boolean(order.prepaymentReported) && (!order.depositConfirmed || !order.prepaymentConfirmed);
    if (command === "REPORT_TAIL_PAYMENT") return order.chargeMode !== "FREE" && !order.tailPaymentReported && !order.tailPaymentConfirmed && (order.creationMode === "INTERNAL_EXCEPTION" ? employee.role === "ORDER_ADMIN" : employee.role === "SALES" && order.sales?.id === employee.id);
    if (command === "CONFIRM_TAIL_PAYMENT") return (isChairman || employee.role === "FINANCE") && Boolean(order.tailPaymentReported) && !order.tailPaymentConfirmed;
    if (command === "ACCEPT_DESIGN" || command === "SUBMIT_DESIGN") return (isChairman || employee.role === "DESIGNER") && Boolean(order.designer?.id) && (isChairman || order.designer?.id === employee.id);
    if (command === "RETURN_DESIGN") return order.creationMode === "SALES_STANDARD" && employee.role === "DESIGNER" && order.designer?.id === employee.id;
    if (command === "ASSIGN_DESIGNER") return !order.designer && (isChairman || (order.creationMode === "INTERNAL_EXCEPTION" ? employee.role === "ORDER_ADMIN" : employee.role === "SALES" && (employee.level === "SUPERVISOR" || order.sales?.id === employee.id)));
    if (command === "TRANSFER_DESIGN") return Boolean(order.designer) && (isChairman || (employee.role === "DESIGNER" && order.designer?.id === employee.id));
    if (command.includes("PRE_REVIEW")) return isChairman || employee.role === "ORDER_ADMIN";
    if (command === "SUBMIT_TECHNICAL") return isChairman || employee.role === "TECHNICAL";
    if (command.includes("TECH_REVIEW")) return isChairman || employee.role === "ORDER_ADMIN";
    if (command === "RECORD_DELIVERY") return (isChairman || employee.role === "ORDER_ADMIN") && (Boolean(order.shipmentGate?.allowed) || Boolean(order.fulfillmentTracks?.outsourced.canShipAny));
    if (command === "ACCEPT_CUSTOMER") return isChairman || ["INSTALLER", "ORDER_ADMIN"].includes(employee.role);
    return false;
  });
}
const commandLabel = (command: string) => command === "COMPLETE_INSTALLATION_BATCH" ? "完成安装批次" : command === "SUBMIT_INSTALLATION_APPLICATION" ? "安装申请（历史记录）" : command === "RECORD_OUTSOURCE_DELIVERY" ? "外购产品发货（历史记录）" : Object.values(COMMANDS).flat().find((item) => item.command === command)?.label ?? command;

const ROLE_LABELS: Record<string, string> = {
  CHAIRMAN: "董事长管理员",
  ORDER_ADMIN: "订单管理员",
  FINANCE: "财务",
  SALES: "销售",
  DESIGNER: "设计师",
  TECHNICAL: "技术拆单",
  WAREHOUSE: "仓库",
  PROCUREMENT: "采购",
  WORKSHOP: "车间",
  INSTALLER: "安装",
  AFTERSALES: "售后",
};


const formatDate = (value?: string | null) => (value ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : "—");
const formatDateOnly = (value?: string | null) => (value ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)) : "—");
const formatShipmentRegistrationTime = (value?: string | null) => (value ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : "—");
const formatDay = (value?: string | null) => (value ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(value)) : "—");
const formatMoney = (value?: number | string | null) => value == null ? "—" : `¥${Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const OUTSOURCE_STATUS: Record<string, { label: string; color: string }> = {
  NOT_ARRIVED: { label: "未到货", color: "default" },
  PARTIAL: { label: "部分到货", color: "warning" },
  READY: { label: "已齐套", color: "cyan" },
  SHIPPED: { label: "已发货", color: "success" },
};

const WORKSHOP_ORDER = ["PANEL", "WOOD", "PAINT", "ASSEMBLY"];

function PackageCountPanel({ order, employee, api, onUpdated }: { order: Order; employee: Employee; api: ReturnType<typeof useApi>["call"]; onUpdated: () => Promise<void> }) {
  const { message } = AntApp.useApp();
  const [activeSource, setActiveSource] = useState<NonNullable<Order["packageSummary"]>["sources"][number] | null>(null);
  const [quantity, setQuantity] = useState<number>(1);
  const [saving, setSaving] = useState(false);
  const [bulkHardwareOpen, setBulkHardwareOpen] = useState(false);
  const [bulkHardwareTotals, setBulkHardwareTotals] = useState<Record<string, number>>({});
  const summary = order.packageSummary;
  if (!summary) return null;
  const isAssembly = employee.role === "CHAIRMAN" || (employee.role === "WORKSHOP" && employee.workshop === "ASSEMBLY");
  const hardwareSources = summary.sources.filter((source) => source.kind === "HARDWARE_AREA");
  const canBulkHardware = ["PROCUREMENT", "CHAIRMAN"].includes(employee.role) && hardwareSources.some((source) => source.status === "OPEN");
  const send = async (sourceKey: string, command: string, extra: Record<string, unknown> = {}) => {
    setSaving(true);
    try {
      await api(`/api/v1/orders/${order.id}/package-counts/${encodeURIComponent(sourceKey)}/commands`, { method: "POST", headers: { "x-expected-updated-at": order.updatedAt }, body: JSON.stringify({ command, ...extra }) });
      message.success(command === "ADD_COUNT" ? "本次包件数已追加" : command === "CONFIRM_HARDWARE_HANDOFF" ? "五金领用已确认" : "该来源已最终确认");
      setActiveSource(null);
      await onUpdated();
    } catch (error) { message.error(error instanceof Error ? error.message : "包件统计更新失败"); }
    finally { setSaving(false); }
  };
  const bulkFinalizeHardware = async () => {
    setSaving(true);
    try {
      await api(`/api/v1/orders/${order.id}/package-counts/hardware/bulk-finalize`, { method: "POST", headers: { "x-expected-updated-at": order.updatedAt }, body: JSON.stringify({ areas: hardwareSources.map((source) => ({ productionAreaId: source.productionAreaId, total: bulkHardwareTotals[source.productionAreaId!] ?? source.total })) }) });
      message.success("全部生产区域的五金包已一次统计完成");
      setBulkHardwareOpen(false);
      await onUpdated();
    } catch (error) { message.error(error instanceof Error ? error.message : "整单五金包统计失败"); }
    finally { setSaving(false); }
  };
  return <>
    <Card title="订单发货包件统计" className="erp-panel erp-package-count-panel" extra={<Space>{canBulkHardware && <Button size="small" type="primary" onClick={() => { setBulkHardwareTotals(Object.fromEntries(hardwareSources.map((source) => [source.productionAreaId!, source.total]))); setBulkHardwareOpen(true); }}>一键统计全部区域五金包</Button>}<Tag color={summary.status === "COMPLETE" ? "success" : summary.status === "LEGACY_UNVERIFIED" ? "default" : "warning"}>{summary.status === "COMPLETE" ? "统计完成" : summary.status === "LEGACY_UNVERIFIED" ? "历史旧口径" : "当前暂计"}</Tag><strong>{summary.currentTotal} 包件</strong></Space>}>
      <Descriptions size="small" bordered column={3} items={[
        { key: "hardware", label: "五金包", children: `${summary.hardwareTotal} 包` },
        { key: "manufactured", label: "自产入库", children: `${summary.manufacturedTotal} 包件` },
        { key: "outsourced", label: "外购入库", children: `${summary.outsourcedTotal} 包件` },
      ]} />
      <div className="erp-package-source-list">{summary.sources.map((item) => {
        const owns = item.kind === "HARDWARE_AREA" ? ["PROCUREMENT", "CHAIRMAN"].includes(employee.role) : isAssembly;
        const canConfirm = item.kind === "HARDWARE_AREA" && item.status === "FINALIZED" && !item.handoffConfirmed && item.canConfirmHandoff && isAssembly;
        const statusDetail = item.status === "FINALIZED" ? "已最终确认" : item.detail;
        return <div className="erp-package-source" key={item.sourceKey}><div><strong>{item.label}</strong><span>{item.total} 包件 · {statusDetail}{item.kind === "HARDWARE_AREA" ? item.handoffConfirmed ? " · 组装已领用" : " · 待组装确认领用" : ""}</span></div><Space wrap>
          {owns && item.status === "OPEN" && <Button size="small" disabled={!item.canAdd} onClick={() => { setQuantity(1); setActiveSource(item); }}>追加包件</Button>}
          {owns && item.status === "OPEN" && <Button size="small" type="primary" disabled={!item.canFinalize || (item.kind !== "HARDWARE_AREA" && item.total <= 0)} onClick={() => send(item.sourceKey, "FINALIZE_SOURCE")}>统计完成</Button>}
          {canConfirm && <Button size="small" type="primary" onClick={() => send(item.sourceKey, "CONFIRM_HARDWARE_HANDOFF")}>确认领用 {item.total} 包</Button>}
        </Space></div>;
      })}</div>
      {summary.legacyApplicationEstimate != null && <Alert type="warning" showIcon title={`历史安装申请预计数 ${summary.legacyApplicationEstimate} 件`} description="该数字只按旧口径展示，不计入新的发货包件合计。" />}
    </Card>
    <Modal title={`追加包件数·${activeSource?.label ?? ""}`} open={Boolean(activeSource)} onCancel={() => setActiveSource(null)} onOk={() => activeSource && send(activeSource.sourceKey, "ADD_COUNT", { quantity })} okText="确认追加" confirmLoading={saving}><Typography.Paragraph type="secondary">本次数量会与已登记数累计，不覆盖历史记录。</Typography.Paragraph><InputNumber min={1} precision={0} addonAfter="包件" value={quantity} onChange={(value) => setQuantity(Number(value ?? 1))} style={{ width: "100%" }} /></Modal>
    <Modal title="一键统计整单五金包" open={bulkHardwareOpen} onCancel={() => setBulkHardwareOpen(false)} onOk={bulkFinalizeHardware} okText="原子确认全部区域" confirmLoading={saving}>
      <Alert type="info" showIcon title="填写各生产区域的最终总数" description="系统只追加与当前累计数的差额；任一区域校验失败时，全部区域都不会修改。" />
      <Form layout="vertical" style={{ marginTop: 16 }}>{hardwareSources.map((source) => <Form.Item key={source.sourceKey} label={source.label} required><InputNumber min={source.total} precision={0} addonAfter="包" disabled={source.status === "FINALIZED"} value={bulkHardwareTotals[source.productionAreaId!] ?? source.total} onChange={(value) => setBulkHardwareTotals((current) => ({ ...current, [source.productionAreaId!]: Number(value ?? source.total) }))} style={{ width: "100%" }} /><Typography.Text type="secondary">当前累计 {source.total} 包{source.status === "FINALIZED" ? " · 已确认，只读" : ""}</Typography.Text></Form.Item>)}</Form>
    </Modal>
  </>;
}

function ProductionExecution({ order, employee, api, canRelease, onUpdated, areaLabel }: { order: Order; employee: Employee; api: ReturnType<typeof useApi>["call"]; canRelease: boolean; onUpdated: (order: Order) => void; areaLabel?: string }) {
  const { message } = AntApp.useApp();
  const [process, setProcess] = useState<NonNullable<Order["production"]>["processes"][number] | null>(null);
  const [action, setAction] = useState("PROGRESS");
  const [completedQty, setCompletedQty] = useState<number>(0);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [releasePlans, setReleasePlans] = useState({ PANEL: 1, WOOD: 1, PAINT: 1, ASSEMBLY: 1 });
  const production = order.production;
  const release = async () => {
    setSaving(true);
    try {
      const updated = await api<Order>(`/api/v1/orders/${order.id}/production/release`, { method: "POST", body: JSON.stringify({ plans: releasePlans }) });
      message.success("四车间计划面积已补录，现在可以逐工序报工"); setReleaseOpen(false); onUpdated(updated);
    } catch (error) { message.error(error instanceof Error ? error.message : "生产计划补录失败"); }
    finally { setSaving(false); }
  };
  if (!production?.processes.length) return <>
    <Card title={`${areaLabel ? `${areaLabel} · ` : ""}逐工序执行`} className="erp-panel erp-production-empty" extra={canRelease ? <Button type="primary" onClick={() => setReleaseOpen(true)}>补录计划并开始报工</Button> : <Tag>采购完成后自动下达</Tag>}>
      <Alert
        type="warning"
        showIcon
        title="当前订单缺少逐工序计划面积"
        description="这是升级前已经进入生产阶段的订单。补录板式、木工、油漆和组装计划面积后，系统会立即生成全部工序，并在每一行显示“报工”按钮。"
        action={canRelease ? <Button type="primary" onClick={() => setReleaseOpen(true)}>立即补录四车间计划</Button> : undefined}
      />
    </Card>
    <Modal title="补录四车间计划面积" open={releaseOpen} onCancel={() => setReleaseOpen(false)} onOk={release} okText="生成逐工序任务" confirmLoading={saving}>
      <Alert type="info" showIcon title="仅用于升级前已进入生产阶段的订单；生成后每道工序可独立保存部分完成数量。" />
      <Form layout="vertical" className="erp-release-plan-form">{WORKSHOP_ORDER.map((key) => <Form.Item key={key} label={{ PANEL: "板式车间", WOOD: "木工（实木）车间", PAINT: "油漆车间", ASSEMBLY: "组装车间" }[key]} required><InputNumber min={0.001} value={releasePlans[key as keyof typeof releasePlans]} onChange={(value) => setReleasePlans((current) => ({ ...current, [key]: Number(value ?? 1) }))} addonAfter="㎡" style={{ width: "100%" }} /></Form.Item>)}</Form>
    </Modal>
  </>;
  const openReport = (item: NonNullable<Order["production"]>["processes"][number]) => {
    setProcess(item); setAction(item.status === "PENDING" ? "START" : "PROGRESS"); setCompletedQty(item.completedQty); setNote(item.note ?? "");
  };
  const submitReport = async () => {
    if (!process) return;
    setSaving(true);
    try {
      const updated = await api<Order>(`/api/v1/orders/${order.id}/production/report`, { method: "POST", headers: { "x-expected-updated-at": order.updatedAt }, body: JSON.stringify({ processId: process.id, action, completedQty: action === "COMPLETE" ? process.plannedQty : completedQty, note }) });
      message.success(action === "ISSUE" ? "异常已记录，订单仍停留在生产阶段" : action === "COMPLETE" ? "本工序已全部完成，车间与整单进度已重算" : "本次生产进度已保存，订单阶段未提前完成");
      setProcess(null); onUpdated(updated);
    } catch (error) { message.error(error instanceof Error ? error.message : "报工失败"); }
    finally { setSaving(false); }
  };
  const bulkComplete = async (workshop: string) => {
    const scoped = production.processes.find((item) => item.workshop === workshop) ?? production.processes[0];
    if (!scoped?.productionAreaId) return;
    setSaving(true);
    try {
      const updated = await api<Order>(`/api/v1/orders/${order.id}/production/bulk-complete`, { method: "POST", headers: { "x-expected-updated-at": order.updatedAt }, body: JSON.stringify({ productionAreaId: scoped.productionAreaId, productionRouteId: scoped.productionRouteId ?? undefined, ...(employee.role === "CHAIRMAN" ? { workshop } : {}) }) });
      message.success("本区域本路线的当前车间工序已依赖顺序完成");
      onUpdated(updated);
    } catch (error) { message.error(error instanceof Error ? error.message : "一键报工失败"); }
    finally { setSaving(false); }
  };
  return <>
    <Card title={`${areaLabel ? `${areaLabel} · ` : ""}逐工序执行`} className="erp-panel erp-production-panel" extra={<Tag color={production.complete ? "success" : "processing"}>路线工序 {production.completedSteps ?? 0}/{production.totalSteps ?? production.processes.length}</Tag>}>
      <Progress percent={production.percent} strokeColor="#00a98f" />
      <div className="erp-workshop-grid">{WORKSHOP_ORDER.map((workshop) => {
        const processes = production.processes.filter((item) => item.workshop === workshop);
        if (!processes.length) return null;
        const summary = production.workshops[workshop];
        const canBulk = (employee.role === "CHAIRMAN" || (employee.role === "WORKSHOP" && employee.level === "SUPERVISOR" && employee.workshop === workshop)) && processes.some((item) => item.status !== "COMPLETE" && !["REFERENCE_CONFIRMATION", "PACKAGE_COUNT"].includes(item.metricMode ?? ""));
        return <section className="erp-workshop-card" key={workshop}>
          <header><div><strong>{processes[0]!.workshopLabel}</strong><span>{summary.mixedMetrics ? `已完成 ${summary.completedSteps ?? 0}/${summary.totalSteps ?? processes.length} 道工序` : `${summary.completedQty}/${summary.plannedQty} ${processes[0]?.unit ?? "㎡"}`}</span></div><Space size={6}><Tag color={summary.percent === 100 ? "success" : summary.percent > 0 ? "processing" : "default"}>{summary.mixedMetrics ? `${summary.completedSteps ?? 0}/${summary.totalSteps ?? processes.length}` : `${summary.percent}%`}</Tag>{canBulk && <Button size="small" type="primary" loading={saving} onClick={() => bulkComplete(workshop)}>一键完成本车间报工</Button>}</Space></header>
          <Progress percent={summary.percent} showInfo={false} size="small" strokeColor={workshop === "PANEL" ? "#00a98f" : workshop === "WOOD" ? "#3482b8" : workshop === "PAINT" ? "#d88728" : "#7658b3"} />
          <div className="erp-process-list">{processes.map((item, index) => {
            const available = item.available ?? (index === 0 || processes[index - 1]?.status === "COMPLETE");
            return <div className={item.status === "COMPLETE" ? "complete" : item.status === "ISSUE" ? "issue" : !available ? "locked" : ""} key={item.id}>
              <span className="erp-process-sequence">{item.sequence}</span><div><strong>{item.metricMode === "PACKAGE_COUNT" ? "自产成品入库" : item.processName}</strong><small>{item.metricMode === "AREA_QUANTITY" || !item.metricMode ? `${item.completedQty}/${item.plannedQty} ${item.unit}` : item.metricMode === "REFERENCE_CONFIRMATION" ? "五金包独立统计；不计生产进度，不阻断入库或发货" : item.metricMode === "PACKAGE_COUNT" ? "打包完成后在下方发货包件统计中累计" : "无数量的最终状态确认"}{item.note ? ` · ${item.note}` : !available ? ` · ${item.lockedReason ?? `前序“${processes[index - 1]?.processName}”完成后开放`}` : ""}</small></div>
              <Tag color={item.metricMode === "REFERENCE_CONFIRMATION" ? "cyan" : item.status === "COMPLETE" ? "success" : item.status === "ISSUE" ? "error" : item.status === "IN_PROGRESS" ? "processing" : "default"}>{item.metricMode === "REFERENCE_CONFIRMATION" ? "独立统计" : item.status === "COMPLETE" ? "已完成" : item.status === "ISSUE" ? "有异常" : item.status === "IN_PROGRESS" ? "进行中" : available ? "可报工" : "待前序"}</Tag>
              {item.canReport && <Button size="small" disabled={!available || item.status === "COMPLETE"} onClick={() => openReport(item)}>{item.status === "COMPLETE" ? "已完成" : available ? "报工" : "未开放"}</Button>}
            </div>;
          })}</div>
        </section>;
      })}</div>
    </Card>
    <Modal title={`工序报工 · ${process?.workshopLabel ?? ""} · ${process?.processName ?? ""}`} open={Boolean(process)} onCancel={() => setProcess(null)} onOk={submitReport} confirmLoading={saving} okText="保存本次报工" destroyOnHidden>
      <Form layout="vertical">
        <Alert type="info" showIcon title={`当前累计 ${process?.completedQty ?? 0}/${process?.plannedQty ?? 0} ${process?.unit ?? "㎡"}；保存部分数量不会推进整单阶段。`} />
        <Form.Item label="报工动作" required><Select value={action} onChange={setAction} options={[{ value: "START", label: "开始本工序" }, { value: "PROGRESS", label: "保存部分完成" }, { value: "COMPLETE", label: "本工序全部完成" }, { value: "ISSUE", label: "报告异常" }]} /></Form.Item>
        <Form.Item label="累计完成面积" required><InputNumber value={action === "COMPLETE" ? process?.plannedQty : completedQty} min={process?.completedQty ?? 0} max={process?.plannedQty ?? 0} disabled={action === "COMPLETE"} addonAfter={process?.unit ?? "㎡"} onChange={(value) => setCompletedQty(Number(value ?? 0))} style={{ width: "100%" }} /></Form.Item>
        <Form.Item label={action === "ISSUE" ? "异常说明（必填）" : "本次说明"} required={action === "ISSUE"}><Input.TextArea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder={action === "ISSUE" ? "描述尺寸、质量、设备或物料问题" : "可记录班组、设备或批次"} /></Form.Item>
      </Form>
    </Modal>
  </>;
}

function useApi() {
  const [csrf, setCsrf] = useState("");
  const pending = useRef(new Map<string, string>());
  const call = useCallback(async <T,>(path: string, init: RequestInit = {}) => {
    const isMutation = init.method === "POST" && typeof init.body === "string";
    const signature = `${csrf}:${path}:${init.body}:${JSON.stringify(init.headers ?? {})}`;
    const idempotencyKey = isMutation ? pending.current.get(signature) ?? crypto.randomUUID() : null;
    if (idempotencyKey) pending.current.set(signature, idempotencyKey);
    const response = await fetch(path, {
      ...init,
      credentials: "include",
      headers: { ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(csrf ? { "x-csrf-token": csrf } : {}), ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}), ...init.headers },
    });
    const data = await response.json().catch(() => ({}));
    // Keep the same key for every failed response. A server may have committed the
    // mutation before a later response/detail step fails; retrying must then replay
    // the receipt instead of creating a second record.
    if (shouldReleaseIdempotencyKey(response)) pending.current.delete(signature);
    if (response.status === 401) window.dispatchEvent(new Event("erp-session-expired"));
    if (!response.ok) throw new Error(data.message || `请求失败 (${response.status})`);
    return data as T;
  }, [csrf]);
  return { call, csrf, setCsrf };
}

function FilingLinks({ filing }: { filing: PublicConfig }) {
  return <span className="erp-filing-links">
    {filing.icpFilingNumber && <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">{filing.icpFilingNumber}</a>}
    {filing.publicSecurityFilingNumber && <a href={filing.publicSecurityFilingUrl || "https://beian.mps.gov.cn/"} target="_blank" rel="noreferrer">{filing.publicSecurityFilingNumber}</a>}
  </span>;
}

function LoginPrelude({ onEnter, filing }: { onEnter: () => void; filing: PublicConfig }) {
  return <main className="erp-login-prelude" onClick={onEnter}>
    {filing.environment === "company-test" && <div className="erp-company-test-banner">公司云测试环境 · 仅使用编造的测试数据</div>}
    <section className="erp-login-prelude-window" aria-labelledby="login-prelude-title">
      <header className="erp-login-prelude-window-bar">
        <span className="erp-login-prelude-mark"><i>苔</i><strong>ORDER JOURNEY</strong></span>
        <span>宁波镇海 · WEATHER JOURNAL</span>
      </header>
      <div className="erp-login-prelude-content">
        <LoginWeatherScene />
        <div className="erp-login-prelude-title">
          <span>WELCOME TO</span>
          <h1 id="login-prelude-title">苔的跟单旅程</h1>
          <p>把今天的每一步，安稳地跟到落地。</p>
        </div>
      </div>
      <button type="button" className="erp-login-prelude-enter" onClick={(event) => { event.stopPropagation(); onEnter(); }}>
        <strong>点击进入</strong>
        <span>开始今天的跟单旅程</span>
      </button>
    </section>
    <div className="erp-login-prelude-filing" onClick={(event) => event.stopPropagation()}><FilingLinks filing={filing} /></div>
  </main>;
}

function Login({ mobileReadonly, filing, onLogin }: { mobileReadonly: boolean; filing: PublicConfig; onLogin: (employee: Employee, csrf: string) => void }) {
  const { message } = AntApp.useApp();
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  const localAccounts = showLocalTestAccounts({ devBuild: import.meta.env.DEV, backendEnabled: filing.localTestAccountsEnabled, hostname: window.location.hostname, mobileReadonly });

  useEffect(() => {
    if (!localAccounts) return;
    try { window.sessionStorage.removeItem(LOCAL_TEST_LOGIN_PAGE_KEY); } catch { /* session preferences are optional */ }
  }, [localAccounts]);

  async function submit(values: { username: string; password: string }) {
    setBusy(true);
    try {
      const response = await fetch("/api/v1/auth/login", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...values, client: mobileReadonly ? "mobile-readonly" : "desktop" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "登录失败");
      onLogin(data.employee, data.csrfToken);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }
  return <div className={`erp-login ${localAccounts ? "erp-login-with-test-accounts" : ""} ${mobileReadonly ? "erp-login-mobile-readonly" : ""}`}>
    {filing.environment === "company-test" && <div className="erp-company-test-banner">公司云测试环境 · 仅使用编造的测试数据</div>}
    <div className="erp-login-intro">
      <div className="erp-login-brand"><div className="erp-logo">苔</div><div><strong>苔的跟单旅程</strong><span>ORDER JOURNEY</span></div></div>
      <p className="erp-login-tagline">把每一张订单的进展，清清楚楚地接续下去。</p>
      {localAccounts && LocalTestAccounts && <Suspense fallback={<Spin size="large" />}><LocalTestAccounts disabled={busy} onChoose={(values) => { form.setFieldsValue(values); }} /></Suspense>}
    </div>
    <div className="erp-login-card-wrap">
      {!mobileReadonly && <InteractiveOrangeCat />}
      <Card className="erp-login-card" variant="borderless">
        <span className="erp-login-note">WELCOME BACK</span>
        <Typography.Title level={2}>{mobileReadonly ? "登录手机只读页" : "回到今天的跟单旅程"}</Typography.Title>
        <Typography.Paragraph type="secondary">{mobileReadonly ? "仅董事长管理员可查看全部订单，所有业务办理仍在电脑端完成。" : "使用个人账号登录，继续处理今天的订单与待办。"}</Typography.Paragraph>
        <Form form={form} layout="vertical" onFinish={submit}>
          <Form.Item label="账号" name="username" rules={[{ required: true }]}><Input autoComplete="username" placeholder="请输入个人账号" /></Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true }]}><Input.Password placeholder="请输入密码" /></Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={busy}>进入跟单旅程</Button>
        </Form>
        <div className="erp-login-tip"><span>忘记密码请联系管理员。请勿共用账号。</span><FilingLinks filing={filing} /></div>
      </Card>
    </div>
  </div>;
}

function OrderStatusBar({ order }: { order: Order }) {
  const visualStage = order.afterSalesActive ? "AFTERSALES" : order.stage === "INSTALLATION_APPLICATION" ? "DELIVERY" : order.stage;
  const current = Math.max(0, STAGES.findIndex(([key]) => key === visualStage));
  return <div className="erp-stage-scroll"><div className="erp-stage-bar">
    {STAGES.map(([key, rawLabel], index) => {
      const label = key === "DEPOSIT_PENDING" && order.creationMode === "INTERNAL_EXCEPTION" ? "商务确认" : rawLabel;
      const parallel = order.workflowProgress?.steps.find((step) => step.key === key);
      const state = parallel?.status.toLowerCase() ?? (index < current ? "done" : index === current ? "current" : "");
      return <div className={`erp-stage ${state}`} key={key} title={parallel?.reason ?? undefined}>
        {parallel ? <Progress type="circle" size={34} percent={parallel.percent} strokeWidth={10} strokeColor={parallel.status === "BLOCKED" ? "#c98555" : "#008b76"} format={(percent) => `${percent}%`} /> : <span>{index < current ? "✓" : index + 1}</span>}
        <strong>{label}</strong>
        {parallel && <small>{parallel.status === "BLOCKED" ? parallel.reason ?? "已阻断" : parallel.status === "COMPLETE" ? "已完成" : parallel.status === "ACTIVE" ? "进行中" : "待开始"}</small>}
        {index < STAGES.length - 1 && <i />}
      </div>;
    })}
  </div></div>;
}

const BUSINESS_TYPE_OPTIONS = [
  ["NOERLI_FORMAL", "诺尔丽正单"], ["NOERLI_SUPPLEMENT", "诺尔丽补单"], ["AIKEJU_FORMAL", "艾可居正单"], ["AIKEJU_SUPPLEMENT", "艾可居补单"],
  ["CHANNEL_FORMAL", "渠道正单"], ["CHANNEL_SUPPLEMENT", "渠道补单"], ["ENGINEERING_FORMAL", "工程正单"], ["ENGINEERING_SUPPLEMENT", "工程补单"],
  ["WORKWEAR_FORMAL", "工装正单"], ["WORKWEAR_SUPPLEMENT", "工装补单"],
] as const;
const familyOf = (businessType: string) => businessType.replace(/_(FORMAL|SUPPLEMENT)$/, "");
type SiteCategory = "FINISHED" | "ROUGH_VILLA" | "ROUGH_FLAT";
const SITE_CATEGORY_OPTIONS: Array<{ value: SiteCategory; label: string }> = [
  { value: "FINISHED", label: "精装修" },
  { value: "ROUGH_VILLA", label: "毛坯别墅" },
  { value: "ROUGH_FLAT", label: "毛坯平层" },
];
const siteCategoryOf = (siteType: Order["siteType"], villaFloors: number): SiteCategory => siteType === "FINISHED" ? "FINISHED" : villaFloors > 0 ? "ROUGH_VILLA" : "ROUGH_FLAT";
const siteCategoryLabel = (siteType: Order["siteType"], villaFloors: number) => SITE_CATEGORY_OPTIONS.find((item) => item.value === siteCategoryOf(siteType, villaFloors))?.label ?? "—";
function CreateOrderModal({ open, employee, employees, orders, paymentAccounts = [], initialParentId, onCancel, onCreated, api }: { open: boolean; employee: Employee; employees: Employee[]; orders: Order[]; paymentAccounts?: string[]; initialParentId?: string | null; onCancel: () => void; onCreated: (order: Order) => void; api: ReturnType<typeof useApi>["call"] }) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [initialPaymentFiles, setInitialPaymentFiles] = useState<{ deposit: UploadFile[]; prepayment: UploadFile[] }>({ deposit: [], prepayment: [] });
  const initialParent = initialParentId ? orders.find((order) => order.id === initialParentId) : undefined;
  const rush = Form.useWatch("rush", form);
  const creationMode = Form.useWatch("creationMode", form) ?? initialParent?.creationMode ?? (employee.role === "SALES" ? "SALES_STANDARD" : "INTERNAL_EXCEPTION");
  const proposedChargeMode = Form.useWatch("proposedChargeMode", form);
  const isInternal = creationMode === "INTERNAL_EXCEPTION";
  const allowedTypes = BUSINESS_TYPE_OPTIONS.filter(([type]) => employee.role !== "SALES" || salesBusinessTypes(employee.businessUnit).includes(type as never));
  const defaultBusinessType = allowedTypes[0]?.[0];
  const businessType = Form.useWatch("businessType", form) ?? (initialParent ? `${familyOf(initialParent.businessType)}_SUPPLEMENT` : defaultBusinessType);
  const siteCategory = Form.useWatch("siteCategory", form) ?? "FINISHED";
  const parentOrderId = Form.useWatch("parentOrderId", form) ?? initialParentId;
  const isSupplement = Boolean(initialParent) || String(businessType).endsWith("SUPPLEMENT");
  const parentOptions = orders.filter((order) => !order.businessType.endsWith("SUPPLEMENT") && familyOf(order.businessType) === familyOf(String(businessType)));
  const parent = initialParent ?? parentOptions.find((order) => order.id === parentOrderId);
  useEffect(() => {
    if (!open || !initialParentId) return;
    if (initialParent) form.setFieldsValue({ creationMode: initialParent.creationMode, businessType: `${familyOf(initialParent.businessType)}_SUPPLEMENT`, parentOrderId: initialParent.id, siteCategory: siteCategoryOf(initialParent.siteType, initialParent.villaFloors), customerName: initialParent.customerName, customerPhone: initialParent.customerPhone, address: initialParent.address, salesId: initialParent.sales?.id, designerId: initialParent.designer?.id, finishType: initialParent.finishType, leatherDoor: initialParent.leatherDoor, villaFloors: initialParent.villaFloors });
  }, [form, initialParent, initialParentId, open]);
  useEffect(() => {
    if (open && employee.role === "DESIGNER") form.setFieldValue("designerId", employee.id);
  }, [employee.id, employee.role, form, open]);
  useEffect(() => {
    if (!open) return;
    if (isInternal) {
      form.setFieldsValue({ amount: undefined, depositAmount: undefined, depositReceivedAt: undefined, depositAccount: undefined, prepaymentAmount: undefined, prepaymentReceivedAt: undefined, prepaymentAccount: undefined, salesId: undefined });
      setInitialPaymentFiles({ deposit: [], prepayment: [] });
    } else form.setFieldsValue({ proposedChargeMode: undefined, exceptionReason: undefined, freeReason: undefined });
  }, [form, isInternal, open]);
  useEffect(() => {
    if (!isSupplement) form.setFieldsValue({ parentOrderId: undefined, supplementType: undefined, responsibilityType: undefined, supplementReason: undefined });
    const currentParent = orders.find((order) => order.id === form.getFieldValue("parentOrderId"));
    if (isSupplement && currentParent && familyOf(currentParent.businessType) !== familyOf(String(businessType))) form.setFieldValue("parentOrderId", undefined);
  }, [businessType, form, isSupplement, orders]);
  useEffect(() => {
    if (parent) form.setFieldsValue({ creationMode: parent.creationMode, customerName: parent.customerName, customerPhone: parent.customerPhone, address: parent.address, siteCategory: siteCategoryOf(parent.siteType, parent.villaFloors), salesId: parent.sales?.id, designerId: parent.designer?.id, finishType: parent.finishType, leatherDoor: parent.leatherDoor, villaFloors: parent.villaFloors });
  }, [form, parent]);
  async function submit(values: Record<string, unknown>) {
    setSaving(true);
    try {
      const selectedSiteCategory = values.siteCategory as SiteCategory;
      const { depositAmount, depositReceivedAt, depositAccount, prepaymentAmount, prepaymentReceivedAt, prepaymentAccount, ...orderValues } = values;
      if (!isInternal && !isSupplement && Number(depositAmount) + Number(prepaymentAmount) > Number(values.amount)) throw new Error("定金与预付款合计不能超过合同金额");
      if (!isInternal && !isSupplement && (!initialPaymentFiles.deposit.length || !initialPaymentFiles.prepayment.length)) throw new Error("请分别上传定金和预付款凭证");
      const payload = { ...orderValues, creationMode, siteType: selectedSiteCategory === "FINISHED" ? "FINISHED" : "ROUGH", villaFloors: selectedSiteCategory === "ROUGH_VILLA" ? Math.max(1, Number(values.villaFloors ?? 1)) : 0, signedAt: (values.signedAt as { format: (v: string) => string }).format("YYYY-MM-DD"), promisedAt: (values.promisedAt as { format: (v: string) => string }).format("YYYY-MM-DD"), rushPromisedAt: values.rushPromisedAt ? (values.rushPromisedAt as { format: (v: string) => string }).format("YYYY-MM-DD") : undefined };
      let order = await api<Order>("/api/v1/orders", { method: "POST", body: JSON.stringify(payload) });
      if (!isInternal && !isSupplement) {
        async function uploadReceipt(file: UploadFile, category: string) {
          const body = new FormData(); body.append("category", category); body.append("file", file.originFileObj as File);
          return api<{ id: string }>(`/api/v1/attachments/${order.id}`, { method: "POST", body });
        }
        const depositReceipt = await uploadReceipt(initialPaymentFiles.deposit[0]!, "DEPOSIT_RECEIPT");
        order = await api<Order>(`/api/v1/orders/${order.id}/commands`, { method: "POST", headers: { "x-expected-updated-at": order.updatedAt ?? "" }, body: JSON.stringify({ command: "REPORT_DEPOSIT", payload: { receivedAmount: depositAmount, receivedAt: (depositReceivedAt as { format: (v: string) => string }).format("YYYY-MM-DD"), account: depositAccount, receiptAttachmentIds: [depositReceipt.id] } }) });
        const prepaymentReceipt = await uploadReceipt(initialPaymentFiles.prepayment[0]!, "PREPAYMENT_RECEIPT");
        order = await api<Order>(`/api/v1/orders/${order.id}/commands`, { method: "POST", headers: { "x-expected-updated-at": order.updatedAt ?? "" }, body: JSON.stringify({ command: "REPORT_PREPAYMENT", payload: { receivedAmount: prepaymentAmount, receivedAt: (prepaymentReceivedAt as { format: (v: string) => string }).format("YYYY-MM-DD"), account: prepaymentAccount, receiptAttachmentIds: [prepaymentReceipt.id] } }) });
      }
      message.success(isInternal ? "非常规订单已创建，等待订单管理员确认商务方式" : isSupplement ? "补单已关联正单，当前使用独立跟单流水号" : "合同与两笔首付款已记录，等待财务同时核验");
      form.resetFields();
      setInitialPaymentFiles({ deposit: [], prepayment: [] });
      onCreated(order);
    } catch (error) { message.error(error instanceof Error ? error.message : "建单失败"); }
    finally { setSaving(false); }
  }
  return <Modal title={isSupplement ? "创建关联补单" : "新建订单"} width={820} open={open} onCancel={onCancel} footer={null} destroyOnHidden>
    <Alert type="info" showIcon title={isInternal ? "非常规订单先记录业务资料与收费意向，不在建单时填写金额。订单管理员确认收费或免费后进入后续流程。" : isSupplement ? "补单必须关联一张同品牌正单；客户、地址、销售和设计师从正单继承，正式设计提交后取得独立销售编号，生产编号由技术按区域领取。" : "建单后先生成跟单流水号；设计师正式提交时生成整单销售编号，生产编号由技术按区域领取。"} />
    <Form form={form} layout="vertical" className="erp-form-grid" onFinish={submit} initialValues={{ creationMode: employee.role === "SALES" ? "SALES_STANDARD" : "INTERNAL_EXCEPTION", businessType: defaultBusinessType, siteCategory: "FINISHED", finishType: "MELAMINE", rush: false, leatherDoor: false, villaFloors: 0, proposedChargeMode: "CHARGED", designerId: employee.role === "DESIGNER" ? employee.id : undefined }}>
      {employee.role === "CHAIRMAN" && <Form.Item label="建单模式" name="creationMode" rules={[{ required: true }]}><Select options={[{ value: "SALES_STANDARD", label: "常规销售订单" }, { value: "INTERNAL_EXCEPTION", label: "内部非常规订单" }]} /></Form.Item>}
      <Form.Item label="订单类型" name="businessType" rules={[{ required: true }]}><Select options={allowedTypes.map(([value, label]) => ({ value, label }))} /></Form.Item>
      <Form.Item label="现场类型" name="siteCategory" rules={[{ required: true }]}><Select disabled={isSupplement} options={SITE_CATEGORY_OPTIONS} /></Form.Item>
      {isSupplement && <>
        <Form.Item label="关联正单" name="parentOrderId" rules={[{ required: true, message: "请选择补单所属正单" }]} className="span-2"><Select showSearch optionFilterProp="label" placeholder="按销售编号、跟单号或客户搜索正单" options={parentOptions.map((order) => ({ value: order.id, label: `${order.salesNumber ?? order.trackingSerial} · ${order.customerName} · ${order.address}` }))} /></Form.Item>
        {parent && <Card size="small" className="span-2 erp-parent-preview"><Descriptions size="small" column={3} items={[
          { key: "number", label: "正单销售编号", children: parent.salesNumber ?? parent.trackingSerial }, { key: "customer", label: "客户", children: parent.customerName },
          { key: "people", label: "销售 / 设计", children: `${parent.sales?.name ?? "—"} / ${parent.designer?.name ?? "待分配"}` }, { key: "address", label: "项目地址", children: parent.address, span: 3 },
        ]} /></Card>}
        <Form.Item label="补单来源" name="supplementType" rules={[{ required: true }]}><Select options={[...SUPPLEMENT_TYPE_OPTIONS]} /></Form.Item>
        <Form.Item label="责任 / 收费" name="responsibilityType" rules={[{ required: true }]}><Select options={[...RESPONSIBILITY_TYPE_OPTIONS]} /></Form.Item>
        <Form.Item label="补单事实与原因" name="supplementReason" rules={[{ required: true }]} className="span-2"><Input.TextArea rows={3} placeholder="记录现场事实、缺损位置、增项内容或责任说明" /></Form.Item>
      </>}
      <Form.Item label="客户姓名" name="customerName" rules={[{ required: !isSupplement }]}><Input disabled={isSupplement} /></Form.Item>
      <Form.Item label="客户电话" name="customerPhone" rules={[{ required: !isSupplement }]}><Input disabled={isSupplement} /></Form.Item>
      <Form.Item label="项目地址" name="address" rules={[{ required: !isSupplement }]} className="span-2"><Input disabled={isSupplement} /></Form.Item>
      {isInternal ? <>
        <Form.Item label="预计商务方式" name="proposedChargeMode" rules={[{ required: true }]}><Select options={[{ value: "CHARGED", label: "预计收费" }, { value: "FREE", label: "预计免费" }]} /></Form.Item>
        <Form.Item label="非常规建单原因" name="exceptionReason" rules={[{ required: true }]} className="span-2"><Input.TextArea rows={3} placeholder="说明为何不由销售走常规签约流程" /></Form.Item>
        {proposedChargeMode === "FREE" && <Form.Item label="预计免费原因" name="freeReason" rules={[{ required: true }]} className="span-2"><Input.TextArea rows={2} placeholder="如亲友单、内部批准等；订单管理员确认时可修订" /></Form.Item>}
      </> : <Form.Item label={isSupplement ? "补单金额" : "合同金额"} name="amount" rules={[{ required: true }]}><InputNumber min={isSupplement ? 0 : 1} prefix="¥" style={{ width: "100%" }} /></Form.Item>}
      <Form.Item label={isInternal ? "业务约定日期" : "签约日期"} name="signedAt" rules={[{ required: true }]}><DatePicker style={{ width: "100%" }} /></Form.Item>
      {!isInternal && !isSupplement && <>
        <Card size="small" title="签约首付款 · 定金" className="span-2 erp-parent-preview">
          <div className="erp-form-grid"><Form.Item label="定金金额" name="depositAmount" rules={[{ required: true }]}><InputNumber min={0.01} prefix="¥" style={{ width: "100%" }} /></Form.Item><Form.Item label="定金到账日期" name="depositReceivedAt" extra="可早于签约日期，按客户实际支付日期记录" rules={[{ required: true }]}><DatePicker style={{ width: "100%" }} /></Form.Item><Form.Item label="定金收款账户" name="depositAccount" rules={[{ required: true }]}><Select placeholder="选择已批准账户" options={paymentAccounts.map((value) => ({ value, label: value }))} /></Form.Item><Form.Item label="定金凭证" required><Upload maxCount={1} beforeUpload={() => false} fileList={initialPaymentFiles.deposit} onChange={({ fileList }) => setInitialPaymentFiles((current) => ({ ...current, deposit: fileList }))}><Button icon={<RiUpload2Line size={16} />}>选择定金凭证</Button></Upload></Form.Item></div>
        </Card>
        <Card size="small" title="签约首付款 · 预付款" className="span-2 erp-parent-preview">
          <div className="erp-form-grid"><Form.Item label="预付款金额" name="prepaymentAmount" rules={[{ required: true }]}><InputNumber min={0.01} prefix="¥" style={{ width: "100%" }} /></Form.Item><Form.Item label="预付款到账日期" name="prepaymentReceivedAt" rules={[{ required: true }]}><DatePicker style={{ width: "100%" }} /></Form.Item><Form.Item label="预付款收款账户" name="prepaymentAccount" rules={[{ required: true }]}><Select placeholder="选择已批准账户" options={paymentAccounts.map((value) => ({ value, label: value }))} /></Form.Item><Form.Item label="预付款凭证" required><Upload maxCount={1} beforeUpload={() => false} fileList={initialPaymentFiles.prepayment} onChange={({ fileList }) => setInitialPaymentFiles((current) => ({ ...current, prepayment: fileList }))}><Button icon={<RiUpload2Line size={16} />}>选择预付款凭证</Button></Upload></Form.Item></div>
        </Card>
      </>}
      <Form.Item label="客户约定交期" name="promisedAt" extra="按与客户的实际约定录入，系统不自动生成" rules={[{ required: true }]}><DatePicker style={{ width: "100%" }} /></Form.Item>
      <Form.Item label="生产工艺类型" name="finishType" rules={[{ required: true }]}><Select disabled={isSupplement} options={[{ value: "MELAMINE", label: "免漆工艺" }, { value: "PAINT", label: "油漆工艺" }]} /></Form.Item>
      <Form.Item label="皮革门" name="leatherDoor"><Select disabled={isSupplement} options={[{ value: false, label: "无" }, { value: true, label: "有（生产+5天）" }]} /></Form.Item>
      {siteCategory === "ROUGH_VILLA" && <Form.Item label="别墅楼层数" name="villaFloors" extra="毛坯别墅必填；每层生产工期+10天" rules={[{ required: true, type: "number", min: 1, message: "请填写至少1层" }]}><InputNumber disabled={isSupplement} min={1} precision={0} style={{ width: "100%" }} /></Form.Item>}
      {!isInternal && employee.role === "CHAIRMAN" && <Form.Item label="所属销售" name="salesId" rules={[{ required: true }]}><Select disabled={isSupplement && Boolean(parent?.sales?.id)} options={employees.filter((e) => e.role === "SALES" && salesBusinessTypes(e.businessUnit).includes(businessType as never)).map((e) => ({ value: e.id, label: `${e.name} · ${salesRoleLabel(e)}` }))} /></Form.Item>}
      <Form.Item label="分配设计师" name="designerId" rules={[{ required: true, message: "建单前必须分配设计师" }]}><Select disabled={(isSupplement && Boolean(parent?.designer?.id)) || employee.role === "DESIGNER"} options={employees.filter((e) => e.role === "DESIGNER").map((e) => ({ value: e.id, label: e.id === employee.id ? `${e.name}（本人）` : e.name }))} /></Form.Item>
      <Form.Item label="排程类型" name="rush"><Select options={[{ value: false, label: "标准工期" }, { value: true, label: "加急订单" }]} /></Form.Item>
      {rush && <><Form.Item label="加急原因" name="rushReason" rules={[{ required: true }]}><Input /></Form.Item><Form.Item label="客户承诺日期" name="rushPromisedAt" rules={[{ required: true }]}><DatePicker style={{ width: "100%" }} /></Form.Item></>}
      <div className="span-2 erp-modal-actions"><Button onClick={onCancel}>取消</Button><Button type="primary" htmlType="submit" loading={saving} disabled={!isInternal && !isSupplement && (!initialPaymentFiles.deposit.length || !initialPaymentFiles.prepayment.length)}>{isInternal ? "提交非常规订单" : isSupplement ? "创建关联补单" : "签订合同并报备两笔首付款"}</Button></div>
    </Form>
  </Modal>;
}

function ExceptionCommercialReviewModal({ order, paymentAccounts, onCancel, onSaved, api }: { order: Order | null; paymentAccounts: string[]; onCancel: () => void; onSaved: (order: Order) => void; api: ReturnType<typeof useApi>["call"] }) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [receiptFiles, setReceiptFiles] = useState<UploadFile[]>([]);
  const [saving, setSaving] = useState(false);
  const chargeMode = Form.useWatch("chargeMode", form) ?? order?.chargeMode ?? "CHARGED";
  useEffect(() => {
    if (!order) return;
    form.setFieldsValue({ chargeMode: order.chargeMode ?? "CHARGED", freeReason: order.freeReason ?? undefined });
    setReceiptFiles([]);
  }, [form, order]);
  async function submit(values: Record<string, unknown>) {
    if (!order) return;
    setSaving(true);
    try {
      let payload: Record<string, unknown> = { chargeMode: values.chargeMode, reviewComment: values.reviewComment };
      if (values.chargeMode === "CHARGED") {
        if (!receiptFiles[0]?.originFileObj) throw new Error("请上传定金凭证");
        const body = new FormData(); body.append("category", "DEPOSIT_RECEIPT"); body.append("file", receiptFiles[0].originFileObj as File);
        const receipt = await api<{ id: string }>(`/api/v1/attachments/${order.id}`, { method: "POST", body });
        payload = { ...payload, amount: values.amount, deposit: { amount: values.depositAmount, receivedAt: (values.receivedAt as { format: (v: string) => string }).format("YYYY-MM-DD"), account: values.account, receiptAttachmentIds: [receipt.id] } };
      } else payload = { ...payload, freeReason: values.freeReason };
      const saved = await api<Order>(`/api/v1/orders/${order.id}/exception-commercial-review`, { method: "POST", headers: { "x-expected-updated-at": order.updatedAt }, body: JSON.stringify(payload) });
      message.success(values.chargeMode === "FREE" ? "免费商务方式已确认，订单已进入设计" : "收费方式和定金已报备，等待财务核验");
      onSaved(saved);
    } catch (error) { message.error(error instanceof Error ? error.message : "商务确认失败"); }
    finally { setSaving(false); }
  }
  return <Modal title={`确认非常规订单商务方式 · ${order?.salesNumber ?? order?.trackingSerial ?? ""}`} open={Boolean(order)} onCancel={onCancel} footer={null} destroyOnHidden width={760}>
    <Alert type="info" showIcon title={`创建意向：${order?.chargeMode === "FREE" ? "预计免费" : "预计收费"}`} description={order?.exceptionReason ?? "未记录非常规原因"} />
    <Form form={form} layout="vertical" className="erp-form-grid" onFinish={submit}>
      <Form.Item label="最终商务方式" name="chargeMode" rules={[{ required: true }]}><Select options={[{ value: "CHARGED", label: "收费单" }, { value: "FREE", label: "免费单" }]} /></Form.Item>
      {chargeMode === "CHARGED" ? <>
        <Form.Item label="最终合同金额" name="amount" rules={[{ required: true }]}><InputNumber min={0.01} prefix="¥" style={{ width: "100%" }} /></Form.Item>
        <Form.Item label="定金金额" name="depositAmount" rules={[{ required: true }]}><InputNumber min={0.01} prefix="¥" style={{ width: "100%" }} /></Form.Item>
        <Form.Item label="定金到账日期" name="receivedAt" rules={[{ required: true }]}><DatePicker style={{ width: "100%" }} /></Form.Item>
        <Form.Item label="定金收款账户" name="account" rules={[{ required: true }]}><Select options={paymentAccounts.map((value) => ({ value, label: value }))} /></Form.Item>
        <Form.Item label="定金凭证" required><Upload maxCount={1} beforeUpload={() => false} fileList={receiptFiles} onChange={({ fileList }) => setReceiptFiles(fileList)}><Button icon={<RiUpload2Line size={16} />}>选择定金凭证</Button></Upload></Form.Item>
      </> : <Form.Item label="最终免费原因" name="freeReason" rules={[{ required: true }]} className="span-2"><Input.TextArea rows={3} /></Form.Item>}
      <Form.Item label="确认意见（选填）" name="reviewComment" className="span-2"><Input.TextArea rows={2} /></Form.Item>
      <div className="span-2 erp-modal-actions"><Button onClick={onCancel}>取消</Button><Button type="primary" htmlType="submit" loading={saving}>确认并提交</Button></div>
    </Form>
  </Modal>;
}

function RootApp() {
  const mobileRoute = window.location.pathname.replace(/\/+$/, "") === "/mobile";
  const { message, notification } = AntApp.useApp();
  const api = useApi();
  const [loading, setLoading] = useState(true);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [page, setPage] = useState("orders");
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Order | null>(null);
  const [technicalAreaId, setTechnicalAreaId] = useState<string | null>(null);
  const [productionTaskFocus, setProductionTaskFocus] = useState<{ productionAreaId: string; productionRouteId?: string | null } | null>(null);
  const [procurementAreaId, setProcurementAreaId] = useState<string | null>(null);
  const [selectedCost, setSelectedCost] = useState<MaterialCostVersion | null>(null);
  const [outsourceCostLine, setOutsourceCostLine] = useState<MaterialCostVersion["outsource"]["lines"][number] | null>(null);
  const [outsourceCostSaving, setOutsourceCostSaving] = useState(false);
  const [outsourceCostForm] = Form.useForm();
  const [timeline, setTimeline] = useState<EventItem[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [workflowAction, setWorkflowAction] = useState<WorkflowAction | null>(null);
  const [contractAmountOpen, setContractAmountOpen] = useState(false);
  const [contractAmountValue, setContractAmountValue] = useState<number>(0);
  const [contractAmountSaving, setContractAmountSaving] = useState(false);
  const [exceptionCommercialOrder, setExceptionCommercialOrder] = useState<Order | null>(null);
  const [afterSalesCreateOpen, setAfterSalesCreateOpen] = useState(false);
  const [afterSalesCostCase, setAfterSalesCostCase] = useState<AfterSalesCase | null>(null);
  const [afterSalesSaving, setAfterSalesSaving] = useState(false);
  const [afterSalesCreateFiles, setAfterSalesCreateFiles] = useState<UploadFile[]>([]);
  const [afterSalesFiles, setAfterSalesFiles] = useState<UploadFile[]>([]);
  const [afterSalesCreateForm] = Form.useForm();
  const [afterSalesCostForm] = Form.useForm();
  const [staticDemo, setStaticDemo] = useState(false);
  const [moduleData, setModuleData] = useState<Record<string, unknown>>({});
  const [moduleLoading, setModuleLoading] = useState(false);
  const [taskRefreshNonce, setTaskRefreshNonce] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccount[]>([]);
  const [paymentAccountOpen, setPaymentAccountOpen] = useState(false);
  const [customerDemoOpen, setCustomerDemoOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const shownNotifications = useRef(new Set<string>());
  const latestSelected = useRef<Order | null>(null);
  const productionExecutionRef = useRef<HTMLDivElement>(null);
  const [submissionDetail, setSubmissionDetail] = useState<NonNullable<Order["stageSubmissions"]>[number] | null>(null);
  const [publicConfig, setPublicConfig] = useState<PublicConfig>({ productName: "苔的跟单旅程" });
  const [loginPreludeOpen, setLoginPreludeOpen] = useState(() => {
    if (mobileRoute) return false;
    try { return window.sessionStorage.getItem(LOCAL_TEST_LOGIN_PAGE_KEY) !== "1"; }
    catch { return true; }
  });

  function clearSessionViews() {
    setPasswordOpen(false);
    setOrders([]);
    setTotal(0);
    setSearch("");
    setSelected(null);
    setTechnicalAreaId(null);
    setProductionTaskFocus(null);
    setProcurementAreaId(null);
    setSelectedCost(null);
    setTimeline([]);
    setCreateOpen(false);
    setCreateParentId(null);
    setWorkflowAction(null);
    setContractAmountOpen(false);
    setExceptionCommercialOrder(null);
    setAfterSalesCreateOpen(false);
    setAfterSalesCostCase(null);
    setAfterSalesFiles([]);
    setModuleData({});
    setNotifications([]);
    setPaymentAccounts([]);
    setPaymentAccountOpen(false);
    setCustomerDemoOpen(false);
    setNotificationOpen(false);
    setSubmissionDetail(null);
    shownNotifications.current.clear();
    notification.destroy();
    setPage("orders");
  }

  const loadOrders = useCallback(async () => {
    if (!employee || employee.mustChangePassword) return;
    const data = await api.call<{ items: Order[]; total: number }>(`/api/v1/orders?pageSize=100&search=${encodeURIComponent(search)}`);
    setOrders(data.items); setTotal(data.total);
  }, [api.call, employee, search]);

  const loadNotifications = useCallback(async () => {
    if (!employee || employee.mustChangePassword) return;
    const items = await api.call<NotificationItem[]>("/api/v1/notifications");
    setNotifications(items);
    items.filter((item) => !item.readAt && !shownNotifications.current.has(item.id)).forEach((item) => {
      shownNotifications.current.add(item.id);
      notification.open({ type: item.level === "ERROR" ? "error" : "warning", title: item.title, description: item.body, duration: 0, placement: "topRight" });
    });
  }, [api.call, employee, notification]);

  const loadPaymentAccounts = useCallback(async () => {
    if (!employee || employee.mustChangePassword) return;
    setPaymentAccounts(await api.call<PaymentAccount[]>("/api/v1/payment-accounts"));
  }, [api.call, employee]);

  useEffect(() => {
    fetch("/api/v1/public/config").then((response) => response.ok ? response.json() : null).then((value) => value && setPublicConfig(value)).catch(() => undefined);
    fetch("/api/v1/auth/me", { credentials: "include" }).then(async (response) => {
      if (response.status === 401) return null;
      if (!response.ok) throw new Error("static");
      return response.json();
    }).then(async (data) => {
      if (!data) return;
      const expectedClient = mobileRoute ? "mobile-readonly" : "desktop";
      const actualClient = data.employee.sessionClient ?? "desktop";
      if (actualClient !== expectedClient) {
        await fetch("/api/v1/auth/logout", { method: "POST", credentials: "include", headers: { "x-csrf-token": data.csrfToken } });
        return;
      }
      setEmployee(data.employee); api.setCsrf(data.csrfToken);
    }).catch(() => setStaticDemo(true)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const expire = () => { clearSessionViews(); setEmployee(null); api.setCsrf(""); };
    window.addEventListener("erp-session-expired", expire);
    return () => window.removeEventListener("erp-session-expired", expire);
  }, []);

  useEffect(() => { if (employee && !employee.mustChangePassword) { loadOrders().catch((e) => message.error(e.message)); loadPaymentAccounts().catch((e) => message.error(e.message)); api.call<Employee[]>("/api/v1/auth/employees").then(setEmployees).catch(() => undefined); } }, [employee, loadOrders, loadPaymentAccounts]);

  useEffect(() => { latestSelected.current = selected; }, [selected]);

  useEffect(() => {
    if (!employee || employee.mustChangePassword) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void loadOrders().catch(() => undefined);
    };
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [employee, loadOrders]);

  useEffect(() => {
    if (!employee || employee.mustChangePassword) return;
    loadNotifications().catch(() => undefined);
    const timer = window.setInterval(() => loadNotifications().catch(() => undefined), 30_000);
    return () => window.clearInterval(timer);
  }, [employee, loadNotifications]);

  useEffect(() => {
    if (!employee || employee.mustChangePassword || !["tasks", "procurement", "aftersales"].includes(page)) return;
    setModuleLoading(true);
    const request = page === "tasks"
      ? api.call<unknown[]>("/api/v1/tasks?scope=mine").then((tasks) => ({ tasks }))
      : page === "procurement"
        ? api.call<unknown[]>("/api/v1/procurement/orders").then(async (orders) => employee.costModuleEnabled && ["FINANCE", "CHAIRMAN"].includes(employee.role) ? Promise.all([api.call<unknown[]>("/api/v1/material-cost-items"), api.call<unknown[]>("/api/v1/workshop-cost-rates")]).then(([costItems, workshopRates]) => ({ orders, costItems, workshopRates })) : ({ orders, costItems: [], workshopRates: [] }))
        : api.call<unknown[]>("/api/v1/aftersales").then((aftersales) => ({ aftersales }));
    request.then(setModuleData).catch((error) => message.error(error.message)).finally(() => setModuleLoading(false));
  }, [employee, page, api.call, taskRefreshNonce]);

  useEffect(() => {
    if (!employee || employee.mustChangePassword || page !== "tasks") return;
    const timer = window.setInterval(() => setTaskRefreshNonce((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [employee, page]);

  useEffect(() => {
    if (!selected || !productionTaskFocus) return;
    const frame = window.requestAnimationFrame(() => productionExecutionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [selected?.id, productionTaskFocus]);

  async function openOrder(id: string, focus: { productionAreaId: string; productionRouteId?: string | null } | null = null) {
    try {
      const [order, events] = await Promise.all([
        api.call<Order>(`/api/v1/orders/${id}`),
        api.call<EventItem[]>(`/api/v1/orders/${id}/timeline`),
      ]);
      const cost = employee?.costModuleEnabled && ["FINANCE", "CHAIRMAN"].includes(employee.role) && order.materialVersion
        ? await api.call<MaterialCostVersion | null>(`/api/v1/orders/${id}/material-cost`).catch(() => null)
        : null;
      const validCost = cost && Number.isInteger(cost.version) && Array.isArray(cost.lines) && Number.isInteger(cost.missingPriceCount) ? cost : null;
      const validFocus = focus && order.productionAreas?.some((area) => area.id === focus.productionAreaId) ? focus : null;
      setSelected(order);
      setTechnicalAreaId((current) => validFocus?.productionAreaId ?? (order.productionAreas?.some((area) => area.id === current) ? current : order.productionAreas?.[0]?.id ?? null));
      setProductionTaskFocus(validFocus);
      setProcurementAreaId((current) => order.productionAreas?.some((area) => area.id === current) ? current : null);
      setTimeline(events); setSelectedCost(validCost);
    } catch (error) { message.error(error instanceof Error ? error.message : "订单加载失败"); }
  }

  useEffect(() => {
    const id = selected?.id;
    if (!id || !employee || employee.mustChangePassword || createOpen || workflowAction || contractAmountOpen || exceptionCommercialOrder || afterSalesCreateOpen || afterSalesCostCase || outsourceCostLine || submissionDetail || paymentAccountOpen || passwordOpen) return;
    let active = true;
    let pending = false;
    const refresh = async () => {
      if (!active || pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const [order, events] = await Promise.all([
          api.call<Order>(`/api/v1/orders/${id}`),
          api.call<EventItem[]>(`/api/v1/orders/${id}/timeline`),
        ]);
        const cost = employee.costModuleEnabled && ["FINANCE", "CHAIRMAN"].includes(employee.role) && order.materialVersion
          ? await api.call<MaterialCostVersion | null>(`/api/v1/orders/${id}/material-cost`).catch(() => null)
          : null;
        const current = latestSelected.current;
        if (!active || current?.id !== id || Date.parse(order.updatedAt) < Date.parse(current.updatedAt)) return;
        setSelected(order);
        setTimeline(events);
        setSelectedCost(cost && Number.isInteger(cost.version) && Array.isArray(cost.lines) && Number.isInteger(cost.missingPriceCount) ? cost : null);
        setTechnicalAreaId((value) => order.productionAreas?.some((area) => area.id === value) ? value : order.productionAreas?.[0]?.id ?? null);
        setProcurementAreaId((value) => order.productionAreas?.some((area) => area.id === value) ? value : null);
      } catch { /* The next visible refresh retries; active forms stay untouched. */ }
      finally { pending = false; }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(() => void refresh(), 30_000);
    document.addEventListener("visibilitychange", onVisible);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [api.call, employee, selected?.id, createOpen, workflowAction, contractAmountOpen, exceptionCommercialOrder, afterSalesCreateOpen, afterSalesCostCase, outsourceCostLine, submissionDetail, paymentAccountOpen, passwordOpen]);

  function confirmMaterialVersionCancellation(order: Order) {
    if (!order.materialVersion) return;
    let reason = "";
    Modal.confirm({
      title: `撤销物料发布版 M${order.materialVersion.version} 并整单重做`,
      width: 620,
      okText: "确认撤销并退回技术拆单",
      okButtonProps: { danger: true },
      content: <Space direction="vertical" size={12} style={{ width: "100%", marginTop: 12 }}>
        <Alert type="warning" showIcon title="不能局部覆盖物料版。原技术包、解析结果和成本核算版本会永久保留，拆单员需按订单实际类别重新上传并提交物料Excel。" />
        <div style={{ width: "100%" }}><Typography.Text strong>撤销原因（必填）</Typography.Text><Input.TextArea rows={3} onChange={(event) => { reason = event.target.value; }} /></div>
      </Space>,
      onOk: async () => {
        if (!reason.trim()) { message.error("请填写整版撤销原因"); return Promise.reject(); }
        try {
          await api.call(`/api/v1/material-versions/${order.materialVersion!.id}/cancel-and-rebuild`, { method: "POST", body: JSON.stringify({ reason: reason.trim(), supplierResolution: "NOT_APPLICABLE", receivedResolution: "KEEP_AS_STOCK" }) });
          await openOrder(order.id);
          await loadOrders();
          message.success("原物料版已保留归档，订单已退回技术部重新提交实际类别的物料Excel");
        } catch (error) {
          message.error(error instanceof Error ? error.message : "物料版撤销失败");
          return Promise.reject(error);
        }
      },
    });
  }

  async function reloadProcurement() {
    const orders = await api.call<unknown[]>("/api/v1/procurement/orders");
    const costItems = employee?.costModuleEnabled && ["FINANCE", "CHAIRMAN"].includes(employee.role) ? await api.call<unknown[]>("/api/v1/material-cost-items") : [];
    const workshopRates = employee?.costModuleEnabled && ["FINANCE", "CHAIRMAN"].includes(employee.role) ? await api.call<unknown[]>("/api/v1/workshop-cost-rates") : [];
    setModuleData({ orders, costItems, workshopRates });
  }

  async function updateContractAmount() {
    if (!selected) return;
    setContractAmountSaving(true);
    try {
      const updated = await api.call<Order>(`/api/v1/orders/${selected.id}/contract-amount`, { method: "POST", headers: { "x-expected-updated-at": selected.updatedAt }, body: JSON.stringify({ amount: contractAmountValue }) });
      setContractAmountOpen(false);
      setSelected(updated);
      await openOrder(updated.id);
      await loadOrders();
      message.success("合同金额已修改并保留审计记录");
    } catch (error) { message.error(error instanceof Error ? error.message : "合同金额修改失败"); }
    finally { setContractAmountSaving(false); }
  }

  async function createAfterSales(values: { issueType: string; description: string; incurredOn: { format: (pattern: string) => string }; amount: number }) {
    if (!selected) return;
    setAfterSalesSaving(true);
    try {
      const attachmentIds: string[] = [];
      for (const file of afterSalesCreateFiles) {
        const body = new FormData(); body.append("category", "AFTERSALES_COST"); body.append("file", file.originFileObj as File);
        const uploaded = await api.call<{ id: string }>(`/api/v1/attachments/${selected.id}`, { method: "POST", body });
        attachmentIds.push(uploaded.id);
      }
      await api.call("/api/v1/aftersales", { method: "POST", headers: { "x-expected-updated-at": selected.updatedAt }, body: JSON.stringify({ orderId: selected.id, issueType: values.issueType, description: values.description, incurredOn: values.incurredOn.format("YYYY-MM-DD"), amount: values.amount, attachmentIds }) });
      setAfterSalesCreateOpen(false);
      setAfterSalesCreateFiles([]);
      afterSalesCreateForm.resetFields();
      await openOrder(selected.id);
      await loadOrders();
      setTaskRefreshNonce((value) => value + 1);
      message.success("售后问题已登记，本次费用已计入订单成本");
    } catch (error) { message.error(error instanceof Error ? error.message : "售后登记失败"); }
    finally { setAfterSalesSaving(false); }
  }

  async function addAfterSalesCost(values: { incurredOn: { format: (pattern: string) => string }; amount: number; description: string }) {
    if (!afterSalesCostCase) return;
    setAfterSalesSaving(true);
    try {
      const attachmentIds: string[] = [];
      for (const file of afterSalesFiles) {
        const body = new FormData(); body.append("category", "AFTERSALES_COST"); body.append("file", file.originFileObj as File);
        const uploaded = await api.call<{ id: string }>(`/api/v1/attachments/${afterSalesCostCase.order.id}`, { method: "POST", body });
        attachmentIds.push(uploaded.id);
      }
      await api.call(`/api/v1/aftersales/${afterSalesCostCase.id}/cost-batches`, { method: "POST", headers: { "x-expected-updated-at": afterSalesCostCase.updatedAt }, body: JSON.stringify({ incurredOn: values.incurredOn.format("YYYY-MM-DD"), amount: values.amount, description: values.description, attachmentIds }) });
      setAfterSalesCostCase(null); setAfterSalesFiles([]); afterSalesCostForm.resetFields();
      setTaskRefreshNonce((value) => value + 1);
      if (selected?.id === afterSalesCostCase.order.id) await openOrder(selected.id);
      message.success("售后费用批次已累计");
    } catch (error) { message.error(error instanceof Error ? error.message : "售后费用登记失败"); }
    finally { setAfterSalesSaving(false); }
  }

  async function saveOutsourceCost() {
    if (!selected || !outsourceCostLine) return;
    const values = await outsourceCostForm.validateFields();
    setOutsourceCostSaving(true);
    try {
      await api.call(`/api/v1/orders/${selected.id}/outsource-cost/products/${outsourceCostLine.id}/prices`, { method: "POST", body: JSON.stringify(values) });
      setOutsourceCostLine(null);
      outsourceCostForm.resetFields();
      await openOrder(selected.id);
      message.success("外购成本已计入订单");
    } catch (error) { message.error(error instanceof Error ? error.message : "外购成本保存失败"); }
    finally { setOutsourceCostSaving(false); }
  }

  function voidAfterSalesCost(caseItem: AfterSalesCase, batchId: string) {
    let reason = "";
    Modal.confirm({ title: "作废售后费用批次", okText: "确认作废", okButtonProps: { danger: true }, content: <Input.TextArea style={{ marginTop: 12 }} rows={3} placeholder="作废原因（必填）" onChange={(event) => { reason = event.target.value; }} />, onOk: async () => {
      if (!reason.trim()) { message.error("请填写作废原因"); return Promise.reject(); }
      await api.call(`/api/v1/aftersales/${caseItem.id}/cost-batches/${batchId}/void`, { method: "POST", headers: { "x-expected-updated-at": caseItem.updatedAt }, body: JSON.stringify({ reason: reason.trim() }) });
      setTaskRefreshNonce((value) => value + 1); message.success("售后费用已作废，历史记录仍保留");
    } });
  }

  async function logout(destination?: string) {
    try { await api.call("/api/v1/auth/logout", { method: "POST" }); } catch { /* session may already be expired */ }
    clearSessionViews();
    api.setCsrf("");
    setEmployee(null);
    if (destination) window.location.assign(destination);
  }

  function confirmCompleteProcurement(order: Order) {
    let attested = false;
    Modal.confirm({
      title: `完成全部采购 · ${order.salesNumber ?? order.trackingSerial}`,
      width: 560,
      okText: "确认完成并进入四车间",
      content: <Space direction="vertical" size={12} style={{ width: "100%", marginTop: 12 }}>
        <Descriptions size="small" bordered column={1} items={[
          { key: "due", label: "采购截止", children: formatDate(order.procurementDueAt) },
          { key: "now", label: "完成时间", children: "以服务器提交时刻为准，不允许回填" },
          { key: "materials", label: "区域物料", children: `${order.productionAreas?.filter((area) => area.technicalPackage?.materialVersion).length ?? 0} 个区域已发布` },
          { key: "cost", label: "财务成本核算", children: "由财务在正式物料版发布后独立完成，不影响本次采购交期确认" },
        ]} />
        <Alert type="info" showIcon title="本动作只确认采购交期" description="采购不负责录入或补齐成本单价；财务成本核算未完成也不会阻止订单进入四车间。" />
        <Checkbox onChange={(event) => { attested = event.target.checked; }}>已在线下完成本订单全部采购</Checkbox>
      </Space>,
      onOk: async () => {
        if (!attested) { message.error("请先勾选线下采购完成确认"); return Promise.reject(); }
        try {
          await api.call(`/api/v1/orders/${order.id}/complete-procurement`, { method: "POST", headers: { "x-expected-updated-at": order.updatedAt }, body: JSON.stringify({ attested: true }) });
          await openOrder(order.id);
          await loadOrders();
          message.success("全部采购已记录，订单已直接进入四车间生产");
        } catch (error) {
          message.error(error instanceof Error ? error.message : "完成采购失败");
          return Promise.reject(error);
        }
      },
    });
  }

  function confirmProcurementRoute(order: Order, gate: NonNullable<Order["procurementRoutes"]>[number], area?: NonNullable<Order["productionAreas"]>[number]) {
    const routeLabel = gate.kind === "PANEL" ? "板式路线" : "实木油漆路线";
    let attested = false;
    const affectedAreas = area ? [area] : (order.productionAreas ?? []).filter((candidate) => candidate.routes?.some((route) => gate.affectedRouteIds.includes(route.id) && !route.released));
    const scopeLabel = area ? `${area.name} · ${area.productionNumber}` : `${affectedAreas.length} 个待确认区域`;
    Modal.confirm({
      title: area ? `确认${scopeLabel}的${routeLabel}采购完成` : `一键确认全部${routeLabel}采购完成`,
      width: 600,
      okText: area ? "确认并开放该区域" : `确认并开放 ${affectedAreas.length} 个区域`,
      content: <Space direction="vertical" size={12} style={{ width: "100%", marginTop: 12 }}>
        <Descriptions size="small" bordered column={1} items={[
          { key: "scope", label: "确认范围", children: area ? scopeLabel : <div><div>{scopeLabel}</div><ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>{affectedAreas.map((candidate) => <li key={candidate.id}>{candidate.name} · {candidate.productionNumber}</li>)}</ul></div> },
          { key: "due", label: "采购截止", children: formatDate(gate.dueAt) },
        ]} />
        <Checkbox onChange={(event) => { attested = event.target.checked; }}>已核对并确认上述{routeLabel}采购完成</Checkbox>
      </Space>,
      onOk: async () => {
        if (!attested) { message.error("请先勾选路线采购完成确认"); return Promise.reject(); }
        try {
          await api.call(`/api/v1/orders/${order.id}/procurement-routes/${gate.kind}/complete`, { method: "POST", headers: { "x-expected-updated-at": order.updatedAt }, body: JSON.stringify({ attested: true, ...(area ? { productionAreaId: area.id } : {}) }) });
          await openOrder(order.id); await loadOrders();
          message.success(area ? `${scopeLabel}的${routeLabel}已开放` : `全部待确认${routeLabel}已开放`);
        } catch (error) { message.error(error instanceof Error ? error.message : "路线采购确认失败"); return Promise.reject(error); }
      },
    });
  }

  function createProductionArea(order: Order) {
    let name = "";
    Modal.confirm({
      title: `新增生产区域 · ${order.salesNumber ?? order.trackingSerial}`,
      okText: "创建并领取生产编号",
      content: <div style={{ marginTop: 12 }}><Typography.Text strong>区域名称</Typography.Text><Input autoFocus placeholder="例如：客厅、主卧、卫生间" onChange={(event) => { name = event.target.value; }} /></div>,
      onOk: async () => {
        if (!name.trim()) { message.error("请填写区域名称"); return Promise.reject(); }
        try {
          const area = await api.call<{ id: string; name: string; productionNumber: string }>(`/api/v1/orders/${order.id}/areas`, { method: "POST", body: JSON.stringify({ name: name.trim() }) });
          await openOrder(order.id); await loadOrders(); setTechnicalAreaId(area.id);
          message.success(`${area.name}已创建，生产编号 ${area.productionNumber} 已永久分配`);
        } catch (error) { message.error(error instanceof Error ? error.message : "生产区域创建失败"); return Promise.reject(error); }
      },
    });
  }

  function cancelProductionArea(order: Order, area: NonNullable<Order["productionAreas"]>[number]) {
    let reason = "";
    Modal.confirm({
      title: `作废生产区域 · ${area.name} · ${area.productionNumber}`,
      okText: "确认作废（号码不复用）",
      okButtonProps: { danger: true },
      content: <div style={{ marginTop: 12 }}><Alert type="warning" showIcon title="区域结构不能原地替换；作废后生产编号永久保留审计，如需调整请创建新区域。" /><Input.TextArea style={{ marginTop: 12 }} rows={3} placeholder="作废原因（必填）" onChange={(event) => { reason = event.target.value; }} /></div>,
      onOk: async () => {
        if (!reason.trim()) { message.error("请填写作废原因"); return Promise.reject(); }
        try { await api.call(`/api/v1/orders/${order.id}/areas/${area.id}/cancel`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) }); await openOrder(order.id); await loadOrders(); message.success("区域已作废，原生产编号不会回收"); }
        catch (error) { message.error(error instanceof Error ? error.message : "区域作废失败"); return Promise.reject(error); }
      },
    });
  }

  async function finalizeTechnicalSet(order: Order) {
    try {
      await api.call(`/api/v1/orders/${order.id}/technical-submission-set`, { method: "POST", headers: { "x-expected-updated-at": order.updatedAt }, body: "{}" });
      await openOrder(order.id); await loadOrders();
      message.success("全部有效区域已锁定，整单拆单集合已提交订单管理员技术审单");
    } catch (error) { message.error(error instanceof Error ? error.message : "整单拆单提交失败"); }
  }

  function recordOutsourceArrival(order: Order, line: NonNullable<NonNullable<Order["fulfillmentTracks"]>["outsourced"]>["lines"][number]) {
    let quantity: number | null = line.remainingQty;
    let arrivedOn = "";
    Modal.confirm({
      title: `登记外购到货 · ${line.name}`,
      width: 520,
      okText: "确认登记",
      content: <div className="erp-outsource-arrival-modal">
        <Alert type="info" showIcon title={`计划 ${line.plannedQty} ${line.unit}，已到 ${line.arrivedQty} ${line.unit}，剩余 ${line.remainingQty} ${line.unit}`} />
        <div className="erp-outsource-arrival-fields">
          <div className="erp-outsource-arrival-row"><Typography.Text strong>本次到货数量</Typography.Text><InputNumber autoFocus min={1} max={line.remainingQty} precision={0} defaultValue={line.remainingQty} suffix={line.unit} className="erp-outsource-arrival-control" onChange={(value) => { quantity = value; }} /></div>
          <div className="erp-outsource-arrival-row"><Typography.Text strong>实际到货日期</Typography.Text><DatePicker format="YYYY-MM-DD" needConfirm={false} className="erp-outsource-arrival-control" onChange={(value) => { arrivedOn = value?.format("YYYY-MM-DD") ?? ""; }} /></div>
        </div>
      </div>,
      onOk: async () => {
        if (!quantity || quantity <= 0) { message.error("请填写本次到货数量"); return Promise.reject(); }
        if (!arrivedOn) { message.error("请选择实际到货日期"); return Promise.reject(); }
        try {
          await api.call(`/api/v1/orders/${order.id}/outsource/products/${line.id}/arrivals`, { method: "POST", headers: { "x-expected-updated-at": order.updatedAt }, body: JSON.stringify({ quantity, arrivedOn }) });
          await openOrder(order.id); await loadOrders();
          message.success(`${line.name}本次到货 ${quantity} ${line.unit}已登记`);
        } catch (error) { message.error(error instanceof Error ? error.message : "到货登记失败"); return Promise.reject(error); }
      },
    });
  }

  function voidOutsourceArrival(order: Order, line: NonNullable<NonNullable<Order["fulfillmentTracks"]>["outsourced"]>["lines"][number], arrival: { id: string; quantity: number }) {
    let reason = "";
    Modal.confirm({
      title: `作废到货记录 · ${line.name}`,
      okText: "确认作废",
      okButtonProps: { danger: true },
      content: <Input.TextArea style={{ marginTop: 12 }} rows={3} placeholder="作废原因（必填）" onChange={(event) => { reason = event.target.value; }} />,
      onOk: async () => {
        if (!reason.trim()) { message.error("请填写作废原因"); return Promise.reject(); }
        try {
          await api.call(`/api/v1/orders/${order.id}/outsource/arrivals/${arrival.id}/void`, { method: "POST", headers: { "x-expected-updated-at": order.updatedAt }, body: JSON.stringify({ reason: reason.trim() }) });
          await openOrder(order.id); await loadOrders();
          message.success(`${line.name}的 ${arrival.quantity} ${line.unit}到货记录已作废`);
        } catch (error) { message.error(error instanceof Error ? error.message : "到货记录作废失败"); return Promise.reject(error); }
      },
    });
  }

  if (loading) return <div className="erp-centered"><Spin size="large" /></div>;
  if (staticDemo) return <div className="erp-centered"><Alert type="info" showIcon title="静态构建预览" description="真实登录、权限、编号和工作流需在 localhost 本地前后端联调环境中使用。" /></div>;
  if (!employee && loginPreludeOpen && !mobileRoute) return <LoginPrelude filing={publicConfig} onEnter={() => setLoginPreludeOpen(false)} />;
  if (!employee) return <ConfigProvider theme={{ token: { colorPrimary: "#0b493d", colorInfo: "#0b493d", colorSuccess: "#28735f", colorWarning: "#c98555", colorError: "#c45f62", colorText: "#17231f", colorTextSecondary: "#60716b", colorBgContainer: "#ffffff", colorBorder: "#c7d8d2", colorBorderSecondary: "#e7efec", borderRadius: 12, boxShadowSecondary: "0 12px 34px rgba(3, 26, 22, .16)" }, components: { Table: { headerBg: "#eaf3ef", headerColor: "#36554b", rowHoverBg: "#f1f7f4" }, Button: { primaryShadow: "0 6px 16px rgba(6, 37, 31, .24)" }, Card: { headerBg: "transparent" } } }}><Login mobileReadonly={mobileRoute} filing={publicConfig} onLogin={(value, csrf) => { clearSessionViews(); setEmployee(value); api.setCsrf(csrf); }} /></ConfigProvider>;
  if (employee.mustChangePassword || passwordOpen) return <PasswordPanel api={api.call} required={Boolean(employee.mustChangePassword)} onChanged={() => { clearSessionViews(); api.setCsrf(""); setEmployee(null); }} onCancel={employee.mustChangePassword ? undefined : () => setPasswordOpen(false)} />;
  if (mobileRoute) return <div className={publicConfig.environment === "company-test" ? "erp-company-test-mobile" : undefined}>{publicConfig.environment === "company-test" && <div className="erp-company-test-banner">公司云测试环境 · 仅使用编造的测试数据</div>}<MobileReadonly employee={employee} orders={orders} api={api.call} filing={publicConfig} onRefresh={loadOrders} onLogout={logout} /></div>;

  const canCreate = ["SALES", "DESIGNER", "TECHNICAL", "ORDER_ADMIN", "CHAIRMAN"].includes(employee.role);
  const columns: ColumnsType<Order> = [
    { title: "销售编号", key: "number", width: 170, fixed: "left", render: (_, row) => <div className="erp-number"><strong>{row.salesNumber ?? row.trackingSerial}</strong><small>{row.salesNumber ? row.trackingSerial : "待正式设计提交"}</small></div> },
    { title: "客户 / 项目", key: "customer", width: 230, render: (_, row) => <div><strong>{row.customerName}</strong><small className="erp-subline">{row.address}</small></div> },
    { title: "分类", key: "businessType", width: 180, render: (_, row) => <div>{row.businessTypeLabel}<small className="erp-subline">{row.creationModeLabel ?? "常规销售订单"}{row.creationMode === "INTERNAL_EXCEPTION" ? ` · ${row.chargeModeLabel ?? "待确认"}` : ""}</small></div> },
    { title: "当前环节", dataIndex: "stage", width: 170, render: (value, row) => <Space size={4}><Tag color="cyan">{row.stageLabel ?? STAGES.find(([key]) => key === value)?.[1] ?? value}</Tag>{row.afterSalesActive && <Tag color="purple">售后处理中</Tag>}</Space> },
    { title: "当前负责", dataIndex: "currentOwnerLabel", width: 130 },
    { title: "下一动作", dataIndex: "nextAction", width: 220 },
    { title: "客户交期", dataIndex: "promisedAt", width: 130, render: formatDate },
    { title: "风险", dataIndex: "riskCount", width: 90, render: (value) => value ? <Tag color="error">{value} 项</Tag> : <Tag color="success">正常</Tag> },
    { title: "销售 / 设计", key: "people", width: 160, render: (_, row) => <>{row.sales?.name ?? "—"}<small className="erp-subline">{row.designer?.name ?? "待分配"}</small></> },
  ];

  function openTaskTarget(row: Record<string, unknown>) {
    if (row.action === "REVIEW_PAYMENT_ACCOUNT") { setPaymentAccountOpen(true); return; }
    const order = row.order as Record<string, any> | undefined;
    if (!order?.id) return;
    const area = order.productionArea as { id?: string } | null | undefined;
    const focus = area?.id ? { productionAreaId: area.id, productionRouteId: row.productionRouteId ? String(row.productionRouteId) : null } : null;
    openOrder(String(order.id), focus);
  }

  const moduleContent = page === "numbering" && ["CHAIRMAN", "ORDER_ADMIN"].includes(employee.role) ? <NumberReservations api={api.call} /> : page === "mini-accounts" && ["CHAIRMAN", "ORDER_ADMIN"].includes(employee.role) ? <MiniProgramAccounts api={api.call} /> : page === "accounts" && employee.role === "CHAIRMAN" ? <AccountWorkspace api={api.call} /> : page === "tasks" ? <div className="erp-module-page">
    <div className="erp-page-title"><div><Typography.Title level={2}>个人与部门待办</Typography.Title><p>{employee.role === "WORKSHOP" ? "仅显示本人负责且已解除前序锁定的工序；完成当前工序后自动开放下一道" : "按逾期、加急、临期、普通排序；拆单按每人每日最多6万元顺序排期，周日不计"}</p></div><Button loading={moduleLoading} onClick={() => setTaskRefreshNonce((value) => value + 1)}>刷新待办</Button></div>
    <Card className="erp-table-card erp-task-table-card"><Table className="erp-task-table" loading={moduleLoading} rowKey="id" pagination={false} tableLayout="fixed" scroll={{ x: employee.role === "TECHNICAL" ? 1310 : employee.role === "WORKSHOP" ? 1030 : 1060 }} dataSource={(moduleData.tasks as Record<string, unknown>[] | undefined) ?? []} onRow={(row) => ({ onClick: () => openTaskTarget(row) })} columns={[
      { title: "紧急度", dataIndex: "urgency", width: 84, render: (value) => { const labels: Record<string, string> = { OVERDUE: "已逾期", RUSH: "加急", DUE_SOON: "临期", NORMAL: "普通" }; const colors: Record<string, string> = { OVERDUE: "error", RUSH: "volcano", DUE_SOON: "warning", NORMAL: "default" }; return <Tag color={colors[String(value)]}>{labels[String(value)] ?? "普通"}</Tag>; } },
      { title: "销售编号 / 客户", key: "order", width: 260, render: (_, row) => { const order = row.order as Record<string, any> | undefined; const paymentReview = row.action === "REVIEW_PAYMENT_ACCOUNT"; const primary = paymentReview ? "非订单事项" : order?.salesNumber ?? order?.trackingSerial ?? "—"; const customer = paymentReview ? "收款账户申请" : order?.customerName ?? "客户待补充"; const label = `${primary} · ${customer}`; return <Tooltip title={label}><Button type="link" className="erp-inline-link erp-task-business-link" onClick={(event) => { event.stopPropagation(); openTaskTarget(row); }}><span className="erp-task-business-main"><strong>{primary}</strong><small>{customer}</small></span></Button></Tooltip>; } },
      ...(employee.role === "WORKSHOP" ? [{ title: "生产区域 / 生产编号", key: "productionArea", width: 220, render: (_: unknown, row: Record<string, unknown>) => { const order = row.order as Record<string, any> | undefined; const area = order?.productionArea as Record<string, string> | null | undefined; const scopeLabel = typeof order?.taskScopeLabel === "string" ? order.taskScopeLabel : null; const areaName = area?.name ?? scopeLabel ?? "历史整单生产"; const productionNumber = area?.productionNumber ?? (scopeLabel === "整单外购" ? "无生产编号" : order?.productionNumber ?? "历史编号"); const label = `${areaName} · ${productionNumber}`; return <Tooltip title={label}><span className="erp-task-production-area"><strong>{areaName}</strong><small>{productionNumber}</small></span></Tooltip>; } }] : []),
      ...(employee.role === "WORKSHOP" ? [] : [{ title: "任务", dataIndex: "title", width: 250, ellipsis: { showTitle: true } }]),
      { title: employee.role === "WORKSHOP" ? "责任车间" : "责任部门", dataIndex: "department", width: employee.role === "WORKSHOP" ? 250 : 140, ellipsis: { showTitle: true }, render: (value, row) => employee.role === "WORKSHOP" ? <span className="erp-task-responsibility"><strong>{String(value ?? "车间待办")}</strong><small>{String((row as Record<string, unknown>).title ?? "")}</small></span> : value },
      ...(employee.role === "TECHNICAL" ? [
        { title: "计划开始", dataIndex: "plannedStartAt", width: 120, render: (value: unknown) => value ? formatDay(String(value)) : "—" },
        { title: "占用产能", dataIndex: "workloadDays", width: 130, render: (value: unknown) => value ? `${value} 个工作日` : "—" },
      ] : []),
      { title: employee.role === "WORKSHOP" ? "车间最晚完成" : "截止", dataIndex: "dueAt", width: 134, render: (value) => value ? formatDate(String(value)) : "—" },
      { title: "状态", dataIndex: "status", width: 88, render: (value) => <Tag color={value === "OVERDUE" ? "error" : value === "COMPLETE" ? "success" : "processing"}>{value === "OVERDUE" ? "已超期" : value === "COMPLETE" ? "已完成" : "待处理"}</Tag> },
      { title: "延期", dataIndex: "delayDays", width: 104, render: (value) => value ? `延期 ${value} 天` : "—" },
    ]} /></Card>
  </div> : page === "procurement" ? <ProcurementWorkspace employee={employee} api={api.call} data={moduleData} loading={moduleLoading} refresh={reloadProcurement} openOrder={openOrder} /> : page === "aftersales" ? <div className="erp-module-page">
    <div className="erp-page-title"><div><Typography.Title level={2}>安装与售后</Typography.Title><p>诺尔丽20年、艾可居10年，从各订单的最终验收签字日独立起算</p></div></div>
    <Card className="erp-table-card"><Table<AfterSalesCase> loading={moduleLoading} rowKey="id" pagination={false} dataSource={(moduleData.aftersales as AfterSalesCase[] | undefined) ?? []} locale={{ emptyText: <Empty description="暂无售后单，主订单履约状态不会因售后重新打开" /> }} expandable={{ expandedRowRender: (row) => row.costBatches ? <Table size="small" rowKey="id" pagination={false} dataSource={row.costBatches} locale={{ emptyText: "尚无售后费用" }} columns={[
      { title: "发生日期", dataIndex: "incurredOn", render: (value) => formatDay(String(value)) }, { title: "金额", dataIndex: "amount", render: formatMoney }, { title: "说明", dataIndex: "description" }, { title: "状态", render: (_, batch) => batch.voidedAt ? <Tag>已作废 · {batch.voidReason}</Tag> : <Tag color="processing">有效</Tag> }, { title: "操作", render: (_, batch) => !batch.voidedAt && ["AFTERSALES", "CHAIRMAN"].includes(employee.role) ? <Button size="small" danger onClick={() => voidAfterSalesCost(row, batch.id)}>作废</Button> : "—" },
    ]} /> : <Alert type="info" showIcon title="当前账号无售后费用明细权限" /> }} columns={[
      { title: "售后单号", dataIndex: "caseNumber" }, { title: "销售订单", key: "order", render: (_, row) => (row.order as Record<string, string> | undefined)?.salesNumber ?? (row.order as Record<string, string> | undefined)?.trackingSerial ?? "—" },
      { title: "客户", key: "customer", render: (_, row) => (row.order as Record<string, string> | undefined)?.customerName ?? "—" }, { title: "问题类型", dataIndex: "issueType" },
      { title: "质保", dataIndex: "warrantyYears", render: (value) => value ? `${value} 年` : "人工判定" }, { title: "售后费用", dataIndex: "costSubtotal", render: (value, row) => value == null ? "无权限" : <Space><strong>{formatMoney(value)}</strong><Tag color="processing">累计中</Tag></Space> }, { title: "状态", dataIndex: "status", render: (value) => <Tag color="processing">{String(value)}</Tag> },
      { title: "操作", fixed: "right", width: 120, render: (_, row) => employee.costModuleEnabled && ["AFTERSALES", "CHAIRMAN"].includes(employee.role) ? <Button size="small" type="primary" onClick={() => { setAfterSalesCostCase(row); setAfterSalesFiles([]); afterSalesCostForm.resetFields(); }}>新增费用批次</Button> : "—" },
    ]} /></Card>
  </div> : null;

  const selectedTechnicalArea = selected?.productionAreas?.find((area) => area.id === technicalAreaId) ?? selected?.productionAreas?.[0] ?? null;
  const selectedProductionTaskFocus = productionTaskFocus?.productionAreaId === selectedTechnicalArea?.id ? productionTaskFocus : null;
  const visibleTechnicalRoutes = selectedTechnicalArea?.routes?.filter((route) => !selectedProductionTaskFocus?.productionRouteId || route.id === selectedProductionTaskFocus.productionRouteId) ?? [];
  const pendingTechnicalAreas = (selected?.productionAreas ?? []).filter((area) => area.technicalPackage?.status !== "SUBMITTED");
  const outsourceTechnicalDraftReady = selected?.outsourceRequirementMode === "LEGACY_EXEMPT" || selected?.outsourceRequirement?.status === "DRAFT";
  const technicalSetReady = Boolean(selected?.productionAreas?.length) && pendingTechnicalAreas.length === 0 && outsourceTechnicalDraftReady;
  const technicalSetBlocker = !selected?.productionAreas?.length
    ? "请先创建至少一个生产区域"
    : pendingTechnicalAreas.length
      ? `${pendingTechnicalAreas.map((area) => area.name).join("、")}仍需分别上传资料并提交技术包`
      : !outsourceTechnicalDraftReady
        ? "请先保存订单级外购成品声明，也可以明确选择无外购成品"
        : undefined;
  const selectedProcurementEntries = selected?.productionAreas?.flatMap((area) => (area.routes ?? []).map((route) => ({
    area,
    route,
    gate: selected.procurementRoutes?.find((gate) => gate.kind === route.kind),
  })).filter((entry) => Boolean(entry.gate))) ?? [];
  const selectedProcurementAreas = (selected?.productionAreas ?? []).map((area) => ({ area, entries: selectedProcurementEntries.filter((entry) => entry.area.id === area.id) })).filter(({ entries }) => entries.length > 0);
  const selectedProcurementArea = selectedProcurementAreas.find(({ area }) => area.id === procurementAreaId) ?? null;
  const completedProcurementAreas = selectedProcurementAreas.filter(({ entries }) => entries.every(({ route }) => route.released)).length;
  const completedProcurementRoutes = selectedProcurementEntries.filter(({ route }) => route.released).length;
  const procurementConfirmationCard = selected && selectedProcurementAreas.length ? <Card title="按生产区域确认采购" className="erp-panel" extra={<Space wrap><Tag color={completedProcurementAreas === selectedProcurementAreas.length ? "success" : "processing"}>{completedProcurementAreas}/{selectedProcurementAreas.length} 区域完成 · {completedProcurementRoutes}/{selectedProcurementEntries.length} 路线完成</Tag>{["PROCUREMENT", "CHAIRMAN"].includes(employee.role) && selected.procurementRoutes?.filter((gate) => selectedProcurementEntries.some((entry) => entry.gate?.id === gate.id && !entry.route.released)).map((gate) => <Button key={gate.id} size="small" onClick={() => confirmProcurementRoute(selected, gate)}>一键确认全部{gate.kind === "PANEL" ? "板式" : "实木油漆"}</Button>)}</Space>}>
    <div className="erp-procurement-area-scroll" role="region" aria-label="生产区域采购横向滚动列表" tabIndex={0}>{selectedProcurementAreas.map(({ area, entries }) => {
      const completed = entries.filter(({ route }) => route.released).length;
      const status = completed === entries.length ? "采购已完成" : completed > 0 ? "部分完成" : "等待采购确认";
      return <Card key={area.id} size="small" role="button" tabIndex={0} className="erp-procurement-area-card" onClick={() => setProcurementAreaId(area.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setProcurementAreaId(area.id); } }}>
        <div className="erp-procurement-area-head"><div><strong>{area.name}</strong><small>{area.productionNumber}</small></div><Tag color={completed === entries.length ? "success" : completed > 0 ? "processing" : "warning"}>{status}</Tag></div>
        <span>{entries.length} 条适用路线 · {completed}/{entries.length} 已确认</span>
        <b>查看并确认路线</b>
      </Card>;
    })}</div>
  </Card> : null;
  const content = selected ? <div className="erp-detail-page">
    <Button icon={<RiArrowLeftLine size={16} />} onClick={() => { setSelected(null); setSelectedCost(null); setProductionTaskFocus(null); setProcurementAreaId(null); }}>返回订单列表</Button>
    <section className="erp-order-hero">
      <div><span className="erp-kicker">{selected.salesNumber ? "销售编号" : "跟单流水号"}</span><Typography.Title level={2}>{selected.salesNumber ?? selected.trackingSerial}</Typography.Title><p>{selected.salesNumber ? `跟单流水号 ${selected.trackingSerial}` : "正式设计提交后生成销售编号"} · {selected.customerName}</p></div>
      <Space wrap>
        {selectedCost && <Button onClick={() => document.getElementById("order-material-cost")?.scrollIntoView({ behavior: "smooth", block: "start" })}>查看成本明细</Button>}
        {selected.creationMode === "INTERNAL_EXCEPTION" && selected.commercialStatus === "PENDING" && employee.role === "ORDER_ADMIN" && <Button type="primary" onClick={() => setExceptionCommercialOrder(selected)}>确认商务方式</Button>}
        {["ORDER_ADMIN", "CHAIRMAN"].includes(employee.role) && !(selected.shipments?.length) && !selected.tailPaymentReported && !selected.tailPaymentConfirmed && selected.amount != null && <Button onClick={() => { setContractAmountValue(Number(selected.amount)); setContractAmountOpen(true); }}>修改合同金额</Button>}
        {selected.stage === "BUSINESS_COMPLETE" && employee.costModuleEnabled && ["CHAIRMAN", "AFTERSALES"].includes(employee.role) && <Button type="primary" onClick={() => { afterSalesCreateForm.resetFields(); setAfterSalesCreateFiles([]); setAfterSalesCreateOpen(true); }}>登记售后</Button>}
        {selected.productionExecutionMode !== "ROUTE_V2" && selected.stage === "MATERIALS" && ["PUBLISHED", "WAREHOUSE_RELEASED"].includes(selected.materialVersion?.status ?? "") && ["PROCUREMENT", "CHAIRMAN"].includes(employee.role) && <Button type="primary" onClick={() => confirmCompleteProcurement(selected)}>完成全部采购</Button>}
        {availableActions(selected, employee).map((item) => <Button key={item.command} type={item.danger ? "default" : "primary"} danger={item.danger} onClick={() => setWorkflowAction(item)}>{item.label}</Button>)}
      </Space>
    </section>
    {selected.technicalPackage?.designVersion === "LOCAL-COST-SAMPLE" && <Alert type="warning" showIcon title="本地成本测试样例 · 数据已保存，刷新不会消失" description={selected.technicalPackage.validationSummary} />}
    <Card className="erp-stage-card"><OrderStatusBar order={selected} /></Card>
    <div className="erp-detail-grid">
      <div>
        <Card title="当前控制面" className="erp-panel">
          <div className="erp-control-grid">
            <div><span>当前负责人</span><strong>{selected.currentOwnerLabel}</strong></div>
            <div><span>下一动作</span><strong className="teal-text">{selected.nextAction}</strong></div>
            <div><span>当前任务截止</span><strong>{formatDate(selected.currentTask?.dueAt ?? selected.internalDueAt)}</strong></div>
            <div><span>风险</span><strong className={(selected.risks?.length ?? 0) ? "danger-text" : ""}>{(selected.risks?.length ?? 0) ? `${selected.risks!.length} 项待处理` : "无阻断风险"}</strong></div>
          </div>
          {Boolean(selected.risks?.length) && <div className="erp-risk-list">
            {selected.risks!.map((risk) => {
              const action = risk.resolutionCommand ? availableActions(selected, employee).find((item) => item.command === risk.resolutionCommand) : undefined;
              return <Alert key={risk.id} type="warning" showIcon title={risk.title} description={<div><p>{risk.description}</p><p><strong>影响：</strong>{risk.impact}</p><p><strong>责任：</strong>{risk.responsible}</p></div>} action={action ? <Button size="small" type="primary" onClick={() => setWorkflowAction(action)}>{risk.resolutionLabel}</Button> : <Tag>{risk.resolutionLabel}</Tag>} />;
            })}
          </div>}
        </Card>
        {employee.role === "PROCUREMENT" && procurementConfirmationCard}
        {selected.salesNumber && <Card title="生产区域总览" className="erp-panel erp-production-area-overview" extra={selected.stage === "TECHNICAL" && ["TECHNICAL", "CHAIRMAN"].includes(employee.role) ? <Space><Tag color={pendingTechnicalAreas.length ? "processing" : "success"}>{(selected.productionAreas?.length ?? 0) - pendingTechnicalAreas.length}/{selected.productionAreas?.length ?? 0} 区域技术包已提交</Tag><Button onClick={() => createProductionArea(selected)}>新增区域并领号</Button><Tooltip title={technicalSetBlocker}><span><Button type="primary" disabled={!technicalSetReady} onClick={() => finalizeTechnicalSet(selected)}>提交并锁定所有区域</Button></span></Tooltip></Space> : <Tag>{selected.areaSummary?.completed ?? 0}/{selected.areaSummary?.total ?? 0} 区域完工 · {selected.areaSummary?.shipped ?? 0} 已发货</Tag>}>
          {selected.productionAreas?.length ? <div className="erp-production-area-grid" tabIndex={0} role="region" aria-label="生产区域横向滚动列表">{selected.productionAreas.map((area) => {
            const plan = projectTechnicalAreaPlan(area, selected.stageSubmissions);
            return <Card key={area.id} size="small" className={technicalAreaId === area.id ? "erp-production-area-card selected" : "erp-production-area-card"} onClick={() => { setTechnicalAreaId(area.id); setProductionTaskFocus(null); }}>
              <div className="erp-area-card-head"><div><strong>{area.name}</strong><small className="erp-subline">{area.productionNumber}</small></div><Space size={4}><Tag color={area.shipped ? "success" : area.production.complete ? "cyan" : area.status.includes("TECHNICAL") || area.status.includes("LOCKED") ? "blue" : "default"}>{area.shipped ? "已发货" : area.production.complete ? "已完工" : `${area.production.percent}%`}</Tag>{selected.stage === "TECHNICAL" && ["TECHNICAL", "CHAIRMAN"].includes(employee.role) && !area.technicalPackage && <Button size="small" danger onClick={(event) => { event.stopPropagation(); cancelProductionArea(selected, area); }}>作废</Button>}</Space></div>
              <div className="erp-area-route">{plan.route ? <><Tag color={plan.route.panelEnabled ? "green" : "default"}>板式{plan.route.panelEnabled ? "启用" : "不启用"}</Tag><Tag color={plan.route.woodPaintEnabled ? "blue" : "default"}>木工＋油漆{plan.route.woodPaintEnabled ? "启用" : "不启用"}</Tag></> : <Tag>待选择生产路线</Tag>}<Tag color={plan.status === "DRAFT_READY" || plan.status === "SUBMITTED" ? "success" : plan.status === "DRAFT_COMPLETE" ? "processing" : plan.status === "DRAFT_INCOMPLETE" ? "warning" : "default"}>{plan.label}</Tag></div>
              {Boolean(area.routes?.length) && <div className="erp-area-route-status">{area.routes!.map((route) => <Tag key={route.id} color={route.shipped ? "success" : route.complete ? "cyan" : route.released ? "processing" : "default"}>{route.label}·{route.shipped ? "已发货" : route.complete ? "已完工" : route.released ? `${route.percent}%` : "待采购"}</Tag>)}</div>}
              {selected.stage === "TECHNICAL" && ["TECHNICAL", "CHAIRMAN"].includes(employee.role) && !area.technicalPackage && <div className="erp-area-card-actions"><Button size="small" type="primary" ghost onClick={(event) => { event.stopPropagation(); setTechnicalAreaId(area.id); setWorkflowAction({ command: "SUBMIT_TECHNICAL", label: "提交拆单版本", productionAreaId: area.id }); }}>继续提交技术包</Button></div>}
              <Progress percent={area.production.percent} showInfo={false} size="small" />
            </Card>;
          })}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={selected.stage === "TECHNICAL" ? "请先新增至少一个生产区域" : "尚无生产区域"} />}
          {selected.stage === "TECHNICAL" && ["TECHNICAL", "CHAIRMAN"].includes(employee.role) && technicalSetReady && <Alert style={{ marginTop: 16 }} type="success" showIcon title="全部区域与外购声明已就绪" description="点击右上角“提交并锁定所有区域”，系统会一次性锁定当前整单并开启订单管理员技术审单。" />}
        </Card>}
        {selected.stage === "TECHNICAL" && ["TECHNICAL", "CHAIRMAN"].includes(employee.role) && <OutsourceRequirementEditor orderId={selected.id} updatedAt={selected.updatedAt} mode={selected.outsourceRequirementMode} api={api.call} onSaved={async () => { await openOrder(selected.id); await loadOrders(); }} />}
        {selected.stage === "TECHNICAL" && ["TECHNICAL", "CHAIRMAN"].includes(employee.role) && selectedTechnicalArea && <MaterialImportWorkspace order={selected} area={selectedTechnicalArea} api={api.call} />}
        {!["FINANCE", "PROCUREMENT"].includes(employee.role) && visibleTechnicalRoutes.length ? <div ref={productionExecutionRef} className="erp-route-execution-list">{visibleTechnicalRoutes.map((route) => <ProductionExecution key={route.id} order={{ ...selected, production: route.production }} employee={employee} api={api.call} canRelease={false} areaLabel={`${selectedTechnicalArea!.name} · ${selectedTechnicalArea!.productionNumber} · ${route.label}`} onUpdated={async (order) => { setSelected(order); setTimeline(await api.call<EventItem[]>(`/api/v1/orders/${order.id}/timeline`)); await loadOrders(); }} />)}</div> : !["FINANCE", "PROCUREMENT"].includes(employee.role) && selectedTechnicalArea?.production.processes.length ? <div ref={productionExecutionRef}><ProductionExecution key={selectedTechnicalArea.id} order={{ ...selected, production: selectedTechnicalArea.production }} employee={employee} api={api.call} canRelease={false} areaLabel={`${selectedTechnicalArea.name} · ${selectedTechnicalArea.productionNumber}`} onUpdated={async (order) => { setSelected(order); setTimeline(await api.call<EventItem[]>(`/api/v1/orders/${order.id}/timeline`)); await loadOrders(); }} /></div> : null}
        {employee.role !== "FINANCE" && !selected.productionAreas?.length && (selected.stage === "PRODUCTION" || Boolean(selected.production?.processes.length)) && <ProductionExecution order={selected} employee={employee} api={api.call} canRelease={Boolean(selected.permissions?.canReleaseProduction)} onUpdated={async (order) => { setSelected(order); setTimeline(await api.call<EventItem[]>(`/api/v1/orders/${order.id}/timeline`)); await loadOrders(); }} />}
        {selected.packageSummary && ["MATERIALS", "PRODUCTION", "INSTALLATION_APPLICATION", "DELIVERY", "INSTALLATION", "ACCEPTANCE", "BUSINESS_COMPLETE"].includes(selected.stage) && <PackageCountPanel order={selected} employee={employee} api={api.call} onUpdated={async () => { await openOrder(selected.id); await loadOrders(); setTaskRefreshNonce((value) => value + 1); }} />}
        {selected.fulfillmentTracks && ["MATERIALS", "PRODUCTION", "INSTALLATION_APPLICATION", "DELIVERY", "INSTALLATION", "ACCEPTANCE", "BUSINESS_COMPLETE"].includes(selected.stage) && <Card title="发货执行" className="erp-panel" extra={<Tag color={selected.fulfillmentTracks.installationCompletionAllowed ? "success" : "processing"}>{selected.fulfillmentTracks.installationCompletionAllowed ? "履约发货已齐" : "两条履约线独立执行"}</Tag>}>
          <div className="erp-fulfillment-grid">
            <section className="erp-fulfillment-track">
              <div className="erp-track-head"><div><strong>定制产品区域批次</strong><small>一车可含多区域、多路线；每个自产车次同时登记安装安排</small></div><Tag color={selected.fulfillmentTracks.manufactured.installed ? "success" : selected.fulfillmentTracks.manufactured.allowed ? "cyan" : "default"}>{selected.fulfillmentTracks.manufactured.installed ? "全部批次已安装" : selected.fulfillmentTracks.manufactured.shipped ? "各区域末批已登记" : selected.fulfillmentTracks.manufactured.allowed ? "可登记发货" : "待解锁"}</Tag></div>
              <div className="erp-gate-row"><Tag color={selected.chargeMode === "FREE" && selected.commercialStatus === "CONFIRMED" ? "success" : selected.shipmentGate?.tailPaymentConfirmed ? "success" : "default"}>{selected.chargeMode === "FREE" && selected.commercialStatus === "CONFIRMED" ? "免费单·无需尾款" : `尾款${selected.shipmentGate?.tailPaymentConfirmed ? "已确认" : "待确认"}`}</Tag><Tag color="blue">安装安排随本车次发货登记</Tag></div>
              <Table size="small" pagination={false} scroll={{ x: 1100 }} rowKey="id" dataSource={(selected.shipments ?? []).filter((shipment) => shipment.kind === "MANUFACTURED")} locale={{ emptyText: "尚无定制产品发货批次" }} columns={[
                { title: "发货日期 / 登记时间", width: 205, render: (_, shipment) => <div><strong>{formatDateOnly(shipment.deliveredAt)}</strong><small className="erp-subline">登记：{formatShipmentRegistrationTime(shipment.createdAt)}</small><small className="erp-subline">车辆：{shipment.vehicle}</small></div> },
                { title: "区域 / 路线批次", width: 315, render: (_, shipment) => shipment.areas.map((line) => <Tag key={line.id}>{line.areaName}第{line.sequence}车次{line.routeLines?.length ? ` · ${line.routeLines.map((route) => `${route.routeLabel}第${route.sequence}批${route.isFinalBatch ? "(末批)" : ""}`).join("＋")}` : ""}{line.isFinalBatch ? " · 区域收口" : ""}</Tag>) },
                { title: "本车次安装安排", width: 290, render: (_, shipment) => shipment.plannedInstallationAt ? <div><strong>{shipment.assignedInstaller?.name || "未指定负责人"} · {shipment.installationTeamLabel || shipment.installationDepartment || "待安排班组"}</strong><small className="erp-subline">计划：{formatDateOnly(shipment.plannedInstallationAt)} · 联系人：{shipment.siteContact || "—"}</small><small className="erp-subline">{shipment.siteConditions || "未记录现场条件"}</small></div> : <Tag>历史车次未关联安装安排</Tag> },
                { title: "安装状态", width: 135, render: (_, shipment) => shipment.installedAt ? <Tag color="success">{formatDateOnly(shipment.installedAt)}完成</Tag> : <Tag color="warning">待安装部完成</Tag> },
                { title: "操作", width: 135, fixed: "right", render: (_, shipment) => !shipment.installedAt && ["INSTALLER", "CHAIRMAN"].includes(employee.role) ? <Button size="small" type="primary" onClick={() => setWorkflowAction({ command: "COMPLETE_INSTALLATION_BATCH", label: "完成本批安装", shipmentId: shipment.id })}>完成本批安装</Button> : "—" },
              ]} />
            </section>
            <section className="erp-fulfillment-track">
              <div className="erp-track-head"><div><strong>外购产品独立发货</strong><small>每个产品齐套后可先发，只受尾款门禁</small></div><Tag color={selected.fulfillmentTracks.outsourced.allShipped ? "success" : "blue"}>{selected.fulfillmentTracks.outsourced.applicable ? `${selected.fulfillmentTracks.outsourced.shippedCount}/${selected.fulfillmentTracks.outsourced.lines.length} 已发` : selected.fulfillmentTracks.outsourced.mode === "LEGACY_EXEMPT" ? "历史豁免" : "无外购"}</Tag></div>
              {selected.fulfillmentTracks.outsourced.applicable ? <Table size="small" pagination={false} rowKey="id" dataSource={selected.fulfillmentTracks.outsourced.lines} expandable={{ expandedRowRender: (line) => <Table size="small" pagination={false} rowKey="id" dataSource={(line.arrivals ?? []).filter((arrival) => !arrival.voidedAt)} locale={{ emptyText: "尚无到货记录" }} columns={[
                { title: "实际到货日期", dataIndex: "arrivedOn", render: (value) => new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)) },
                { title: "本次到货", render: (_, arrival) => `${arrival.quantity} ${line.unit}` },
                { title: "操作", width: 90, render: (_, arrival) => ["ORDER_ADMIN", "CHAIRMAN"].includes(employee.role) && line.status !== "SHIPPED" ? <Button size="small" danger onClick={() => voidOutsourceArrival(selected, line, arrival)}>作废</Button> : "—" },
              ]} /> }} columns={[
                { title: "产品", render: (_, line) => <div><strong>{line.name}</strong><small className="erp-subline">{line.usageArea || line.note || "整单"}</small></div> },
                { title: "到货 / 计划", width: 150, render: (_, line) => `${line.arrivedQty} / ${line.plannedQty} ${line.unit}` },
                { title: "状态", width: 105, render: (_, line) => <Tag color={OUTSOURCE_STATUS[line.status]?.color}>{OUTSOURCE_STATUS[line.status]?.label ?? line.status}</Tag> },
                { title: "到货操作", width: 110, render: (_, line) => ["ORDER_ADMIN", "CHAIRMAN"].includes(employee.role) && line.remainingQty > 0 && line.status !== "SHIPPED" ? <Button size="small" type="primary" onClick={() => recordOutsourceArrival(selected, line)}>登记到货</Button> : "—" },
              ]} /> : <Alert type="info" showIcon title={selected.fulfillmentTracks.outsourced.mode === "LEGACY_EXEMPT" ? "历史订单不增加外购阻断" : "技术已明确本订单无外购成品"} />}
            </section>
          </div>
          {selected.stage === "INSTALLATION" && !selected.fulfillmentTracks.outsourced.allShipped && <Alert style={{ marginTop: 16 }} type="warning" showIcon title="现场可继续施工，外购产品全部发货前不能提交安装完成" />}
        </Card>}
        <Card title="订单基本信息" className="erp-panel">
          <Descriptions column={2} size="small" items={[
            { key: "creationMode", label: "创建模式", children: <Space><Tag color={selected.creationMode === "INTERNAL_EXCEPTION" ? "gold" : "default"}>{selected.creationModeLabel ?? "常规销售订单"}</Tag>{selected.creationMode === "INTERNAL_EXCEPTION" && <Tag color={selected.chargeMode === "FREE" && selected.commercialStatus === "CONFIRMED" ? "success" : "processing"}>{selected.chargeModeLabel ?? "待商务确认"}</Tag>}</Space> },
            { key: "creator", label: "创建人", children: selected.creator?.name ?? selected.sales?.name ?? "历史数据未回填" },
            { key: "type", label: "业务分类", children: selected.businessTypeLabel },
            { key: "site", label: "现场类型", children: siteCategoryLabel(selected.siteType, selected.villaFloors) },
            { key: "customerDue", label: "客户约定交期", children: formatDate(selected.promisedAt) },
            { key: "productionDue", label: "生产最大工期", children: selected.productionDueAt ? formatDate(selected.productionDueAt) : "设计正式提交后计算" },
            { key: "designSla", label: "设计承诺时限", children: selected.designLeadDays ? `${selected.designLeadDays}个工作日 · ${formatDate(selected.designDueAt)}` : "下单时填写" },
            { key: "designAssigned", label: "设计师分配时间", children: formatDate(selected.designerAssignedAt) },
            { key: "designIntakeDue", label: "最晚设计下单", children: selected.designer ? formatDate(selected.designIntakeDueAt) : "待销售重新分配" },
            { key: "finish", label: "工艺工期", children: `${selected.finishType === "PAINT" ? "油漆" : "免漆"}${selected.leatherDoor ? " · 皮革门+5天" : ""}${selected.villaFloors ? ` · 别墅${selected.villaFloors}层` : ""}` },
            { key: "address", label: "项目地址", children: selected.address, span: 2 },
            { key: "signed", label: selected.creationMode === "INTERNAL_EXCEPTION" ? "业务约定日期" : "签约时间", children: formatDate(selected.signedAt) },
            { key: "sales", label: "销售", children: selected.creationMode === "INTERNAL_EXCEPTION" ? "不适用" : selected.sales?.name ?? "—" },
            { key: "designer", label: "设计师", children: selected.designer?.name ?? "待分配" },
            ...(selected.parent ? [{ key: "parent", label: "关联正单", children: <Button type="link" className="erp-inline-link" onClick={() => openOrder(selected.parent!.id)}>{selected.parent.salesNumber ?? selected.parent.trackingSerial}</Button> }] : []),
            ...(selected.supplementType ? [{ key: "supplementType", label: "补单来源", children: supplementTypeLabel(selected.supplementType) }, { key: "responsibilityType", label: "责任 / 收费", children: responsibilityTypeLabel(selected.responsibilityType) }, { key: "supplementReason", label: "补单原因", children: selected.supplementReason ?? "—", span: 2 }] : []),
            ...(selected.amount != null ? [{ key: "amount", label: "合同金额", children: `¥${Number(selected.amount).toLocaleString("zh-CN")}` }] : []),
            ...(selected.creationMode === "INTERNAL_EXCEPTION" ? [{ key: "exceptionReason", label: "非常规原因", children: selected.exceptionReason ?? "—", span: 2 }, ...(selected.chargeMode === "FREE" && selected.commercialStatus === "CONFIRMED" ? [{ key: "free", label: "商务结论", children: <Tag color="success">免费单 · 无合同金额，付款与尾款不适用</Tag>, span: 2 }] : [])] : []),
            ...(selected.paymentSummary?.applicable === false ? [{ key: "paymentNotApplicable", label: "付款状态", children: selected.paymentSummary.reason === "FREE_ORDER" ? "不适用（免费单）" : "待订单管理员确认商务方式" }] : selected.paymentSummary ? [
              { key: "depositReceived", label: "已收定金", children: selected.paymentSummary.depositReceived != null ? <Space size={6}><strong>{formatMoney(selected.paymentSummary.depositReceived)}</strong><Tag color="success">财务已核验</Tag></Space> : selected.paymentSummary.depositStatus === "CONFIRMED" ? <Tag color="error">已核验，金额记录待核对</Tag> : selected.paymentSummary.depositStatus === "REPORTED" ? <Tag color="warning">待财务核验</Tag> : "尚未报备" },
              ...(selected.paymentSummary.prepaymentRequired ? [{ key: "prepaymentReceived", label: "已收预付款", children: selected.paymentSummary.prepaymentReceived != null ? <Space size={6}><strong>{formatMoney(selected.paymentSummary.prepaymentReceived)}</strong><Tag color="success">财务已核验</Tag></Space> : selected.paymentSummary.prepaymentStatus === "CONFIRMED" ? <Tag color="error">已核验，金额记录待核对</Tag> : selected.paymentSummary.prepaymentStatus === "REPORTED" ? <Tag color="warning">待财务核验</Tag> : "尚未报备" }] : []),
              { key: "tailReceivable", label: "应收尾款", children: selected.paymentSummary.exception ? <Tag color="error">签约首付款超过合同金额，需核对</Tag> : selected.paymentSummary.tailReceivable != null ? <strong>{formatMoney(selected.paymentSummary.tailReceivable)}</strong> : selected.paymentSummary.depositStatus === "CONFIRMED" && (!selected.paymentSummary.prepaymentRequired || selected.paymentSummary.prepaymentStatus === "CONFIRMED") ? <Tag color="error">首付款记录待核对</Tag> : selected.paymentSummary.prepaymentRequired ? "定金与预付款均核验后计算" : "定金核验后计算" },
            ] : []),
          ]} />
        </Card>
        {employee.role !== "PROCUREMENT" && procurementConfirmationCard}
        {selected.materialVersion && !selected.production?.complete && employee.role !== "INSTALLER" && <Card title={`区域物料发布汇总 · ${selected.productionAreas?.filter((area) => area.technicalPackage?.materialVersion).length ?? 0} 个区域`} className="erp-panel" extra={<Space><Tag color={selected.procurementCompletedAt ? "success" : "processing"}>{selected.procurementCompletedAt ? "全部采购已完成" : "线下采购中"}</Tag>{["ORDER_ADMIN", "CHAIRMAN"].includes(employee.role) && selected.materialVersion.status === "PUBLISHED" && <Button danger size="small" onClick={() => confirmMaterialVersionCancellation(selected)}>整版撤销重做</Button>}<Button size="small" onClick={() => { setSelected(null); setSelectedCost(null); setPage("procurement"); }}>进入采购与成本</Button></Space>}>
          {!selectedCost && <Table size="small" rowKey={(line) => `${line.productionArea?.id ?? "legacy"}-${line.id ?? `${line.normalizedName}-${line.specification ?? ""}`}`} pagination={{ pageSize: 8 }} dataSource={(selected.productionAreas ?? []).flatMap((area) => (area.technicalPackage?.materialVersion?.lines ?? []).map((line) => ({ ...line, productionArea: { id: area.id, name: area.name, productionNumber: area.productionNumber } })))} columns={[
            { title: "生产区域", width: 180, render: (_, line) => <div><strong>{line.productionArea?.name ?? "历史未分区区域"}</strong><small className="erp-subline">{line.productionArea?.productionNumber ?? selected.productionNumber ?? "—"}</small></div> },
            { title: "物料", render: (_, line) => <div><strong>{line.normalizedName}</strong><small className="erp-subline">{line.specification ?? "—"}</small></div> },
            { title: "采购计价数量", render: (_, line) => `${Number(line.purchaseQty).toFixed(4)} ${line.unit}` },
            { title: "来源模板", dataIndex: "templateType", render: (value) => <Tag>{value ?? "历史物料版"}</Tag> },
          ]} />}
        </Card>}
        {selected.materialVersion && selectedCost && ["FINANCE", "CHAIRMAN"].includes(employee.role) && <Card id="order-material-cost" style={{ scrollMarginTop: 80 }} title="订单成本核算" className="erp-panel erp-order-cost-panel" extra={<Space><Tag color={selectedCost.grandTotal != null ? "success" : "warning"}>{selectedCost.grandTotal != null ? "总成本已归集" : selectedCost.overallStatus === "WAITING_MATERIAL_PRICE" ? `物料待补价 ${selectedCost.missingPriceCount} 项` : selectedCost.overallStatus === "WAITING_WORKSHOP_COST" ? "待车间成本快照" : selectedCost.overallStatus === "WAITING_OUTSOURCE_PRICE" ? `外购待定价 ${selectedCost.outsource.missingPriceCount} 项` : "待安装成本收口"}</Tag><Button size="small" onClick={async () => { try { await api.call(`/api/v1/orders/${selected.id}/material-cost/recalculate`, { method: "POST" }); await openOrder(selected.id); message.success("已按成本库最新价格生成新的物料核算结果并留痕"); } catch (error) { message.error(error instanceof Error ? error.message : "重新核算失败"); } }}>物料按最新单价重算</Button></Space>}>
          <div className="erp-cost-total" role="status">
            <strong>当前订单总成本{selectedCost.grandTotal == null ? "（暂计）" : ""}：{formatMoney(selectedCost.grandTotal ?? selectedCost.knownSubtotal)}</strong>
          </div>
          <div className="erp-cost-summary-scroll" role="region" aria-label="订单五项成本摘要" tabIndex={0}>
            <div className="erp-cost-summary-track">
              <section className="erp-cost-summary-item">
                <span>物料单成本</span>
                <div><strong>{formatMoney(selectedCost.totalCost ?? selectedCost.pricedSubtotal)}</strong><Tag color={selectedCost.totalCost == null ? "warning" : "success"}>{selectedCost.totalCost == null ? `缺价 ${selectedCost.missingPriceCount} 项` : "已定价"}</Tag></div>
              </section>
              <section className="erp-cost-summary-item">
                <span>车间成本</span>
                <div><strong>{formatMoney(selectedCost.workshop.totalCost)}</strong><Tag color={selectedCost.workshop.status === "COMPLETE" ? "success" : "warning"}>{selectedCost.workshop.status === "COMPLETE" ? "已快照" : "待快照"}</Tag></div>
              </section>
              <section className="erp-cost-summary-item">
                <span>安装成本</span>
                <div><strong>{formatMoney(selectedCost.installation.subtotal)}</strong><Tag color={selectedCost.installation.status === "COMPLETE" ? "success" : "processing"}>{selectedCost.installation.status === "COMPLETE" ? "已收口" : "累计中"}</Tag></div>
              </section>
              <section className="erp-cost-summary-item">
                <span>外购成品成本</span>
                <div><strong>{formatMoney(selectedCost.outsource.subtotal)}</strong><Tag color={selectedCost.outsource.complete ? "success" : "warning"}>{selectedCost.outsource.complete ? "已定价" : `待定价 ${selectedCost.outsource.missingPriceCount} 项`}</Tag></div>
              </section>
              <section className="erp-cost-summary-item">
                <span>售后成本</span>
                <div><strong>{formatMoney(selectedCost.aftersales.subtotal)}</strong><Tag color="processing">累计中</Tag></div>
              </section>
            </div>
          </div>
          <section className="erp-cost-detail-section"><Typography.Title level={5}>车间成本明细</Typography.Title>
          <Table size="small" rowKey="id" pagination={false} dataSource={selectedCost.workshop.areas.flatMap((area) => area.lines.map((line) => ({ ...line, productionArea: area })))} columns={[
            { title: "生产区域", render: (_, line) => `${line.productionArea.name} · ${line.productionArea.productionNumber}` },
            { title: "车间", dataIndex: "workshopLabel" },
            { title: "面积", render: (_, line) => `${line.quantity} ${line.unit}` },
            { title: "综合单价快照", render: (_, line) => `${formatUnitCost(line.unitPriceSnapshot)} / ㎡` },
            { title: "小计", dataIndex: "lineTotal", render: formatMoney },
          ]} /></section>
          <section className="erp-cost-detail-section"><Typography.Title level={5}>安装成本明细</Typography.Title>
          <Table size="small" rowKey="id" pagination={false} dataSource={selectedCost.installation.batches} locale={{ emptyText: "尚无发货安装批次" }} columns={[
            { title: "发货批次", render: (_, batch) => `第${batch.batchNo}车 · ${formatDate(batch.deliveredAt)}` },
            { title: "区域安装费", render: (_, batch) => batch.areas.map((line) => <div key={line.id}>{line.areaName}第{line.sequence}批：{line.installationFee == null ? "历史记录待核对" : formatMoney(line.installationFee)}</div>) },
            { title: "运输费", dataIndex: "transportCost", render: (value) => value == null ? "待安装部填写" : formatMoney(value) },
            { title: "状态", render: (_, batch) => <Tag color={batch.installedAt ? "success" : "warning"}>{batch.installedAt ? "已完成安装" : "待安装"}</Tag> },
          ]} /></section>
          <section className="erp-cost-detail-section"><Typography.Title level={5}>外购成品成本明细</Typography.Title>
          <Table size="small" rowKey="id" pagination={false} dataSource={selectedCost.outsource.lines} locale={{ emptyText: "本订单无外购成品" }} expandable={{ expandedRowRender: (line) => <Table size="small" rowKey="id" pagination={false} dataSource={line.priceVersions} locale={{ emptyText: "尚无成本版本" }} columns={[{ title: "版本", dataIndex: "version", render: (value) => `P${value}` }, { title: "单位成本", dataIndex: "unitPrice", render: formatUnitCost }, { title: "记录时间", dataIndex: "createdAt", render: formatDate }, { title: "说明", dataIndex: "note", render: (value) => value || "—" }]} /> }} columns={[
            { title: "外购产品", render: (_, line) => <div><strong>{line.name}</strong><small className="erp-subline">{line.usageArea || "整单"}</small></div> },
            { title: "计划数量", render: (_, line) => `${line.plannedQty} ${line.unit}` },
            { title: "单位成本", render: (_, line) => line.unitPrice == null ? <Tag color="warning">待定价</Tag> : formatUnitCost(line.unitPrice) },
            { title: "小计", dataIndex: "lineTotal", render: formatMoney },
            { title: "操作", width: 125, render: (_, line) => <Button size="small" onClick={() => { setOutsourceCostLine(line); outsourceCostForm.setFieldsValue({ unitPrice: line.unitPrice ?? undefined, note: "" }); }}>{line.unitPrice == null ? "录入成本" : "调整成本"}</Button> },
          ]} /></section>
          <section className="erp-cost-detail-section"><Typography.Title level={5}>物料单成本明细</Typography.Title>
          <Table className="erp-order-material-cost-table" size="small" scroll={{ x: 980 }} rowKey="id" pagination={{ pageSize: 10 }} dataSource={selectedCost.lines} expandable={{ expandedRowRender: (line) => <Table size="small" rowKey={(source) => `${source.fileName}-${source.row}-${source.subRow}`} pagination={false} dataSource={line.sourceRefs ?? []} columns={[
            { title: "来源模板", dataIndex: "templateType" },
            { title: "原文件 / 工作表", render: (_, source) => `${source.fileName ?? "—"} / ${source.sheet ?? "—"}` },
            { title: "原始行", render: (_, source) => `${source.row ?? "—"}-${source.subRow ?? "A"}` },
            { title: "原始名称", dataIndex: "rawName" },
            { title: "计算依据", dataIndex: "calculationSource" },
          ]} /> }} columns={[
            { title: "生产区域", width: 150, render: (_, line) => line.productionArea ? <div><strong>{line.productionArea.name}</strong><small className="erp-subline">{line.productionArea.productionNumber}</small></div> : "历史未分区区域" },
            { title: "标准物料", width: 230, render: (_, line) => <div><strong>{line.costItem.normalizedName}</strong><small className="erp-subline">{line.costItem.specification || "无规格"}</small></div> },
            { title: "采购计价数量", width: 140, render: (_, line) => `${Number(line.quantity).toFixed(4)} ${line.unit}` },
            { title: "单位成本", width: 135, dataIndex: "unitPriceSnapshot", render: (value, line) => value == null ? <Typography.Text className="erp-cost-price-pending" type="warning">⚠ 待补单价</Typography.Text> : `${formatUnitCost(value)} / ${line.unit}` },
            { title: "行总价", width: 110, dataIndex: "lineTotal", render: (value) => value == null ? "—" : <strong>{formatMoney(value)}</strong> },
            { title: "价格状态", width: 125, dataIndex: "unitPriceSnapshot", render: (value) => <Tag color={value == null ? "warning" : "success"}>{value == null ? "待补单价" : "已取价格快照"}</Tag> },
            { title: "来源", width: 90, render: (_, line) => `${line.sourceRefs?.length ?? 0} 处` },
          ]} /></section>
          <section className="erp-cost-detail-section"><Typography.Title level={5}>售后成本明细 · 累计中</Typography.Title>
          <Table size="small" rowKey="id" pagination={false} dataSource={selectedCost.aftersales.batches} locale={{ emptyText: "尚无售后费用" }} columns={[
            { title: "售后单", dataIndex: "caseNumber" }, { title: "发生日期", dataIndex: "incurredOn", render: (value) => formatDay(value) }, { title: "金额", dataIndex: "amount", render: formatMoney }, { title: "说明", dataIndex: "description" }, { title: "状态", render: (_, batch) => batch.voidedAt ? <Tag>已作废</Tag> : <Tag color="success">有效</Tag> },
          ]} /></section>
        </Card>}
        <Card title="阶段资料与审核记录" className="erp-panel" extra={<Tag color="cyan">{selected.stageSubmissions?.length ?? 0} 次提交</Tag>}>
          {selected.stageSubmissions?.length ? <div className="erp-submission-list">{selected.stageSubmissions.map((submission) => {
            const attachmentCount = Object.entries(submission.payload ?? {}).filter(([key]) => key.endsWith("AttachmentIds")).reduce((sum, [, value]) => sum + (Array.isArray(value) ? value.length : 0), 0);
            return <article role="button" tabIndex={0} onClick={() => setSubmissionDetail(submission)} onKeyDown={(event) => { if (event.key === "Enter") setSubmissionDetail(submission); }} key={submission.id}><div className="erp-submission-icon"><RiAttachment2 size={17} /></div><div><strong>{commandLabel(submission.command)}</strong><span>{submission.version ? `版本 ${submission.version} · ` : ""}{attachmentCount} 个附件{Array.isArray(submission.payload?.checklist) ? ` · ${(submission.payload.checklist as unknown[]).length} 项核对` : ""} · 点击查看全部资料</span>{submission.comment && <p>{submission.comment}</p>}</div><div><Tag color={submission.status === "DRAFT" ? "default" : submission.status === "REJECTED" ? "error" : submission.status === "APPROVED" ? "success" : "processing"}>{submission.status === "DRAFT" ? "草稿" : submission.status === "REJECTED" ? "已退回" : submission.status === "APPROVED" ? "已审核" : "已提交"}</Tag><small>{formatDate(submission.submittedAt)}</small></div></article>;
          })}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本订单尚无节点资料；办理动作后，表单、附件和审核项会在这里留痕。" />}
        </Card>
        {!selected.parent && <Card title="关联补单" className="erp-panel" extra={<Button type="primary" size="small" onClick={() => { setCreateParentId(selected.id); setCreateOpen(true); }}>从此正单创建补单</Button>}>
          {selected.supplements?.length ? <div className="erp-linked-orders">{selected.supplements.map((supplement) => <Button key={supplement.id} onClick={() => openOrder(supplement.id)}>{supplement.salesNumber ?? supplement.trackingSerial}<Tag>{STAGES.find(([key]) => key === supplement.stage)?.[1] ?? supplement.stage}</Tag></Button>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无关联补单" />}
        </Card>}
      </div>
      <div>
        <Card title="状态变化记录" className="erp-panel erp-timeline-card">
          <Timeline items={timeline.map((event) => {
            const display = orderTimelineDisplay(event, selected.packageSummary?.sources ?? []);
            return { color: orderTimelineColor({ ...event, title: display.title }), content: <div><strong>{display.title}</strong>{display.description && <p>{display.description}</p>}<small>{formatDate(event.createdAt)} · {event.actor?.name ?? "系统"}</small></div> };
          })} />
        </Card>
        <Card title="售后质保" className="erp-panel">
          <Statistic title={selected.warranty?.automatic ? "自动质保政策" : "质保政策"} value={selected.warranty?.label ?? "待验收"} prefix={<RiShieldCheckLine size={20} />} />
          {selected.afterSalesActive && <Tag color="purple">第13步售后处理中 · {selected.afterSalesCount ?? 0} 单</Tag>}
          <Typography.Paragraph type="secondary" className="erp-card-note">从客户最终验收签字日起算；补单按自己的最终验收日独立起算。</Typography.Paragraph>
        </Card>
      </div>
    </div>
  </div> : moduleContent ?? <>
    <div className="erp-page-title"><div><Typography.Title level={2}>订单中心</Typography.Title><p>用统一工作流状态驱动负责人、下一任务、风险和门禁</p></div>{canCreate && <Button type="primary" onClick={() => { setCreateParentId(null); setCreateOpen(true); }}>新建订单</Button>}</div>
    <div className="erp-metrics">
      <Card><Statistic title="权限范围内订单" value={total} prefix={<RiFileCopy2Line size={20} />} /></Card>
      <Card><Tooltip title="统计订单中尚未解除的生产报工异常、尾款门禁或外购履约异常；包件暂计不算风险。"><Statistic title={<span className="erp-metric-title-help">异常标记订单 <small>统计口径</small></span>} value={orders.filter((o) => o.riskCount > 0).length} styles={{ content: { color: "#cf4a43" } }} prefix={<RiAlarmWarningLine size={20} />} /></Tooltip></Card>
      <Card><Statistic title="待发货" value={orders.filter((o) => ["INSTALLATION_APPLICATION", "DELIVERY"].includes(o.stage)).length} prefix={<RiShieldCheckLine size={20} />} /></Card>
      <Card><Statistic title="当前角色" value={(employee.role === "SALES" ? salesRoleLabel(employee) : ROLE_LABELS[employee.role])} prefix={<RiTaskLine size={20} />} /></Card>
    </div>
    <Card className="erp-table-card" title="订单跟进台账" extra={<Input allowClear prefix={<RiSearchLine size={16} />} placeholder="搜索销售编号、跟单号、区域生产编号、客户或地址" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 420 }} />}>
      <Table<Order> rowKey="id" columns={columns} dataSource={orders} pagination={false} virtual scroll={{ x: 1400, y: 460 }} onRow={(record) => ({ onClick: () => openOrder(record.id) })} locale={{ emptyText: <Empty description="当前权限范围内暂无订单" /> }} />
    </Card>
  </>;

  return <Layout className="erp-shell">
    <Layout.Sider width={236} className="erp-sider" theme="dark">
      <div className="erp-brand"><div className="erp-logo">苔</div><div><strong>苔的跟单旅程</strong><span>DESKTOP V1.2</span></div></div>
      <Menu theme="dark" selectedKeys={[page]} onClick={({ key }) => { setPage(key); setSelected(null); setSelectedCost(null); setProductionTaskFocus(null); setProcurementAreaId(null); }} items={[
        { key: "orders", icon: <RiFileCopy2Line size={18} />, label: "订单中心" },
        { key: "tasks", icon: <RiTaskLine size={18} />, label: "个人与部门待办" },
        ...(["PROCUREMENT", "FINANCE", "CHAIRMAN"].includes(employee.role) ? [{ key: "procurement", icon: <RiShoppingCart2Line size={18} />, label: employee.costModuleEnabled ? "采购与成本" : "采购登记" }] : []),
        ...(employee.role === "CHAIRMAN" ? [{ key: "accounts", icon: <RiShieldCheckLine size={18} />, label: "员工账号" }] : []),
        ...(["CHAIRMAN", "ORDER_ADMIN"].includes(employee.role) ? [{ key: "mini-accounts", icon: <RiShieldCheckLine size={18} />, label: "小程序绑定" }] : []),
        ...(["CHAIRMAN", "ORDER_ADMIN"].includes(employee.role) ? [{ key: "numbering", icon: <RiFileCopy2Line size={18} />, label: "旧流程编号预留" }] : []),
        { key: "aftersales", icon: <RiToolsLine size={18} />, label: "安装与售后" },
      ]} />
      <div className="erp-user"><Avatar>{employee.name.slice(0, 1)}</Avatar><div><strong>{employee.name}</strong><span>{employee.department} · {(employee.role === "SALES" ? salesRoleLabel(employee) : ROLE_LABELS[employee.role])}</span></div><Button type="text" aria-label="退出登录" icon={<RiLogoutBoxRLine size={18} />} onClick={() => logout()} /></div>
    </Layout.Sider>
    <Layout>
      <header className="erp-header"><div><strong>{employee.environment === "company-test" ? "公司云测试环境 · 仅使用编造数据" : employee.environment === "production" ? "正式业务环境" : "本地 / 测试验收环境"}</strong><span>Asia/Shanghai · 小程序{publicConfig.miniProgramEnabled ? "接口已开启" : "生产接口关闭"}</span></div><Space>{publicConfig.customerDemoEnabled && ["SALES", "ORDER_ADMIN", "CHAIRMAN"].includes(employee.role) && <Button onClick={() => setCustomerDemoOpen(true)}>客户客服 Demo</Button>}{["FINANCE", "CHAIRMAN"].includes(employee.role) && <Button onClick={() => setPaymentAccountOpen(true)}>{employee.role === "FINANCE" ? "申请收款账户" : `审批收款账户${paymentAccounts.some((account) => account.status === "PENDING") ? "（待办）" : ""}`}</Button>}{showLocalTestAccounts({ devBuild: import.meta.env.DEV, backendEnabled: publicConfig.localTestAccountsEnabled, hostname: window.location.hostname, mobileReadonly: mobileRoute }) && <Button onClick={() => Modal.confirm({ title: "切换测试账号", content: "将退出当前账号并返回测试账号选择页。已保存的数据保留，未提交的表单请先保存当前进度。", okText: "返回账号选择", cancelText: "继续当前操作", onOk: () => { try { window.sessionStorage.setItem(LOCAL_TEST_LOGIN_PAGE_KEY, "1"); } catch { /* optional */ } return logout(); } })}>切换测试账号</Button>}<Button type="text" onClick={() => setPasswordOpen(true)}>修改密码</Button><Badge count={notifications.filter((item) => !item.readAt).length} size="small"><Button type="text" aria-label="打开实时消息" icon={<RiNotification3Line size={18} />} onClick={() => setNotificationOpen(true)} /></Badge><Tag color="green">服务端权限已启用</Tag></Space></header>
      <Layout.Content className="erp-content">{content}</Layout.Content>
      <Modal title="客户客服 Demo" open={customerDemoOpen} onCancel={() => setCustomerDemoOpen(false)} footer={null} width={820} destroyOnHidden><CustomerDemoAdmin api={api.call} orders={orders} role={employee.role} /></Modal>
      {(publicConfig.icpFilingNumber || publicConfig.publicSecurityFilingNumber) && <footer className="erp-filing-footer"><FilingLinks filing={publicConfig} /></footer>}
    </Layout>
    <CreateOrderModal key={employee.id} open={createOpen} employee={employee} employees={employees} orders={orders} paymentAccounts={paymentAccounts.filter((account) => account.status === "APPROVED").map((account) => account.name)} initialParentId={createParentId} onCancel={() => { setCreateOpen(false); setCreateParentId(null); }} api={api.call} onCreated={(order) => { setCreateOpen(false); setCreateParentId(null); setSelected(order); loadOrders(); }} />
    <ExceptionCommercialReviewModal order={exceptionCommercialOrder} paymentAccounts={paymentAccounts.filter((account) => account.status === "APPROVED").map((account) => account.name)} api={api.call} onCancel={() => setExceptionCommercialOrder(null)} onSaved={async (order) => { setExceptionCommercialOrder(null); setSelected(order); await loadOrders(); }} />
    <WorkflowActionModal<Order> order={selected} action={workflowAction} api={api.call} paymentAccounts={paymentAccounts.filter((account) => account.status === "APPROVED").map((account) => account.name)} designers={employees.filter((candidate) => candidate.role === "DESIGNER").map((candidate) => ({ id: candidate.id, name: candidate.name }))} installers={employees.filter((candidate) => candidate.role === "INSTALLER").map((candidate) => ({ id: candidate.id, name: candidate.name, department: candidate.department }))} onCancel={() => setWorkflowAction(null)} onCompleted={async (order) => {
      setWorkflowAction(null); if ((order as Order & { accessRevoked?: boolean }).accessRevoked) { setSelected(null); setTimeline([]); setPage("orders"); } else await openOrder(order.id); await loadOrders();
    }} onDraftSaved={(order) => setSelected(order)} />
    <PaymentAccountManager open={paymentAccountOpen} role={employee.role} accounts={paymentAccounts} api={api.call} onClose={() => setPaymentAccountOpen(false)} onChanged={async () => { await loadPaymentAccounts(); setTaskRefreshNonce((value) => value + 1); }} />
    <Modal title={`采购确认 · ${selectedProcurementArea?.area.name ?? ""} · ${selectedProcurementArea?.area.productionNumber ?? ""}`} open={Boolean(selected && selectedProcurementArea)} onCancel={() => setProcurementAreaId(null)} footer={<Button onClick={() => setProcurementAreaId(null)}>关闭</Button>} width={680} destroyOnHidden>
      <div className="erp-procurement-area-route-list">{selected && selectedProcurementArea?.entries.map(({ area, route, gate }) => {
        const label = route.kind === "PANEL" ? "板式路线" : "实木油漆路线";
        return <section key={route.id} className="erp-procurement-area-route"><div><div><strong>{label}</strong><small>截止 {formatDate(gate!.dueAt)}{route.releasedAt ? ` · 完成 ${formatDate(route.releasedAt)}` : ""}</small></div><Tag color={route.released ? "success" : "warning"}>{route.released ? "采购已完成" : "等待确认"}</Tag></div>{!route.released && ["PROCUREMENT", "CHAIRMAN"].includes(employee.role) && <Button type="primary" onClick={() => confirmProcurementRoute(selected, gate!, area)}>确认{label}采购完成</Button>}</section>;
      })}</div>
    </Modal>
    <Modal title="修改合同金额" open={contractAmountOpen} onCancel={() => setContractAmountOpen(false)} onOk={updateContractAmount} okText="确认修改并留痕" confirmLoading={contractAmountSaving}>
      <Alert type="warning" showIcon title="修改窗口仅持续到尾款报备或首批发货前" description="历史金额变更不会被覆盖；新金额不能低于财务已确认的定金与预付款合计。" />
      <Form layout="vertical" style={{ marginTop: 16 }}><Form.Item label={selected?.businessType.endsWith("SUPPLEMENT") ? "补单金额" : "合同总金额"} required><InputNumber min={selected?.businessType.endsWith("SUPPLEMENT") ? 0 : 0.01} precision={2} prefix="¥" value={contractAmountValue} onChange={(value) => setContractAmountValue(Number(value ?? 0))} style={{ width: "100%" }} /></Form.Item></Form>
    </Modal>
    <Modal title={`外购成品成本 · ${outsourceCostLine?.name ?? ""}`} open={Boolean(outsourceCostLine)} onCancel={() => { setOutsourceCostLine(null); outsourceCostForm.resetFields(); }} onOk={saveOutsourceCost} okText="保存成本版本" confirmLoading={outsourceCostSaving} destroyOnHidden>
      <Form form={outsourceCostForm} layout="vertical">
        <Typography.Paragraph type="secondary">按技术确认的计划数量 {outsourceCostLine?.plannedQty ?? 0} {outsourceCostLine?.unit ?? "件"}计入订单；不影响到货和发货。</Typography.Paragraph>
        <Form.Item name="unitPrice" label={`单位成本（元/${outsourceCostLine?.unit ?? "件"}）`} rules={[{ required: true, message: "请输入单位成本" }]}><InputNumber min={0} precision={4} style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="note" label={outsourceCostLine?.unitPrice == null ? "说明（选填）" : "调价原因（必填）"} rules={outsourceCostLine?.unitPrice == null ? [] : [{ required: true, whitespace: true, message: "请填写调价原因" }]}><Input.TextArea rows={3} /></Form.Item>
      </Form>
    </Modal>
    <Modal title="登记售后问题" open={afterSalesCreateOpen} onCancel={() => { setAfterSalesCreateOpen(false); setAfterSalesCreateFiles([]); }} footer={null} destroyOnHidden>
      <Form form={afterSalesCreateForm} layout="vertical" initialValues={{ incurredOn: dayjs() }} onFinish={createAfterSales}><Alert type="info" showIcon title="问题与本次费用同时登记" description="提交后生成售后单和首笔费用批次，费用立即进入订单成本累计；后续仍可追加新的费用批次。" /><Form.Item name="issueType" label="问题类型" rules={[{ required: true }]} style={{ marginTop: 16 }}><Input placeholder="例如：安装调整、五金更换" /></Form.Item><Form.Item name="description" label="事实描述" rules={[{ required: true }]}><Input.TextArea rows={4} /></Form.Item><Form.Item name="incurredOn" label="本次费用发生日期" rules={[{ required: true }]}><DatePicker needConfirm={false} showNow={false} format="YYYY-MM-DD" style={{ width: "100%" }} /></Form.Item><Form.Item name="amount" label="本次售后费用" rules={[{ required: true, message: "请填写本次售后费用" }]}><InputNumber min={0.01} precision={2} prefix="¥" style={{ width: "100%" }} /></Form.Item><Form.Item label="费用附件（选填）"><Upload multiple accept=".pdf,.png,.jpg,.jpeg,.heic" beforeUpload={() => false} fileList={afterSalesCreateFiles} onChange={({ fileList }) => setAfterSalesCreateFiles(fileList)}><Button icon={<RiUpload2Line size={16} />}>选择凭证</Button></Upload></Form.Item><Space style={{ justifyContent: "flex-end", width: "100%" }}><Button onClick={() => { setAfterSalesCreateOpen(false); setAfterSalesCreateFiles([]); }}>取消</Button><Button type="primary" htmlType="submit" loading={afterSalesSaving}>登记问题并计入成本</Button></Space></Form>
    </Modal>
    <Modal title={`新增售后费用 · ${afterSalesCostCase?.caseNumber ?? ""}`} open={Boolean(afterSalesCostCase)} onCancel={() => setAfterSalesCostCase(null)} footer={null} destroyOnHidden>
      <Form form={afterSalesCostForm} layout="vertical" onFinish={addAfterSalesCost}><Alert type="info" showIcon title="售后成本持续累计" description="提交后不可覆盖；如需纠错，请作废原批次并新增更正批次。" /><Form.Item name="incurredOn" label="发生日期" rules={[{ required: true }]} style={{ marginTop: 16 }}><DatePicker needConfirm={false} showNow={false} style={{ width: "100%" }} /></Form.Item><Form.Item name="amount" label="金额" rules={[{ required: true }]}><InputNumber min={0.01} precision={2} prefix="¥" style={{ width: "100%" }} /></Form.Item><Form.Item name="description" label="费用说明" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item><Form.Item label="附件（选填）"><Upload beforeUpload={() => false} fileList={afterSalesFiles} onChange={({ fileList }) => setAfterSalesFiles(fileList)}><Button icon={<RiUpload2Line size={16} />}>选择凭证</Button></Upload></Form.Item><Space style={{ justifyContent: "flex-end", width: "100%" }}><Button onClick={() => setAfterSalesCostCase(null)}>取消</Button><Button type="primary" htmlType="submit" loading={afterSalesSaving}>新增费用批次</Button></Space></Form>
    </Modal>
    <Drawer title="实时消息与超时提醒" open={notificationOpen} onClose={() => setNotificationOpen(false)} size={440}>
      <List dataSource={notifications} locale={{ emptyText: "暂无提醒" }} renderItem={(item) => <List.Item className={!item.readAt ? "erp-notification-unread" : ""} actions={!item.readAt ? [<Button key="read" type="link" onClick={async () => { await api.call(`/api/v1/notifications/${item.id}/read`, { method: "POST" }); await loadNotifications(); }}>标记已读</Button>] : undefined}><List.Item.Meta title={<Space><Tag color={item.level === "ERROR" ? "error" : "warning"}>{item.level === "ERROR" ? "超时" : "即将到期"}</Tag>{item.title}</Space>} description={<><div>{item.body}</div><small>{formatDate(item.createdAt)}</small></>} /></List.Item>} />
    </Drawer>
    <Modal className={submissionDetail?.command === "SUBMIT_TECHNICAL" ? "erp-technical-detail-modal" : undefined} title={`${submissionDetail ? commandLabel(submissionDetail.command) : "节点资料"} · 完整提交内容`} open={Boolean(submissionDetail)} onCancel={() => setSubmissionDetail(null)} footer={<Button onClick={() => setSubmissionDetail(null)}>关闭</Button>} width={submissionDetail?.command === "SUBMIT_TECHNICAL" ? 960 : 760}>
      {submissionDetail && <div className="erp-submission-detail">
        {submissionDetail.command === "SUBMIT_TECHNICAL" ? <TechnicalSubmissionDetails payload={submissionDetail.payload ?? {}} /> : <Descriptions bordered size="small" column={1} items={Object.entries(submissionDetail.payload ?? {}).filter(([key]) => !key.endsWith("AttachmentIds") && key !== "checklist").map(([key, value]) => ({ key, label: key, children: typeof value === "object" ? JSON.stringify(value) : String(value) }))} />}
        {Array.isArray(submissionDetail.payload.checklist) && <div><Typography.Title level={5}>逐项审核结果</Typography.Title>{(submissionDetail.payload.checklist as Array<string | { label?: string; checked?: boolean }>).map((item, index) => { const label = typeof item === "string" ? item : item.label; const checked = typeof item === "string" || Boolean(item.checked); return <Tag key={index} color={checked ? "success" : "error"}>{checked ? "✓" : "✕"} {label}</Tag>; })}</div>}
        <div><Typography.Title level={5}>附件</Typography.Title><Space wrap>{Object.entries(submissionDetail.payload).filter(([key]) => key.endsWith("AttachmentIds")).flatMap(([, value]) => Array.isArray(value) ? value : []).map((id) => { const file = selected?.attachments?.find((item) => item.id === id); return <Button key={String(id)} href={`/api/v1/attachments/${id}`} target="_blank" icon={<RiAttachment2 size={15} />}>{file?.originalName ?? `附件 ${String(id).slice(0, 8)}`}</Button>; })}</Space></div>
      </div>}
    </Modal>
  </Layout>;
}

export default function App() {
  return <ConfigProvider locale={zhCN} theme={{ algorithm: theme.defaultAlgorithm, token: { colorPrimary: "#00a98f", colorInfo: "#00a98f", colorText: "#17231f", colorBgLayout: "#f3f6f5", borderRadius: 7, fontSize: 14, fontFamily: '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif' }, components: { Layout: { siderBg: "#06251f", headerBg: "#ffffff" }, Menu: { darkItemBg: "#06251f", darkItemSelectedBg: "#0b493d", darkItemSelectedColor: "#ffffff" }, Table: { headerBg: "#f4f8f6", headerColor: "#5f706a" } } }}><AntApp><RootApp /></AntApp></ConfigProvider>;
}
