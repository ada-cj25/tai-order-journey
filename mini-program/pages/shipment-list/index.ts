import { requireRole } from "../../domain/roles";
import { filterShipmentQueue, shipmentQueueState, type MiniShipmentQueueItem, type ShipmentQueueFilter } from "../../domain/shipment-queue";
import { loadMiniShipmentQueue } from "../../services/mobile";

type QueueCard = MiniShipmentQueueItem & { statusLabel: string; details: string; actionLabel: string; destination: string; lastShipmentLabel: string; displayRecords: Array<{ id: string; vehicle: string; dateLabel: string; summary: string }> };

function card(item: MiniShipmentQueueItem, filter: ShipmentQueueFilter): QueueCard {
  const state = shipmentQueueState(item);
  const history = filter === "history";
  const description = item.readyLabels.join("、");
  return {
    ...item,
    statusLabel: history ? "已发货" : state === "READY" ? "可发货" : "待核验尾款",
    details: history ? `已登记 ${item.shipmentCount} 车次` : `${item.readyRoutes} 条生产路线 · ${item.readyOutsource} 项外购产品${description ? `\n${description}` : ""}`,
    actionLabel: history ? "查看订单" : state === "READY" ? "登记发货" : "查看订单",
    destination: history || state !== "READY" ? `/pages/order-detail/index?id=${encodeURIComponent(item.orderId)}` : `/pages/shipment/index?orderId=${encodeURIComponent(item.orderId)}`,
    lastShipmentLabel: item.lastShipmentAt ? String(item.lastShipmentAt).slice(0, 10) : "",
    displayRecords: history ? item.records.map((record) => ({ id: record.id, vehicle: record.vehicle, dateLabel: String(record.deliveredAt).slice(0, 10), summary: record.summary })) : [],
  };
}

Page({
  data: {
    filter: "ready" as ShipmentQueueFilter, query: "", items: [] as MiniShipmentQueueItem[], cards: [] as QueueCard[],
    counts: { ready: 0, tail: 0, history: 0 }, loading: true, error: "",
  },
  onShow() { if (requireRole(["ORDER_ADMIN"])) void this.loadData(); },
  onPullDownRefresh() { this.loadData().finally(() => wx.stopPullDownRefresh()); },
  async loadData() {
    this.setData({ loading: true, error: "" });
    try {
      const items = await loadMiniShipmentQueue();
      const counts = { ready: filterShipmentQueue(items, "ready", "").length, tail: filterShipmentQueue(items, "tail", "").length, history: filterShipmentQueue(items, "history", "").length };
      this.setData({ items, counts, loading: false, cards: filterShipmentQueue(items, this.data.filter, this.data.query).map((item) => card(item, this.data.filter)) });
    } catch (error) {
      this.setData({ loading: false, error: error instanceof Error ? error.message : "发货订单加载失败" });
    }
  },
  changeFilter(event: { currentTarget: { dataset: { filter: ShipmentQueueFilter } } }) {
    const filter = event.currentTarget.dataset.filter;
    this.setData({ filter, cards: filterShipmentQueue(this.data.items, filter, this.data.query).map((item) => card(item, filter)) });
  },
  changeQuery(event: { detail: { value: string } }) {
    const query = event.detail.value;
    this.setData({ query, cards: filterShipmentQueue(this.data.items, this.data.filter, query).map((item) => card(item, this.data.filter)) });
  },
  openOrder(event: { currentTarget: { dataset: { url: string } } }) {
    wx.navigateTo({ url: event.currentTarget.dataset.url });
  },
});
