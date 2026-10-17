import type { MiniEmployee, MiniRole, MiniTaskType, NavigationItem, RoleWorkspaceConfig } from "./types";
import { getStoredSession } from "./store";

const sharedPages = ["login", "workspace", "orders", "order-detail", "notifications", "profile"];

function nav(key: string, label: string, route: string, icon: NavigationItem["icon"]): NavigationItem {
  return { key, label, route, icon };
}

const taskTypes = (...values: MiniTaskType[]) => values;

export const ROLE_WORKSPACES: Record<MiniRole, RoleWorkspaceConfig> = {
  CHAIRMAN: {
    role: "CHAIRMAN", homeRoute: "/pages/workspace/index",
    navigationItems: [nav("workspace", "工作台", "/pages/workspace/index", "workspace"), nav("role-center", "风险", "/pages/role-center/index?section=risk", "risk"), nav("orders", "订单", "/pages/orders/index", "orders"), nav("profile", "我的", "/pages/profile/index", "profile")],
    supportedTaskTypes: taskTypes("CHAIRMAN_APPROVAL", "FINANCE_PAYMENT", "CUSTOMER_ACCEPTANCE", "PROCUREMENT_ROUTE", "DESKTOP_REVIEW"),
    allowedPages: [...sharedPages, "role-center", "role-action", "installation", "supply"],
  },
  SALES: {
    role: "SALES",
    homeRoute: "/pages/workspace/index",
    navigationItems: [
      nav("workspace", "工作台", "/pages/workspace/index", "workspace"),
      nav("sales-create", "新建", "/pages/sales-create/index", "create"),
      nav("orders", "订单", "/pages/orders/index", "orders"),
      nav("profile", "我的", "/pages/profile/index", "profile"),
    ],
    supportedTaskTypes: taskTypes("SALES_CREATE", "INITIAL_PAYMENT", "DESIGN_REASSIGN", "TAIL_PAYMENT"),
    allowedPages: [...sharedPages, "sales-create"],
  },
  ORDER_ADMIN: {
    role: "ORDER_ADMIN",
    homeRoute: "/pages/workspace/index",
    navigationItems: [
      nav("workspace", "工作台", "/pages/workspace/index", "workspace"),
      nav("shipment", "发货", "/pages/shipment-list/index", "shipment"),
      nav("orders", "订单", "/pages/orders/index", "orders"),
      nav("profile", "我的", "/pages/profile/index", "profile"),
    ],
    supportedTaskTypes: taskTypes("SHIPMENT", "OUTSOURCE_ARRIVAL", "DESKTOP_REVIEW", "CUSTOMER_ACCEPTANCE"),
    allowedPages: [...sharedPages, "shipment-list", "shipment", "installation", "supply"],
  },
  FINANCE: {
    role: "FINANCE", homeRoute: "/pages/workspace/index",
    navigationItems: [nav("workspace", "工作台", "/pages/workspace/index", "workspace"), nav("role-center", "收款", "/pages/role-center/index?section=finance", "finance"), nav("orders", "订单", "/pages/orders/index", "orders"), nav("profile", "我的", "/pages/profile/index", "profile")],
    supportedTaskTypes: taskTypes("FINANCE_PAYMENT", "DESKTOP_REVIEW"),
    allowedPages: [...sharedPages, "role-center", "role-action"],
  },
  DESIGNER: {
    role: "DESIGNER", homeRoute: "/pages/workspace/index",
    navigationItems: [nav("workspace", "工作台", "/pages/workspace/index", "workspace"), nav("role-center", "设计", "/pages/role-center/index?section=design", "design"), nav("orders", "订单", "/pages/orders/index", "orders"), nav("profile", "我的", "/pages/profile/index", "profile")],
    supportedTaskTypes: taskTypes("DESIGN_INTAKE", "DESIGN_TRANSFER", "DESIGN_SUBMISSION", "DESKTOP_REVIEW"),
    allowedPages: [...sharedPages, "role-center", "role-action", "design-submit"],
  },
  TECHNICAL: {
    role: "TECHNICAL", homeRoute: "/pages/workspace/index",
    navigationItems: [nav("workspace", "工作台", "/pages/workspace/index", "workspace"), nav("role-center", "技术", "/pages/role-center/index?section=technical", "technical"), nav("orders", "订单", "/pages/orders/index", "orders"), nav("profile", "我的", "/pages/profile/index", "profile")],
    supportedTaskTypes: taskTypes("TECHNICAL_DESKTOP", "DESKTOP_REVIEW"),
    allowedPages: [...sharedPages, "role-center"],
  },
  PROCUREMENT: {
    role: "PROCUREMENT", homeRoute: "/pages/workspace/index",
    navigationItems: [nav("workspace", "工作台", "/pages/workspace/index", "workspace"), nav("role-center", "采购", "/pages/role-center/index?section=procurement", "procurement"), nav("orders", "订单", "/pages/orders/index", "orders"), nav("profile", "我的", "/pages/profile/index", "profile")],
    supportedTaskTypes: taskTypes("PROCUREMENT_ROUTE", "PROCUREMENT_PACKAGE", "DESKTOP_REVIEW"),
    allowedPages: [...sharedPages, "role-center", "supply"],
  },
  INSTALLER: {
    role: "INSTALLER",
    homeRoute: "/pages/workspace/index",
    navigationItems: [
      nav("workspace", "工作台", "/pages/workspace/index", "workspace"),
      nav("installation", "安装", "/pages/installation-list/index", "installation"),
      nav("orders", "订单", "/pages/orders/index", "orders"),
      nav("profile", "我的", "/pages/profile/index", "profile"),
    ],
    supportedTaskTypes: taskTypes("INSTALLATION", "CUSTOMER_ACCEPTANCE"),
    allowedPages: [...sharedPages, "installation-list", "installation"],
  },
  AFTERSALES: {
    role: "AFTERSALES",
    homeRoute: "/pages/workspace/index",
    navigationItems: [
      nav("workspace", "工作台", "/pages/workspace/index", "workspace"),
      nav("aftersales", "售后", "/pages/aftersales/index", "aftersales"),
      nav("orders", "订单", "/pages/orders/index", "orders"),
      nav("profile", "我的", "/pages/profile/index", "profile"),
    ],
    supportedTaskTypes: taskTypes("AFTERSALES_CASE"),
    allowedPages: [...sharedPages, "aftersales"],
  },
  WORKSHOP: {
    role: "WORKSHOP",
    homeRoute: "/pages/tracking/index",
    navigationItems: [
      nav("tracking", "追踪", "/pages/tracking/index", "tracking"),
      nav("tasks", "待办", "/pages/tasks/index", "tasks"),
      nav("scan", "扫码", "/pages/scan/index", "scan"),
      nav("profile", "我的", "/pages/profile/index", "profile"),
    ],
    supportedTaskTypes: taskTypes("WORKSHOP_PROCESS"),
    allowedPages: [...sharedPages, "tracking", "tasks", "scan", "report", "issue", "package-count"],
  },
};

const WORKSHOP_SUPERVISOR_WORKSPACE: RoleWorkspaceConfig = {
  role: "WORKSHOP", homeRoute: "/pages/tracking/index",
  navigationItems: [nav("tracking", "车间", "/pages/tracking/index", "workshop"), nav("tasks", "异常", "/pages/tasks/index?filter=issue", "issues"), nav("scan", "扫码", "/pages/scan/index", "scan"), nav("profile", "我的", "/pages/profile/index", "profile")],
  supportedTaskTypes: taskTypes("WORKSHOP_SUPERVISOR", "WORKSHOP_PROCESS"),
  allowedPages: [...sharedPages, "tracking", "tasks", "scan", "report", "issue", "package-count"],
};

export function roleWorkspace(role: MiniRole, level?: MiniEmployee["level"]) { return role === "WORKSHOP" && level === "SUPERVISOR" ? WORKSHOP_SUPERVISOR_WORKSPACE : ROLE_WORKSPACES[role]; }
export function homeForRole(role: MiniRole, level?: MiniEmployee["level"]) { return roleWorkspace(role, level).homeRoute; }

export function requireSession(): MiniEmployee | null {
  const employee = getStoredSession();
  if (!employee) wx.reLaunch({ url: "/pages/login/index" });
  return employee;
}

export function requireRole(roles: MiniRole[]): MiniEmployee | null {
  const employee = requireSession();
  if (!employee) return null;
  if (!roles.includes(employee.role)) {
    wx.showToast({ title: "当前岗位无权进入该页面", icon: "none" });
    wx.reLaunch({ url: homeForRole(employee.role, employee.level) });
    return null;
  }
  return employee;
}
