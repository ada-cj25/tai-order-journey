import type { MiniOrder } from "./types";

const categoryDigits: Record<string, string> = {
  NOERLI_FORMAL: "1", NOERLI_SUPPLEMENT: "0",
  AIKEJU_FORMAL: "9", AIKEJU_SUPPLEMENT: "8",
  CHANNEL_FORMAL: "5", CHANNEL_SUPPLEMENT: "5",
  ENGINEERING_FORMAL: "7", ENGINEERING_SUPPLEMENT: "7",
  WORKWEAR_FORMAL: "7", WORKWEAR_SUPPLEMENT: "7",
};

function shanghaiDateParts(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("测试订单的日期无效");
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (kind: string) => parts.find((part) => part.type === kind)?.value ?? "";
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")) };
}

export function mockProductionNumberBase(order: Pick<MiniOrder, "businessType">, assignedAt: string): string {
  const category = categoryDigits[order.businessType ?? ""];
  if (!category) throw new Error("订单业务分类无法分配测试生产编号");
  const { year, month } = shanghaiDateParts(assignedAt);
  return `${String(year).slice(-2)}${String(month).padStart(2, "0")}${category}`;
}

export function formatMockProductionNumber(order: Pick<MiniOrder, "businessType">, assignedAt: string, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999) throw new Error("本月测试生产编号已满");
  const base = `${mockProductionNumberBase(order, assignedAt)}${String(sequence).padStart(3, "0")}`;
  return `TEST-${order.businessType?.endsWith("_SUPPLEMENT") ? "补单-B" : ""}${base}`;
}

export function mockProductionDeadline(order: Pick<MiniOrder, "siteType" | "finishType" | "villaFloors">, submittedAt: string): string {
  const { year, month, day } = shanghaiDateParts(submittedAt);
  const days = (order.siteType === "ROUGH" ? 37 : 33) + (order.finishType === "PAINT" ? 5 : 0)
    + (order.siteType === "ROUGH" && Number(order.villaFloors) > 0 ? Number(order.villaFloors) * 10 : 0);
  const due = new Date(Date.UTC(year, month - 1, day + days, 9));
  if (due.getUTCDay() === 0) due.setUTCDate(due.getUTCDate() + 1);
  return due.toISOString();
}

export function mockDueLabel(iso: string): string {
  const { year, month, day } = shanghaiDateParts(iso);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
