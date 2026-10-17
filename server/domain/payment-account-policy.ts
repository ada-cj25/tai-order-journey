export function normalizePaymentAccountName(value: unknown) {
  if (typeof value !== "string") throw new Error("请填写收款账户名称");
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("请填写收款账户名称");
  if (name.length < 2 || name.length > 80) throw new Error("收款账户名称应为2至80个字符");
  return name;
}
