import { groupWorkshopTasks, selectWorkshopTasks } from "../../domain/projections";
import type { MiniTask, MiniTaskGroup, WorkshopTaskState, WorkshopWorkbench } from "../../domain/types";
import { loadWorkshopWorkbench, syncLabel } from "../../services/workbench";
import { requireRole } from "../../domain/roles";
import { loadPackageWorkbench } from "../../services/package-count";
import { groupPackageActions, selectPackageActions, type MiniPackageAction, type MiniPackageActionGroup } from "../../domain/package-workbench";

type FilterKey = "ALL" | WorkshopTaskState;
const filters: Array<{ key: FilterKey; label: string }> = [
  { key: "ALL", label: "全部" },
  { key: "ACTIONABLE", label: "可报工" },
  { key: "IN_PROGRESS", label: "进行中" },
  { key: "WAITING", label: "等待前序" },
  { key: "ISSUE", label: "异常" },
  { key: "COMPLETED_TODAY", label: "今日完成" },
];

let refreshTimer: ReturnType<typeof setInterval> | undefined;

Page({
  data: {
    filters,
    activeFilter: "ALL" as FilterKey,
    query: "",
    groups: [] as MiniTaskGroup[],
    workbench: null as WorkshopWorkbench | null,
    summary: { allUnfinished: 0, actionable: 0, waiting: 0, issue: 0, completedToday: 0 },
    syncText: "正在同步",
    offline: false,
    loading: true,
    isAssembly: false,
    packageActions: [] as MiniPackageAction[],
    packageActionCount: 0,
    packageGroups: [] as MiniPackageActionGroup[],
    expandedPackageOrderId: "",
  },
  onLoad() { const employee = requireRole(["WORKSHOP"]); this.setData({ isAssembly: employee?.workshop === "ASSEMBLY" }); },
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
      const [workbench, packageActions] = await Promise.all([loadWorkshopWorkbench(), this.data.isAssembly ? loadPackageWorkbench() : Promise.resolve([])]);
      this.setData({ workbench, summary: workbench.summary, packageActions, syncText: syncLabel(workbench.serverTime), offline: false, loading: false });
      this.applyFilters(workbench);
      this.applyPackageFilter(packageActions);
    } catch (error) {
      this.setData({ offline: true, loading: false, syncText: "网络异常，当前内容可能不是最新" });
      if (!silent) wx.showToast({ title: error instanceof Error ? error.message : "任务同步失败", icon: "none", duration: 2600 });
    }
  },
  applyFilters(workbench?: WorkshopWorkbench | null) {
    const current = workbench ?? this.data.workbench;
    if (!current) return;
    const source = this.data.activeFilter === "COMPLETED_TODAY" ? current.completedToday : current.allUnfinished;
    const tasks = selectWorkshopTasks(source, this.data.activeFilter, this.data.query);
    this.setData({ groups: groupWorkshopTasks(tasks) });
  },
  changeQuery(event: { detail: { value: string } }) {
    this.setData({ query: event.detail.value });
    this.applyFilters();
    this.applyPackageFilter(this.data.packageActions);
  },
  applyPackageFilter(actions: MiniPackageAction[]) {
    const visible = selectPackageActions(actions, this.data.query);
    const packageGroups = groupPackageActions(visible);
    this.setData({
      packageActionCount: visible.length,
      packageGroups,
      expandedPackageOrderId: packageGroups.some((group) => group.orderId === this.data.expandedPackageOrderId) ? this.data.expandedPackageOrderId : "",
    });
  },
  togglePackageGroup(event: { currentTarget: { dataset: { orderId: string } } }) {
    const orderId = event.currentTarget.dataset.orderId;
    this.setData({ expandedPackageOrderId: this.data.expandedPackageOrderId === orderId ? "" : orderId });
  },
  selectFilter(event: { currentTarget: { dataset: { key: FilterKey } } }) {
    this.setData({ activeFilter: event.currentTarget.dataset.key });
    this.applyFilters();
  },
  openTask(event: { currentTarget: { dataset: { taskId: string } } }) {
    wx.navigateTo({ url: `/pages/report/index?taskId=${event.currentTarget.dataset.taskId}` });
  },
  openOrder(event: { currentTarget: { dataset: { orderId: string; areaId: string } } }) {
    const { orderId, areaId } = event.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/order-detail/index?id=${orderId}&areaId=${areaId}` });
  },
  openGroup(event: { currentTarget: { dataset: { orderId: string } } }) {
    wx.navigateTo({ url: `/pages/order-detail/index?id=${event.currentTarget.dataset.orderId}` });
  },
  openPackageAction(event: { currentTarget: { dataset: { orderId: string; areaId: string; sourceKey: string } } }) {
    const { orderId, areaId, sourceKey } = event.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/package-count/index?orderId=${encodeURIComponent(orderId)}&areaId=${encodeURIComponent(areaId)}&sourceKey=${encodeURIComponent(sourceKey)}` });
  },
  openNotifications() { wx.showToast({ title: "暂无新的车间消息", icon: "none" }); },
});
