/** Unit prices retain the database's four-decimal precision; totals use cents. */
export function formatUnitCost(value: unknown) {
  if (value == null) return "—";
  return `¥${Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}
