import type { Employee, Role } from "../generated/prisma/client.js";
import { SALES_UNIT_LABELS } from "./sales-policy.js";

export const MINI_PROGRAM_ROLES = ["CHAIRMAN", "ORDER_ADMIN", "FINANCE", "SALES", "DESIGNER", "TECHNICAL", "PROCUREMENT", "WORKSHOP", "INSTALLER", "AFTERSALES"] as const satisfies readonly Role[];
export type MiniProgramRole = (typeof MINI_PROGRAM_ROLES)[number];

const CAPABILITIES: Record<MiniProgramRole, string[]> = {
  CHAIRMAN: ["workspace:read", "orders:read", "risks:read", "payment-account:review", "finance:confirm", "procurement:route-confirm", "customer-acceptance:override"],
  SALES: ["workspace:read", "orders:read", "sales:create", "sales:payment-report"],
  ORDER_ADMIN: ["workspace:read", "orders:read", "shipment:write", "outsource-arrival:write", "customer-acceptance:write"],
  FINANCE: ["workspace:read", "orders:read", "finance:confirm", "payment-account:request", "payment-receipt:read"],
  DESIGNER: ["workspace:read", "orders:assigned-read", "design:intake", "design:return", "design:transfer"],
  TECHNICAL: ["workspace:read", "orders:read", "technical:desktop-handoff"],
  PROCUREMENT: ["workspace:read", "orders:read", "procurement:route-confirm", "package-count:hardware"],
  INSTALLER: ["workspace:read", "orders:assigned-read", "installation:write", "customer-acceptance:write"],
  AFTERSALES: ["workspace:read", "orders:completed-read", "aftersales:write"],
  WORKSHOP: ["workshop:read", "workshop:report", "production-scan:read"],
};

export function isMiniProgramRole(role: Role | string): role is MiniProgramRole {
  return MINI_PROGRAM_ROLES.includes(role as MiniProgramRole);
}

export function miniCapabilities(role: Role | string, level = "STAFF") {
  if (!isMiniProgramRole(role)) return [];
  const capabilities = [...CAPABILITIES[role]];
  if (role === "SALES") capabilities.push(level === "SUPERVISOR" ? "sales:brand-orders-read" : "sales:own-orders-read");
  if (role === "WORKSHOP" && level === "SUPERVISOR") capabilities.push("workshop:supervise");
  return capabilities;
}

export function miniEmployeeView(employee: Pick<Employee, "id" | "employeeNo" | "name" | "department" | "role" | "level" | "businessUnit" | "workshop">) {
  const salesBrand = SALES_UNIT_LABELS[employee.businessUnit ?? ""] ?? "未分配品牌";
  const labels: Record<MiniProgramRole, string> = {
    CHAIRMAN: "董事长管理员",
    SALES: `${salesBrand}${employee.level === "SUPERVISOR" ? "销售主管" : "销售员"}`,
    ORDER_ADMIN: "订单管理员",
    FINANCE: "财务人员",
    DESIGNER: "设计师",
    TECHNICAL: "技术拆单员",
    PROCUREMENT: "采购人员",
    INSTALLER: "安装人员",
    AFTERSALES: "售后人员",
    WORKSHOP: employee.workshop ? `${employee.workshop}车间${employee.level === "SUPERVISOR" ? "主管" : "工人"}` : "车间人员",
  };
  if (!isMiniProgramRole(employee.role)) throw new Error("当前岗位未开放小程序");
  return {
    id: employee.id,
    employeeNo: employee.employeeNo,
    name: employee.name,
    role: employee.role,
    roleLabel: labels[employee.role],
    department: employee.department,
    level: employee.level,
    businessUnit: employee.businessUnit,
    workshop: employee.workshop,
    capabilities: miniCapabilities(employee.role, employee.level),
  };
}
