// Manifest YYMM (2000–2099) and database YYYYMM must address the same pool.
export function numberPoolMonth(value: unknown): string {
  if (typeof value !== "string") throw new Error("编号池月份须为YYMM或YYYYMM");
  if (/^\d{2}(0[1-9]|1[0-2])$/.test(value)) return `20${value}`;
  if (/^\d{4}(0[1-9]|1[0-2])$/.test(value)) return value;
  throw new Error("编号池月份须为YYMM或YYYYMM，月份范围01–12");
}
