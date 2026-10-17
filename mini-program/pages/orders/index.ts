import { requireSession } from "../../domain/roles";
import { orderProgressPercent } from "../../domain/projections";
import type { MiniOrder } from "../../domain/types";
import { loadRoleOrders } from "../../services/mobile";

let refreshTimer: ReturnType<typeof setInterval> | undefined;
type OrderCard = MiniOrder & { journeyProgress: number };

Page({
  data: { employee: null as ReturnType<typeof requireSession>, query: "", allOrders: [] as MiniOrder[], orders: [] as OrderCard[], scopeTitle: "我负责的订单", scopeDescription: "只显示与当前账号相关的订单", showSalesOwner: false },
  onShow() {
    if (!requireSession()) return;
    void this.loadData();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => void this.loadData(true), 30_000);
  },
  onHide() { if (refreshTimer) clearInterval(refreshTimer); refreshTimer = undefined; },
  onUnload() { if (refreshTimer) clearInterval(refreshTimer); refreshTimer = undefined; },
  onPullDownRefresh() { this.loadData().finally(() => wx.stopPullDownRefresh()); },
  async loadData(silent = false) {
    const employee = requireSession(); if (!employee) return;
    try {
      const orders = await loadRoleOrders();
      const supervisor = employee.role === "SALES" && employee.level === "SUPERVISOR";
      const brand = employee.businessUnit === "NOERLI" ? "诺尔丽" : employee.businessUnit === "AIKEJU" ? "艾可居" : "当前品牌";
      this.setData({ employee, allOrders: orders, orders: this.filterOrders(orders, this.data.query), showSalesOwner: supervisor, scopeTitle: supervisor ? `${brand}团队订单` : employee.role === "SALES" ? "我负责的订单" : "我能查看的订单", scopeDescription: supervisor ? `共 ${orders.length} 单，可查看${brand}旗下所有销售人员的订单` : employee.role === "SALES" ? "仅显示由本人负责的订单" : "权限范围由服务端判断" });
    }
    catch (error) { if (!silent) wx.showToast({ title: error instanceof Error ? error.message : "订单加载失败", icon: "none" }); }
  },
  filterOrders(orders: MiniOrder[], text: string) {
    const query = text.trim().toLowerCase();
    return orders.filter((item) => [item.customerName, item.salesNumber, item.trackingSerial, item.salesOwnerName].some((value) => String(value ?? "").toLowerCase().includes(query)))
      .map((item): OrderCard => ({ ...item, journeyProgress: orderProgressPercent(item) }));
  },
  changeQuery(event: { detail: { value: string } }) {
    this.setData({ query: event.detail.value, orders: this.filterOrders(this.data.allOrders, event.detail.value) });
  },
  openOrder(event: { currentTarget: { dataset: { id: string } } }) { wx.navigateTo({ url: `/pages/order-detail/index?id=${event.currentTarget.dataset.id}` }); },
  openNotifications() { wx.navigateTo({ url: "/pages/notifications/index" }); },
});
