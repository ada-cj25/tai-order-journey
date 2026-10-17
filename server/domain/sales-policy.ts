import { BUSINESS_TYPES, type BusinessType } from "./types.js";

export const SALES_UNIT_LABELS: Record<string, string> = {
  NOERLI: "诺尔丽", AIKEJU: "艾可居", CHANNEL: "渠道", ENGINEERING: "工程", WORKWEAR: "工装",
};

export function salesBusinessTypes(unit: string | null | undefined): BusinessType[] {
  if (!unit || !Object.hasOwn(SALES_UNIT_LABELS, unit)) return [];
  return BUSINESS_TYPES.filter((type) => type.startsWith(`${unit}_`));
}

export function salesRoleLabel(employee: { level?: string; businessUnit?: string | null }) {
  return `${SALES_UNIT_LABELS[employee.businessUnit ?? ""] ?? "未分配品牌"}${employee.level === "SUPERVISOR" ? "销售主管" : "销售员"}`;
}
