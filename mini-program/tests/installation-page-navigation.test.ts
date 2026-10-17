import assert from "node:assert/strict";
import test from "node:test";

const saved = new Map<string, unknown>();
let redirected = "";
let page: Record<string, any> | undefined;
(globalThis as any).wx = {
  getSystemInfoSync: () => ({ platform: "devtools" }),
  getStorageSync: (key: string) => saved.get(key),
  setStorageSync: (key: string, value: unknown) => saved.set(key, value),
  redirectTo: ({ url }: { url: string }) => { redirected = url; },
  showToast: () => {},
};
(globalThis as any).Page = (definition: Record<string, any>) => { page = definition; };

const { saveSession, mockEmployees } = await import("../domain/store.ts");
await import("../pages/installation/index.ts");

test("安装底部入口先选车次，安装表单按订单和车次加载", async () => {
  assert.ok(page);
  saveSession(mockEmployees.find((employee) => employee.id === "TEST-INSTALLER-01")!);
  const context = { data: { ...page.data }, setData(values: Record<string, unknown>) { Object.assign(this.data, values); } };
  await page.onLoad.call(context, {});
  assert.equal(redirected, "/pages/installation-list/index");
  saved.set("tai-mini-shipment-state:TEST-DEMO-ZHOU-ORDER-001", {
    routeBatches: {}, shippedOutsourceIds: [], installationReports: [],
    shipments: [{ id: "shipment-test-1", vehicle: "沪A123", deliveredAt: "2026-10-13", assignedInstallerId: "TEST-INSTALLER-01",
      installationTeamLabel: "安装一组", siteContact: "周女士", plannedInstallationAt: "2026-10-15", siteConditions: "可进场", installedAt: null,
      areas: [{ areaName: "儿童房", productionNumber: "TEST-DEMO-AREA-01", sequence: 1, isFinalBatch: true }] }],
  });
  redirected = "";
  await page.onLoad.call(context, { orderId: "TEST-DEMO-ZHOU-ORDER-001", shipmentId: "shipment-test-1" });
  assert.equal(redirected, "");
  assert.equal(context.data.order?.customerName, "周女士");
  assert.equal(context.data.task.vehicle, "沪A123");
  assert.equal(context.data.shipmentId, "shipment-test-1");
});
