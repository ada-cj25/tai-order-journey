import assert from "node:assert/strict";
import test from "node:test";
import { filterShipmentQueue, shipmentQueueState, type MiniShipmentQueueItem } from "../domain/shipment-queue.ts";

function item(overrides: Partial<MiniShipmentQueueItem>): MiniShipmentQueueItem {
  return { orderId: "order-1", customerName: "小冉酱", salesNumber: "N26100001", trackingSerial: "GD-001", tailPaymentConfirmed: true,
    readyRoutes: 1, readyOutsource: 0, readyLabels: ["主卧·板式路线"], shipmentCount: 0, lastShipmentAt: null, records: [], ...overrides };
}

test("同一客户的订单按订单身份筛选，已完工路线无需等待整单生产完成", () => {
  const ready = item({ orderId: "order-ready" });
  const waiting = item({ orderId: "order-waiting", salesNumber: "N26100002", tailPaymentConfirmed: false, readyRoutes: 0, readyOutsource: 1 });
  const pending = item({ orderId: "order-pending", salesNumber: "N26100003", readyRoutes: 0 });
  assert.equal(shipmentQueueState(ready), "READY");
  assert.equal(shipmentQueueState(waiting), "WAITING_TAIL");
  assert.equal(shipmentQueueState(pending), "HIDDEN");
  assert.deepEqual(filterShipmentQueue([ready, waiting, pending], "ready", "N26100001"), [ready]);
  assert.deepEqual(filterShipmentQueue([ready, waiting, pending], "tail", "小冉酱"), [waiting]);
});

test("已经发过一批的订单仍可继续发货，也保留在发货记录", () => {
  const partial = item({ shipmentCount: 1, records: [{ id: "shipment-1", vehicle: "沪A001", deliveredAt: "2026-10-13", summary: "主卧" }] });
  const finished = item({ orderId: "order-finished", readyRoutes: 0, shipmentCount: 2 });
  assert.deepEqual(filterShipmentQueue([partial, finished], "ready", ""), [partial]);
  assert.deepEqual(filterShipmentQueue([partial, finished], "history", ""), [partial, finished]);
});
