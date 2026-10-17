export interface MiniShipmentQueueItem {
  orderId: string;
  customerName: string;
  salesNumber: string | null;
  trackingSerial: string;
  tailPaymentConfirmed: boolean;
  readyRoutes: number;
  readyOutsource: number;
  readyLabels: string[];
  shipmentCount: number;
  lastShipmentAt: string | null;
  records: Array<{ id: string; vehicle: string; deliveredAt: string; summary: string }>;
}

export type ShipmentQueueFilter = "ready" | "tail" | "history";

export function shipmentQueueState(item: MiniShipmentQueueItem): "READY" | "WAITING_TAIL" | "SHIPPED" | "HIDDEN" {
  const hasReadySource = item.readyRoutes + item.readyOutsource > 0;
  if (hasReadySource) return item.tailPaymentConfirmed ? "READY" : "WAITING_TAIL";
  return item.shipmentCount > 0 ? "SHIPPED" : "HIDDEN";
}

export function filterShipmentQueue(items: MiniShipmentQueueItem[], filter: ShipmentQueueFilter, search: string): MiniShipmentQueueItem[] {
  const query = search.trim().toLowerCase();
  return items.filter((item) => {
    const state = shipmentQueueState(item);
    if (filter === "ready" && state !== "READY") return false;
    if (filter === "tail" && state !== "WAITING_TAIL") return false;
    if (filter === "history" && item.shipmentCount === 0) return false;
    return !query || [item.customerName, item.salesNumber, item.trackingSerial].some((value) => String(value ?? "").toLowerCase().includes(query));
  });
}
