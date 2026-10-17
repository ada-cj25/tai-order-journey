import { getSession } from "../../domain/store";
import { runtime } from "../../config/runtime";
import { requireSession } from "../../domain/roles";
import { logoutMini } from "../../services/auth";

const roleMenus = {
  CHAIRMAN: [{ label: "全局风险与关键审批", meta: "移动关键覆盖", route: "/pages/role-center/index?section=risk" }],
  SALES: [{ label: "新建销售签约订单", meta: "原生表单", route: "/pages/sales-create/index" }],
  ORDER_ADMIN: [{ label: "发货订单", meta: "选择订单后登记车次", route: "/pages/shipment-list/index" }],
  FINANCE: [{ label: "收款核验", meta: "财务工作区", route: "/pages/role-center/index?section=finance" }],
  DESIGNER: [{ label: "设计任务", meta: "接单与转交", route: "/pages/role-center/index?section=design" }],
  TECHNICAL: [{ label: "技术拆单队列", meta: "大文件在电脑端", route: "/pages/role-center/index?section=technical" }],
  PROCUREMENT: [{ label: "采购确认", meta: "路线与五金包", route: "/pages/role-center/index?section=procurement" }],
  INSTALLER: [{ label: "查看安装车次", meta: "安装工作区", route: "/pages/installation-list/index" }],
  AFTERSALES: [{ label: "售后处理队列", meta: "售后工作区", route: "/pages/aftersales/index" }],
  WORKSHOP: [{ label: "车间待办", meta: "扫码与逐工序报工", route: "/pages/tasks/index" }],
} as const;

Page({
  data: { employee: getSession(), avatarText: getSession().name.slice(0, 1), mockMode: runtime.mode === "mock", environmentLabel: "本地模拟环境 · 不连接生产数据", scopeLabel: "", menus: [] as Array<{ label: string; meta: string; route: string }> },
  onShow() { const employee = requireSession(); if (!employee) return; const brand = employee.businessUnit === "NOERLI" ? "诺尔丽" : employee.businessUnit === "AIKEJU" ? "艾可居" : ""; const scopeLabel = employee.role === "SALES" ? employee.level === "SUPERVISOR" ? `可查看${brand}品牌全部销售订单；付款仍由所属销售报备` : "只查看和办理本人负责的订单" : "按岗位权限查看和办理任务"; this.setData({ employee, avatarText: employee.name.slice(0, 1), mockMode: runtime.mode === "mock", environmentLabel: runtime.mode === "mock" ? "本地模拟环境 · 不连接生产数据" : runtime.localDevLogin ? "本机 API 联调 · 本地测试库" : "微信员工账号 · 公司云测试库", scopeLabel, menus: [...roleMenus[employee.role]] }); },
  async switchAccount() { await logoutMini(); wx.reLaunch({ url: "/pages/login/index" }); },
  openMenu(event: { currentTarget: { dataset: { route: string } } }) { wx.navigateTo({ url: event.currentTarget.dataset.route }); },
  openWebView() { wx.navigateTo({ url: "/pages/webview/index" }); },
  showPrivacy() { wx.showModal({ title: "数据与权限", content: runtime.mode === "mock" ? "当前使用 TEST-DEMO-* 本机模拟数据。" : runtime.localDevLogin ? "当前连接本机 ERP 测试库；模拟微信身份只供开发者工具联调。" : "当前连接公司云测试库；岗位权限由服务端校验。", showCancel: false }); },
  logout() {
    wx.showModal({ title: "退出登录", content: runtime.mode === "mock" ? "退出后可以重新选择一个本地测试账号。" : "将撤销当前设备会话，但不解除微信与员工的绑定。", confirmText: "退出", success: async (result) => { if (!result.confirm) return; await logoutMini(); wx.reLaunch({ url: "/pages/login/index" }); } });
  },
});
