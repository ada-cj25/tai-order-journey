import assert from "node:assert/strict";
import test from "node:test";

const saved = new Map<string, unknown>();
(globalThis as any).wx = {
  getStorageSync: (key: string) => saved.get(key),
  setStorageSync: (key: string, value: unknown) => saved.set(key, value),
};

const { getOrder } = await import("../domain/store.ts");
const { mockShipmentQueueItem, recordMockShipment } = await import("../domain/mock-shipment.ts");

test("本机发货车次按订单保存，末批后进入历史且不影响另一订单", () => {
  const order = getOrder("TEST-DEMO-ZHOU-ORDER-001");
  const other = getOrder("TEST-DEMO-LIN-ORDER-002");
  assert.ok(order && other);
  const previousOther = mockShipmentQueueItem(other);
  const before = mockShipmentQueueItem(order);
  assert.equal(before?.readyRoutes, 2);
  assert.equal(before?.readyOutsource, 1);

  recordMockShipment(order, { routes: [{ id: "route-child-panel", areaName: "儿童房", productionNumber: "TEST-DEMO-AREA-01", isFinalBatch: true }], outsourceIds: [], vehicle: "沪A001",
    installerId: "TEST-INSTALLER-01", installationTeamLabel: "安装一组", contact: "周女士", plannedAt: "2026-10-15", siteConditions: "可以进场" });
  const after = mockShipmentQueueItem(getOrder(order.id)!);
  assert.equal(after?.readyRoutes, 1);
  assert.equal(after?.shipmentCount, 1);
  assert.equal(after?.records[0]?.vehicle, "沪A001");
  assert.deepEqual(mockShipmentQueueItem(other), previousOther);
  assert.throws(() => recordMockShipment(order, { routes: [{ id: "route-child-panel", areaName: "儿童房", productionNumber: "TEST-DEMO-AREA-01", isFinalBatch: true }], outsourceIds: [], vehicle: "沪A002",
    installerId: "TEST-INSTALLER-01", installationTeamLabel: "安装一组", contact: "周女士", plannedAt: "2026-10-15", siteConditions: "可以进场" }), /发货内容已变化/);
});
