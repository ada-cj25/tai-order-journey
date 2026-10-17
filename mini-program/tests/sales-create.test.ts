import assert from "node:assert/strict";
import test from "node:test";

const storage = new Map<string, unknown>();
let modalContent = "";
let redirectedTo = "";
let definition: Record<string, any> | undefined;
(globalThis as any).wx = {
  getStorageSync: (key: string) => storage.get(key),
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key),
  getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
  showToast: ({ title }: { title: string }) => { throw new Error(`Unexpected toast: ${title}`); },
  showModal: ({ content, success }: { content: string; success?: () => void }) => { modalContent = content; success?.(); },
  redirectTo: ({ url }: { url: string }) => { redirectedTo = url; },
  saveFile: ({ tempFilePath, success }: { tempFilePath: string; success: (result: { savedFilePath: string }) => void }) => success({ savedFilePath: `wxfile://${tempFilePath}` }),
};
(globalThis as any).Page = (options: Record<string, any>) => { definition = options; };

const store = await import("../domain/store.ts");
await import("../pages/sales-create/index.ts");

test("sales page mock submit saves a visible local order and opens its detail", async () => {
  store.setMockSession("TEST-SALES-NORLI-01");
  assert.ok(definition);
  const page = {
    ...definition,
    data: { ...definition.data },
    setData(update: Record<string, unknown>) { Object.assign(this.data, update); },
  };
  await page.onLoad();
  assert.deepEqual(page.data.orderTypes, ["诺尔丽正单", "诺尔丽补单"]);
  page.setData({
    customerName: "测试销售客户", customerPhone: "10000000000", address: "测试地址", contractAmount: "5000",
    signedDate: "2026-10-12", depositAmount: "500", depositReceivedDate: "2026-10-10", depositReceiptPath: "mock-deposit.jpg",
    prepaymentAmount: "1000", prepaymentReceivedDate: "2026-10-12", prepaymentReceiptPath: "mock-prepayment.jpg", promisedDate: "2026-12-12",
  });
  await page.submit();
  const saved = store.getOrders().find((order) => order.customerName === "测试销售客户");
  assert.ok(saved);
  assert.match(modalContent, /仅保存在本机/);
  assert.equal(redirectedTo, `/pages/order-detail/index?id=${saved.id}`);
  assert.equal(page.data.submitting, false);
});

test("sales page creates a supplement linked to a visible formal order", async () => {
  store.setMockSession("TEST-SALES-NORLI-01");
  assert.ok(definition);
  const page = {
    ...definition,
    data: { ...definition.data },
    setData(update: Record<string, unknown>) { Object.assign(this.data, update); },
  };
  await page.onLoad();
  page.changeOrderType({ detail: { value: "1" } });
  const parentOrderIndex = page.data.parentOrders.findIndex((item: { customerName: string }) => item.customerName === "测试销售客户");
  assert.ok(parentOrderIndex >= 0);
  await page.selectParent(parentOrderIndex);
  page.setData({ contractAmount: "0", signedDate: "2026-10-12", promisedDate: "2026-12-20", supplementReason: "客户新增柜体" });
  await page.submit();
  const supplement = store.getOrders().find((order) => order.businessType === "NOERLI_SUPPLEMENT" && order.customerName === "测试销售客户");
  assert.ok(supplement);
  assert.equal(supplement.parentOrderId, page.data.parentOrders[parentOrderIndex].id);
  assert.equal(redirectedTo, `/pages/order-detail/index?id=${supplement.id}`);
});

test("old mock order can re-report both payments without creating another order", async () => {
  store.setMockSession("TEST-SALES-NORLI-01");
  const existing = store.createMockSalesOrder({ businessType: "NOERLI_FORMAL", customerName: "旧版小程序订单", customerPhone: "10000000000", address: "测试地址", promisedDate: "2026-12-12", designerId: "TEST-DESIGNER-01", rush: false });
  assert.ok(definition);
  const page = { ...definition, data: { ...definition.data }, setData(update: Record<string, unknown>) { Object.assign(this.data, update); } };
  await page.onLoad({ orderId: existing.id });
  assert.equal(page.data.reReport, true);
  page.setData({ contractAmount: "5000", depositAmount: "500", depositReceivedDate: "2026-10-10", depositReceiptPath: "deposit.jpg", prepaymentAmount: "1000", prepaymentReceivedDate: "2026-10-12", prepaymentReceiptPath: "prepayment.jpg" });
  await page.submit();
  assert.equal(store.getOrders().filter((item) => item.id === existing.id).length, 1);
  assert.equal(store.getOrder(existing.id)?.currentOwnerLabel, "财务部");
  assert.equal(redirectedTo, `/pages/order-detail/index?id=${existing.id}`);
});
