import assert from "node:assert/strict";
import test from "node:test";

const storage = new Map<string, unknown>();
let registeredPage: Record<string, any> | undefined;
let navigationUrl = "";

(globalThis as any).wx = {
  getStorageSync: (key: string) => storage.get(key),
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key),
  getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
  getSystemInfoSync: () => ({ platform: "ios" }),
  showToast: () => undefined,
  navigateTo: ({ url }: { url: string }) => { navigationUrl = url; },
  navigateBack: () => undefined,
  reLaunch: () => undefined,
};
(globalThis as any).Page = (definition: Record<string, any>) => { registeredPage = definition; };

const store = await import("../domain/store.ts");
await import("../pages/tracking/index.ts");
const trackingPage = registeredPage!;
await import("../pages/package-count/index.ts");
const packagePage = registeredPage!;

test("tapping an assembly hardware action opens its source with a confirm button", async () => {
  store.setMockSession("TEST-W004");
  const order = store.getOrders().find((item) => item.stageIndex >= 6 && item.stageIndex <= 8 && item.productionAreas.length > 0)!;
  assert.ok(order);
  const area = order.productionAreas[0];
  storage.set(`tai-mini-hardware:${order.id}`, { [area.id]: 2 });
  const source = store.getMockPackageSummary(order.id).sources.find((item) => item.productionAreaId === area.id && item.kind === "HARDWARE_AREA")!;
  assert.ok(source.canConfirmHandoff);

  trackingPage.openPackageAction({ currentTarget: { dataset: { orderId: order.id, areaId: area.id, sourceKey: source.sourceKey } } });
  assert.ok(navigationUrl.startsWith("/pages/package-count/index?"));
  const rawQuery = Object.fromEntries(navigationUrl.split("?")[1].split("&").map((pair: string) => pair.split("=")));
  assert.equal(rawQuery.sourceKey, encodeURIComponent(source.sourceKey));
  assert.equal(rawQuery.areaId, encodeURIComponent(area.id));
  const page = { ...packagePage, data: { ...packagePage.data }, setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); } };
  page.onLoad(rawQuery);
  await page.loadData();

  assert.ok(page.data.summary.sources.some((item: { sourceKey: string }) => item.sourceKey === source.sourceKey));
  assert.equal(page.data.sources.length, 1);
  assert.equal(page.data.sources[0].sourceKey, source.sourceKey);
  assert.equal(page.data.sources[0].canConfirm, true);
  assert.ok(page.data.order, "assembly user can load the selected order before submitting");

  const missingSourcePage = { ...packagePage, data: { ...packagePage.data }, setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); } };
  missingSourcePage.onLoad({ orderId: order.id, areaId: area.id, sourceKey: "undefined" });
  await missingSourcePage.loadData();
  assert.ok(missingSourcePage.data.sources.some((item: { sourceKey: string }) => item.sourceKey === source.sourceKey));
});
