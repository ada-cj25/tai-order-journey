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
const aftersales = await import("../domain/mock-aftersales.ts");
const workspaces = await import("../domain/mock-workspaces.ts");

test("售后仅允许已验收订单，首笔费用与问题同时登记，后续费用保留作废审计", () => {
  const source = store.getOrder("TEST-DEMO-ZHOU-ORDER-001")!;
  const order = { ...source, id: "TEST-AFTERSALES-ORDER-01", trackingSerial: "TEST-AFTERSALES-ORDER-01", salesNumber: "TEST-SALES-AFTER-01", customerName: "售后测试客户", stageLabel: "验收完成", stageIndex: 9 };
  storage.set("tai-mini-local-orders", [order]);
  store.setMockSession("TEST-AFTERSALES-01");
  const employee = store.getStoredSession();
  assert.throws(() => aftersales.createMockAfterSalesCase({ ...order, stageLabel: "安装" }, employee, { issueType: "门板调整", description: "铰链异响", incurredOn: "2026-10-13", amount: 100 }), /验收/);
  assert.throws(() => aftersales.createMockAfterSalesCase(order, employee, { issueType: "门板调整", description: "铰链异响", incurredOn: "2026-10-13", amount: 0 }), /大于 0/);
  const created = aftersales.createMockAfterSalesCase(order, employee, { issueType: "门板调整", description: "铰链异响", incurredOn: "2026-10-13", amount: 100 });
  assert.match(created.caseNumber, /^TEST-SH-/);
  assert.equal(created.costBatches?.length, 1);
  assert.equal(created.costSubtotal, 100);
  assert.equal(workspaces.getMockWorkspace().tasks.some((item) => item.id === created.id && item.actionCode === "START_AFTERSALES"), true);
  aftersales.transitionMockAfterSalesCase(created.id, employee, "START");
  assert.throws(() => aftersales.transitionMockAfterSalesCase(created.id, employee, "RESOLVE", ""), /填写结果/);
  aftersales.addMockAfterSalesCostBatch(created.id, employee, { incurredOn: "2026-10-14", amount: 35.5, description: "更换铰链" });
  assert.equal(aftersales.getMockAfterSalesCases().find((item) => item.id === created.id)?.costSubtotal, 135.5);
  const latest = aftersales.getMockAfterSalesCases().find((item) => item.id === created.id)!.costBatches![0]!;
  aftersales.voidMockAfterSalesCostBatch(created.id, latest.id, employee, "重复录入");
  const afterVoid = aftersales.getMockAfterSalesCases().find((item) => item.id === created.id)!;
  assert.equal(afterVoid.costSubtotal, 100);
  assert.equal(afterVoid.costBatches![0]?.voidReason, "重复录入");
  aftersales.transitionMockAfterSalesCase(created.id, employee, "RESOLVE", "已上门调整并请客户确认");
  assert.equal(workspaces.getMockWorkspace().tasks.some((item) => item.id === created.id), false);
  store.clearSession();
  store.setMockSession("TEST-AFTERSALES-01");
  assert.equal(aftersales.getMockAfterSalesCases().find((item) => item.id === created.id)?.resolution, "已上门调整并请客户确认");
  store.setMockSession("TEST-SALES-NORLI-01");
  assert.throws(() => aftersales.addMockAfterSalesCostBatch(created.id, store.getStoredSession(), { incurredOn: "2026-10-14", amount: 1, description: "无权" }), /只有售后人员/);
});
