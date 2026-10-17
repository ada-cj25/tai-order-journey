export const SUPPLEMENT_TYPE_OPTIONS = [
  { value: "INSTALLATION_ISSUE", label: "安装现场问题" },
  { value: "PRODUCTION_ISSUE", label: "生产责任问题" },
  { value: "DESIGN_ISSUE", label: "设计责任问题" },
  { value: "CUSTOMER_ADDITION", label: "客户增项" },
  { value: "AFTERSALES", label: "售后补单" },
] as const;

export const RESPONSIBILITY_TYPE_OPTIONS = [
  { value: "CUSTOMER_PAID", label: "客户付费" },
  { value: "COMPANY_RESPONSIBILITY", label: "公司责任·免收" },
  { value: "DESIGN_RESPONSIBILITY", label: "设计责任·免收" },
  { value: "PRODUCTION_RESPONSIBILITY", label: "生产责任·免收" },
  { value: "PENDING", label: "待定责" },
] as const;

export function supplementTypeLabel(value?: string | null) {
  if (!value) return "—";
  return SUPPLEMENT_TYPE_OPTIONS.find((item) => item.value === value)?.label ?? "其他补单来源";
}

export function responsibilityTypeLabel(value?: string | null) {
  if (!value) return "—";
  return RESPONSIBILITY_TYPE_OPTIONS.find((item) => item.value === value)?.label ?? "其他责任方式";
}
