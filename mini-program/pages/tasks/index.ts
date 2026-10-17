import { getSession } from "../../domain/store";
import type { MiniTask } from "../../domain/types";
import { loadWorkshopWorkbench, syncLabel } from "../../services/workbench";
import { requireRole } from "../../domain/roles";

let refreshTimer: ReturnType<typeof setInterval> | undefined;

Page({
  data: {
    employee: getSession(),
    tasks: [] as MiniTask[],
    taskCount: 0,
    syncText: "正在同步",
    offline: false,
    loading: true,
    filter: "actionable" as "actionable" | "issue",
    pageTitle: "现在可做",
  },
  onLoad(query: { filter?: string }) { const employee = requireRole(["WORKSHOP"]); const filter = query.filter === "issue" && employee?.level === "SUPERVISOR" ? "issue" : "actionable"; this.setData({ filter, pageTitle: filter === "issue" ? "异常巡查" : "现在可做" }); },
  onShow() {
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
      const workbench = await loadWorkshopWorkbench();
      this.setData({
        employee: getSession(),
        tasks: this.data.filter === "issue" ? workbench.allUnfinished.filter((task) => task.state === "ISSUE") : workbench.actionable,
        taskCount: this.data.filter === "issue" ? workbench.summary.issue : workbench.actionable.length,
        syncText: syncLabel(workbench.serverTime),
        offline: false,
        loading: false,
      });
    } catch (error) {
      this.setData({ offline: true, loading: false, syncText: "网络异常，当前内容可能不是最新" });
      if (!silent) wx.showToast({ title: error instanceof Error ? error.message : "待办同步失败", icon: "none", duration: 2600 });
    }
  },
  report(event: { currentTarget: { dataset: { taskId: string } } }) {
    wx.navigateTo({ url: `/pages/report/index?taskId=${event.currentTarget.dataset.taskId}` });
  },
  issue(event: { currentTarget: { dataset: { taskId: string } } }) {
    wx.navigateTo({ url: `/pages/issue/index?taskId=${event.currentTarget.dataset.taskId}` });
  },
  openNotifications() { wx.showToast({ title: "暂无新的车间消息", icon: "none" }); },
});
