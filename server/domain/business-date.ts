export function shanghaiBusinessDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(`${value.year}-${value.month}-${value.day}T00:00:00+08:00`);
}

export function parseShanghaiBusinessDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("日期必须使用 YYYY-MM-DD 格式");
  const parsed = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error("日期无效");
  const roundTrip = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
  if (roundTrip !== value) throw new Error("日期无效");
  return parsed;
}

export function shanghaiBusinessDeadline(date: Date, hour = 17) {
  return new Date(date.getTime() + hour * 60 * 60 * 1000);
}
