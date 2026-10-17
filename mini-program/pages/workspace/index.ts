import { getStoredSession } from "../../domain/store";
import { homeForRole, requireSession } from "../../domain/roles";
import type { MiniWorkspace } from "../../domain/types";
import { loadRoleWorkspace } from "../../services/workspace";

let refreshTimer: ReturnType<typeof setInterval> | undefined;

Page({
  data: { workbench: null as MiniWorkspace | null, employee: getStoredSession(), loading: true, offline: false, syncText: "正在同步" },
  onLoad() {
    const employee = requireSession();
    if (employee?.role === "WORKSHOP") wx.reLaunch({ url: homeForRole(employee.role, employee.level) });
  },
  onShow() {
    if (!requireSession()) return;
    this.loadData();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => this.loadData(true), 30_000);
  },
  onHide() { if (refreshTimer) clearInterval(refreshTimer); refreshTimer = undefined; },
  onUnload() { if (refreshTimer) clearInterval(refreshTimer); refreshTimer = undefined; },
  onPullDownRefresh() { this.loadData(true).finally(() => wx.stopPullDownRefresh()); },
  async loadData(silent = false) {
    if (!silent) this.setData({ loading: true });
    try {
      const workbench = await loadRoleWorkspace();
      this.setData({ workbench, employee: workbench.employee, loading: false, offline: false, syncText: "刚刚更新" });
    } catch (error) {
      this.setData({ loading: false, offline: true, syncText: "网络异常，内容可能不是最新" });
      if (!silent) wx.showToast({ title: error instanceof Error ? error.message : "工作台加载失败", icon: "none" });
    }
  },
  openTask(event: { currentTarget: { dataset: { route?: string; desktop?: boolean; identifier?: string; module?: string; reason?: string } } }) {
    const { route, desktop, identifier, module, reason } = event.currentTarget.dataset;
    if (desktop) { wx.showModal({ title: "请在电脑端办理", content: `${reason || "该任务包含大文件或完整审单内容"}\n\n电脑端位置：${module || "订单详情"}\n业务编号：${identifier || "请查看任务卡"}`, confirmText: identifier ? "复制编号" : "知道了", showCancel: Boolean(identifier), success: (result) => { if (result.confirm && identifier) wx.setClipboardData({ data: identifier }); } }); return; }
    if (route) wx.navigateTo({ url: route });
  },
  openNotifications() { wx.navigateTo({ url: "/pages/notifications/index" }); },
});
