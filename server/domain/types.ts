export const BUSINESS_TYPES = [
  "NOERLI_FORMAL",
  "NOERLI_SUPPLEMENT",
  "AIKEJU_FORMAL",
  "AIKEJU_SUPPLEMENT",
  "CHANNEL_FORMAL",
  "CHANNEL_SUPPLEMENT",
  "ENGINEERING_FORMAL",
  "ENGINEERING_SUPPLEMENT",
  "WORKWEAR_FORMAL",
  "WORKWEAR_SUPPLEMENT",
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];
export type SiteType = "FINISHED" | "ROUGH";
export type InventoryMode = "ORDER_SPECIFIC" | "STOCK_STANDARD";
export type MaterialTemplateType = "HARDWARE_MATERIALS" | "PAINT_WOOD" | "SOLID_WOOD_DOOR" | "VENEER_DOOR";

export type WorkflowStage =
  | "DEPOSIT_PENDING"
  | "DESIGN_PENDING"
  | "DESIGN_ACCEPTED"
  | "PRE_REVIEW"
  | "TECHNICAL"
  | "TECH_REVIEW"
  | "MATERIALS"
  | "PRODUCTION"
  | "INSTALLATION_APPLICATION"
  | "DELIVERY"
  | "INSTALLATION"
  | "ACCEPTANCE"
  | "BUSINESS_COMPLETE";

export type OrderCommandType =
  | "REPORT_DEPOSIT"
  | "CONFIRM_DEPOSIT"
  | "REPORT_PREPAYMENT"
  | "CONFIRM_INITIAL_PAYMENTS"
  | "ACCEPT_DESIGN"
  | "RETURN_DESIGN"
  | "ASSIGN_DESIGNER"
  | "TRANSFER_DESIGN"
  | "SUBMIT_DESIGN"
  | "APPROVE_PRE_REVIEW"
  | "REJECT_PRE_REVIEW"
  | "SUBMIT_TECHNICAL"
  | "APPROVE_TECH_REVIEW"
  | "REJECT_TECH_REVIEW"
  | "PLAN_PROCUREMENT"
  | "START_PRODUCTION"
  | "COMPLETE_PRODUCTION"
  | "REPORT_TAIL_PAYMENT"
  | "CONFIRM_TAIL_PAYMENT"
  | "SUBMIT_INSTALLATION_APPLICATION"
  | "RECORD_DELIVERY"
  | "RECORD_OUTSOURCE_DELIVERY"
  | "COMPLETE_INSTALLATION"
  | "COMPLETE_INSTALLATION_BATCH"
  | "ACCEPT_CUSTOMER";

export interface ScheduleResult {
  standardDueAt: Date;
  effectiveDueAt: Date;
  internalDueAt: Date;
  reminderAt: Date;
  sundayRisk: boolean;
}

export type FinishType = "MELAMINE" | "PAINT";

export interface WarrantyResult {
  automatic: boolean;
  years: number | null;
  startsAt: Date | null;
  expiresAt: Date | null;
  label: string;
}
