import { requireRole } from "../../domain/roles";
import type { MiniWorkspaceTask } from "../../domain/types";
import { loadRoleWorkspace } from "../../services/workspace";

Page({
  data: { tasks: [] as MiniWorkspaceTask[], loading: true, error: "" },
  onShow() { if (requireRole(["INSTALLER"])) void this.loadData(); },
  onPullDownRefresh() { this.loadData().finally(() => wx.stopPullDownRefresh()); },
  async loadData() {
    this.setData({ loading: true, error: "" });
    try {
      const workspace = await loadRoleWorkspace();
      this.setData({ tasks: workspace.tasks.filter((item) => item.type === "INSTALLATION" || item.type === "CUSTOMER_ACCEPTANCE"), loading: false });
    } catch (error) { this.setData({ loading: false, error: error instanceof Error ? error.message : "安装待办加载失败" }); }
  },
  openTask(event: { currentTarget: { dataset: { route: string } } }) {
    const route = event.currentTarget.dataset.route;
    if (route) wx.navigateTo({ url: route });
  },
});
