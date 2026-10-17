import assert from "node:assert/strict";
import test from "node:test";

const storage = new Map<string, unknown>();
(globalThis as any).wx = {
  getStorageSync: (key: string) => storage.get(key),
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key),
  getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
};

const store = await import("../domain/store.ts");
const mobile = await import("../services/mobile.ts");
const workspaces = await import("../domain/mock-workspaces.ts");

test("order administrator sees cumulative outsourced arrivals and procurement sees the same hardware totals", async () => {
  store.setMockSession("TEST-ORDER-ADMIN-01");
  const before = await mobile.loadMiniSupplySummary("TEST-DEMO-LIN-ORDER-002");
  assert.equal(before.outsourceLines[0]?.arrivedQty, 1);
  assert.equal(before.outsourceLines[0]?.remainingQty, 1);
  const arrivalTask = workspaces.getMockWorkspace().tasks.find((item) => item.orderId === before.order.id && item.type === "OUTSOURCE_ARRIVAL");
  assert.equal(arrivalTask?.actionRoute, `/pages/supply/index?orderId=${before.order.id}`);
  const pendingBefore = workspaces.getMockWorkspace().stats.find((item) => item.key === "arrival")?.value;
  assert.ok(pendingBefore && pendingBefore > 0);
  const after = await mobile.recordMiniOutsourceArrival(before.order.id, before.outsourceLines[0]!.id, 1, "2026-10-12", before.order.updatedAt);
  assert.equal(after.outsourceLines[0]?.arrivedQty, 2);
  assert.equal(after.outsourceLines[0]?.remainingQty, 0);
  assert.equal(after.outsourceReady, 1);
  assert.equal(workspaces.getMockWorkspace().tasks.some((item) => item.orderId === before.order.id && item.type === "OUTSOURCE_ARRIVAL"), false);
  assert.equal(workspaces.getMockWorkspace().stats.find((item) => item.key === "arrival")?.value, pendingBefore - 1);
  await assert.rejects(() => mobile.recordMiniOutsourceArrival(before.order.id, before.outsourceLines[0]!.id, 1, "2026-10-12", after.order.updatedAt), /数量或日期无效/);
  store.setMockSession("TEST-PROCUREMENT-01");
  const procurement = await mobile.loadMiniSupplySummary(before.order.id);
  assert.equal(procurement.outsourceLines[0]?.arrivedQty, 2);
  assert.equal(procurement.hardwareTotal, procurement.hardwareAreas.reduce((sum, area) => sum + area.total, 0));
  assert.equal(procurement.packageTotal, procurement.hardwareTotal + procurement.manufacturedTotal + procurement.outsourcedPackageTotal);
  assert.ok(procurement.packageSources.every((source) => source.kind !== "HARDWARE_AREA"));
  await assert.rejects(() => mobile.recordMiniOutsourceArrival(before.order.id, before.outsourceLines[0]!.id, 1, "2026-10-12", procurement.order.updatedAt), /只有订单管理员/);
});

test("发货示例里的未到智能镜也进入订单管理员待办，登记齐套后消失", async () => {
  store.setMockSession("TEST-ORDER-ADMIN-01");
  const before = await mobile.loadMiniSupplySummary("TEST-DEMO-ZHOU-ORDER-001");
  assert.equal(before.outsourceLines.length, 2);
  assert.equal(before.outsourcePending, 1);
  assert.equal(workspaces.getMockWorkspace().tasks.filter((item) => item.orderId === before.order.id && item.type === "OUTSOURCE_ARRIVAL").length, 1);

  const mirror = before.outsourceLines.find((line) => line.name === "智能镜")!;
  await mobile.recordMiniOutsourceArrival(before.order.id, mirror.id, 1, "2026-10-12", before.order.updatedAt);
  assert.equal((await mobile.loadMiniSupplySummary(before.order.id)).outsourcePending, 0);
  assert.equal(workspaces.getMockWorkspace().tasks.some((item) => item.orderId === before.order.id && item.type === "OUTSOURCE_ARRIVAL"), false);
});
