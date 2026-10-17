import assert from "node:assert/strict";
import test from "node:test";

const saved = new Map<string, unknown>();
(globalThis as any).wx = {
  getStorageSync: (key: string) => saved.get(key),
  setStorageSync: (key: string, value: unknown) => saved.set(key, value),
};

const { getOrder, mockEmployees, saveSession } = await import("../domain/store.ts");
const { getMockWorkspace } = await import("../domain/mock-workspaces.ts");
const { recordMockShipment } = await import("../domain/mock-shipment.ts");

test("登记车次后对应安装人员收到该订单车次待办", () => {
  const order = getOrder("TEST-DEMO-ZHOU-ORDER-001");
  assert.ok(order);
  recordMockShipment(order, {
    routes: [{ id: "route-child-panel", areaName: "儿童房", productionNumber: "TEST-DEMO-AREA-01", isFinalBatch: true }],
    outsourceIds: [], vehicle: "沪A001", installerId: "TEST-INSTALLER-01", installationTeamLabel: "安装一组",
    contact: "周女士", plannedAt: "2026-10-15", siteConditions: "可以进场",
  });
  saveSession(mockEmployees.find((item) => item.id === "TEST-INSTALLER-01")!);
  const task = getMockWorkspace().tasks.find((item) => item.type === "INSTALLATION" && item.orderId === order.id && item.meta?.vehicle === "沪A001");
  assert.ok(task);
  assert.match(task.actionRoute ?? "", /orderId=TEST-DEMO-ZHOU-ORDER-001.*shipmentId=mock-shipment-/);
});
