import type {
  BusinessType,
  ScheduleResult,
  SiteType,
  WarrantyResult,
  WorkflowStage,
  OrderCommandType,
  FinishType,
} from "./types.js";

const CATEGORY_DIGIT: Record<BusinessType, number> = {
  NOERLI_FORMAL: 1,
  NOERLI_SUPPLEMENT: 0,
  AIKEJU_FORMAL: 9,
  AIKEJU_SUPPLEMENT: 8,
  CHANNEL_FORMAL: 5,
  CHANNEL_SUPPLEMENT: 5,
  ENGINEERING_FORMAL: 7,
  ENGINEERING_SUPPLEMENT: 7,
  WORKWEAR_FORMAL: 7,
  WORKWEAR_SUPPLEMENT: 7,
};

const SALES_PREFIX: Record<BusinessType, string> = {
  NOERLI_FORMAL: "N",
  NOERLI_SUPPLEMENT: "N",
  AIKEJU_FORMAL: "A",
  AIKEJU_SUPPLEMENT: "A",
  CHANNEL_FORMAL: "C",
  CHANNEL_SUPPLEMENT: "C",
  ENGINEERING_FORMAL: "E",
  ENGINEERING_SUPPLEMENT: "E",
  WORKWEAR_FORMAL: "W",
  WORKWEAR_SUPPLEMENT: "W",
};

export const businessTypeLabels: Record<BusinessType, string> = {
  NOERLI_FORMAL: "诺尔丽正单",
  NOERLI_SUPPLEMENT: "诺尔丽补单",
  AIKEJU_FORMAL: "艾可居正单",
  AIKEJU_SUPPLEMENT: "艾可居补单",
  CHANNEL_FORMAL: "渠道正单",
  CHANNEL_SUPPLEMENT: "渠道补单",
  ENGINEERING_FORMAL: "工程正单",
  ENGINEERING_SUPPLEMENT: "工程补单",
  WORKWEAR_FORMAL: "工装正单",
  WORKWEAR_SUPPLEMENT: "工装补单",
};

export function categoryDigit(type: BusinessType): number {
  return CATEGORY_DIGIT[type];
}

export function salesPrefix(type: BusinessType): string {
  return SALES_PREFIX[type];
}

export function salesNumber(type: BusinessType, submittedAt: Date, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 9999) {
    throw new RangeError("销售编号流水必须在 0001–9999 之间");
  }
  const year = String(submittedAt.getFullYear()).slice(-2);
  const month = String(submittedAt.getMonth() + 1).padStart(2, "0");
  return `${salesPrefix(type)}${year}${month}${String(sequence).padStart(4, "0")}`;
}

export function productionNumber(type: BusinessType, submittedAt: Date, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999) {
    throw new RangeError("生产编号流水必须在 001–999 之间");
  }
  const year = String(submittedAt.getFullYear()).slice(-2);
  const month = String(submittedAt.getMonth() + 1).padStart(2, "0");
  const baseNumber = `${year}${month}${categoryDigit(type)}${String(sequence).padStart(3, "0")}`;
  return type.endsWith("SUPPLEMENT") ? `补单-B${baseNumber}` : baseNumber;
}

export function yearMonth(value: Date): string {
  return `${value.getFullYear()}${String(value.getMonth() + 1).padStart(2, "0")}`;
}

function atFivePm(value: Date): Date {
  const result = new Date(value);
  result.setHours(17, 0, 0, 0);
  return result;
}

export function nextInternalWorkday(value: Date): Date {
  const result = new Date(value);
  do result.setDate(result.getDate() + 1); while (result.getDay() === 0);
  return result;
}

export function previousInternalWorkday(value: Date): Date {
  const result = new Date(value);
  do result.setDate(result.getDate() - 1); while (result.getDay() === 0);
  return result;
}

export function calculateSchedule(
  signedAt: Date,
  siteType: SiteType,
  rushPromisedAt?: Date | null,
): ScheduleResult {
  const standardDueAt = new Date(signedAt);
  standardDueAt.setDate(standardDueAt.getDate() + (siteType === "FINISHED" ? 33 : 37));
  const effectiveDueAt = rushPromisedAt ? new Date(rushPromisedAt) : new Date(standardDueAt);
  const sundayRisk = effectiveDueAt.getDay() === 0;
  const internalDueAt = atFivePm(sundayRisk ? nextInternalWorkday(effectiveDueAt) : effectiveDueAt);
  const reminderAt = atFivePm(previousInternalWorkday(internalDueAt));
  return { standardDueAt, effectiveDueAt, internalDueAt, reminderAt, sundayRisk };
}

export function addInternalWorkingDays(start: Date, count: number): Date {
  if (!Number.isInteger(count) || count < 1) throw new RangeError("工作日必须是正整数");
  const result = new Date(start);
  let remaining = count;
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    if (result.getDay() !== 0) remaining -= 1;
  }
  return atFivePm(result);
}

export function addCalendarDays(start: Date, count: number): Date {
  if (!Number.isInteger(count) || count < 1) throw new RangeError("自然日必须是正整数");
  const result = new Date(start);
  result.setDate(result.getDate() + count);
  return result;
}

export function calculateProductionWindow(submittedAt: Date, siteType: SiteType, finishType: FinishType = "MELAMINE", villaFloors = 0) {
  const calendarDays = (siteType === "FINISHED" ? 33 : 37) + (finishType === "PAINT" ? 5 : 0)
    + (siteType === "ROUGH" ? Math.max(0, Math.floor(villaFloors)) * 10 : 0);
  const productionDueAt = new Date(submittedAt);
  productionDueAt.setDate(productionDueAt.getDate() + calendarDays);
  const sundayRisk = productionDueAt.getDay() === 0;
  const internalDueAt = atFivePm(sundayRisk ? nextInternalWorkday(productionDueAt) : productionDueAt);
  return { productionDueAt, internalDueAt, sundayRisk, calendarDays };
}

export function workingDaysForTechnicalAmount(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError("合同金额必须是非负数");
  return Math.max(1, Math.ceil(amount / 60_000));
}

export type TechnicalCapacitySlot = {
  plannedStartAt: Date;
  dueAt: Date;
  workloadDays: number;
};

function startOfTechnicalWorkday(value: Date): Date {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  if (result.getDay() === 0) result.setDate(result.getDate() + 1);
  return result;
}

/**
 * Reserve one non-overlapping capacity block for a technical assignee.
 * The entry workday counts as day one; a later block starts on the next
 * Monday-Saturday workday after the previous block's 17:00 deadline.
 */
export function calculateTechnicalCapacitySlot(
  enteredTechnicalAt: Date,
  amount: number,
  previousDueAt?: Date | null,
): TechnicalCapacitySlot {
  const workloadDays = workingDaysForTechnicalAmount(amount);
  const entryDay = startOfTechnicalWorkday(enteredTechnicalAt);
  const plannedStartAt = previousDueAt && previousDueAt >= entryDay
    ? startOfTechnicalWorkday(nextInternalWorkday(previousDueAt))
    : entryDay;
  const dueAt = atFivePm(plannedStartAt);
  let remaining = workloadDays - 1;
  while (remaining > 0) {
    dueAt.setDate(dueAt.getDate() + 1);
    if (dueAt.getDay() !== 0) remaining -= 1;
  }
  return { plannedStartAt, dueAt, workloadDays };
}

export function calculateDelayDays(dueAt: Date, completedAt: Date): number {
  if (completedAt <= dueAt) return 0;
  return Math.max(1, Math.ceil((completedAt.getTime() - dueAt.getTime()) / 86_400_000));
}

export function resolveWarranty(type: BusinessType, acceptedAt?: Date | null): WarrantyResult {
  const years = type.startsWith("NOERLI") ? 20 : type.startsWith("AIKEJU") ? 10 : null;
  if (!years) return { automatic: false, years: null, startsAt: null, expiresAt: null, label: "不自动计算质保" };
  if (!acceptedAt) return { automatic: true, years, startsAt: null, expiresAt: null, label: `待验收 · ${years}年` };
  const expiresAt = new Date(acceptedAt);
  expiresAt.setFullYear(expiresAt.getFullYear() + years);
  return { automatic: true, years, startsAt: new Date(acceptedAt), expiresAt, label: `${years}年质保` };
}

export function shipmentAllowed(tailPaid: boolean, hasEligibleProductionArea: boolean): boolean {
  return tailPaid && hasEligibleProductionArea;
}

export function validateManufacturedShipmentLines(
  areas: Array<{ id: string; complete: boolean; finalShipmentRecorded: boolean }>,
  requested: Array<{ productionAreaId: string; isFinalBatch: boolean }>,
) {
  if (!areas.length) throw new Error("订单没有可发货的有效生产区域");
  if (!requested.length) throw new Error("本次发货至少选择一个生产区域");
  const ids = requested.map((line) => line.productionAreaId);
  if (new Set(ids).size !== ids.length) throw new Error("同一发货批次不能重复选择生产区域");
  for (const line of requested) {
    const area = areas.find((candidate) => candidate.id === line.productionAreaId);
    if (!area) throw new Error("发货区域不属于当前订单");
    if (!area.complete) throw new Error("只有已完成全部车间工序的生产区域可以发货");
    if (area.finalShipmentRecorded) throw new Error("该生产区域已登记末批，不得继续发货");
  }
  return requested;
}

type Transition = { from: WorkflowStage[]; to: WorkflowStage; title: string; nextAction: string };

export const WORKFLOW_TRANSITIONS: Record<OrderCommandType, Transition> = {
  REPORT_DEPOSIT: { from: ["DEPOSIT_PENDING"], to: "DEPOSIT_PENDING", title: "销售已报备定金", nextAction: "财务核验定金到账" },
  CONFIRM_DEPOSIT: { from: ["DEPOSIT_PENDING"], to: "DESIGN_PENDING", title: "财务确认定金到账", nextAction: "设计师下单" },
  REPORT_PREPAYMENT: { from: ["DEPOSIT_PENDING"], to: "DEPOSIT_PENDING", title: "销售已报备预付款", nextAction: "财务同时核验定金与预付款" },
  CONFIRM_INITIAL_PAYMENTS: { from: ["DEPOSIT_PENDING"], to: "DESIGN_PENDING", title: "财务确认定金与预付款到账", nextAction: "设计师下单" },
  ACCEPT_DESIGN: { from: ["DESIGN_PENDING"], to: "DESIGN_ACCEPTED", title: "设计师已下单", nextAction: "提交正式设计资料" },
  RETURN_DESIGN: { from: ["DESIGN_PENDING"], to: "DESIGN_PENDING", title: "设计师退回销售", nextAction: "销售重新分配设计师" },
  ASSIGN_DESIGNER: { from: ["DESIGN_PENDING"], to: "DESIGN_PENDING", title: "销售重新分配设计师", nextAction: "设计师在7个自然日内下单" },
  TRANSFER_DESIGN: { from: ["DESIGN_ACCEPTED"], to: "DESIGN_ACCEPTED", title: "设计任务已转交", nextAction: "新设计师按原截止时间提交正式设计资料" },
  SUBMIT_DESIGN: { from: ["DESIGN_ACCEPTED"], to: "PRE_REVIEW", title: "设计师正式提交", nextAction: "订单管理员前置审单" },
  APPROVE_PRE_REVIEW: { from: ["PRE_REVIEW"], to: "TECHNICAL", title: "前置审单通过", nextAction: "技术拆单排程" },
  REJECT_PRE_REVIEW: { from: ["PRE_REVIEW"], to: "DESIGN_ACCEPTED", title: "前置审单退回", nextAction: "设计师提交修订版本" },
  SUBMIT_TECHNICAL: { from: ["TECHNICAL"], to: "TECH_REVIEW", title: "拆单版本已提交", nextAction: "订单管理员技术审单" },
  APPROVE_TECH_REVIEW: { from: ["TECH_REVIEW"], to: "MATERIALS", title: "技术审单通过并发布成本快照", nextAction: "按生产区域分别确认板式与实木油漆采购" },
  REJECT_TECH_REVIEW: { from: ["TECH_REVIEW"], to: "TECHNICAL", title: "拆单审核退回", nextAction: "技术拆单修订" },
  PLAN_PROCUREMENT: { from: ["MATERIALS"], to: "MATERIALS", title: "本单采购方案已生成", nextAction: "确认物料条件并下达车间" },
  START_PRODUCTION: { from: ["MATERIALS"], to: "PRODUCTION", title: "四车间生产已下达", nextAction: "逐工序报工" },
  COMPLETE_PRODUCTION: { from: ["PRODUCTION"], to: "DELIVERY", title: "全部生产区域完成", nextAction: "尾款确认后按区域登记发货批次" },
  REPORT_TAIL_PAYMENT: { from: ["PRODUCTION", "INSTALLATION_APPLICATION", "DELIVERY"], to: "PRODUCTION", title: "销售已报备尾款", nextAction: "财务核验尾款到账" },
  CONFIRM_TAIL_PAYMENT: { from: ["PRODUCTION", "INSTALLATION_APPLICATION", "DELIVERY"], to: "PRODUCTION", title: "财务确认尾款到账", nextAction: "已解锁发货" },
  SUBMIT_INSTALLATION_APPLICATION: { from: ["PRODUCTION", "INSTALLATION_APPLICATION", "DELIVERY", "INSTALLATION", "ACCEPTANCE", "BUSINESS_COMPLETE"], to: "PRODUCTION", title: "安装申请已提交", nextAction: "继续当前履约" },
  RECORD_DELIVERY: { from: ["MATERIALS", "PRODUCTION", "INSTALLATION_APPLICATION", "DELIVERY", "INSTALLATION"], to: "INSTALLATION", title: "本次发货已登记", nextAction: "继续当前履约" },
  RECORD_OUTSOURCE_DELIVERY: { from: ["MATERIALS", "PRODUCTION", "INSTALLATION_APPLICATION", "DELIVERY", "INSTALLATION"], to: "MATERIALS", title: "外购产品已发货", nextAction: "继续当前主流程" },
  COMPLETE_INSTALLATION: { from: ["INSTALLATION"], to: "ACCEPTANCE", title: "安装已完成", nextAction: "客户最终验收" },
  COMPLETE_INSTALLATION_BATCH: { from: ["PRODUCTION", "DELIVERY", "INSTALLATION"], to: "INSTALLATION", title: "安装批次已完成", nextAction: "继续其余发货与安装批次" },
  ACCEPT_CUSTOMER: { from: ["ACCEPTANCE"], to: "BUSINESS_COMPLETE", title: "客户最终验收通过", nextAction: "财务归集成本" },
};

export function assertTransition(stage: WorkflowStage, command: OrderCommandType): Transition {
  const transition = WORKFLOW_TRANSITIONS[command];
  if (!transition.from.includes(stage)) throw new Error(`当前阶段 ${stage} 不能执行 ${command}`);
  return transition;
}
