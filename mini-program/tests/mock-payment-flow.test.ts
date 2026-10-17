import assert from "node:assert/strict";
import test from "node:test";

const storage = new Map<string, unknown>();
let previewed = "";
(globalThis as any).wx = {
  getStorageSync: (key: string) => storage.get(key),
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key),
  getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
  previewImage: ({ current }: { current: string }) => { previewed = current; },
  showToast: () => { throw new Error("A saved receipt should be previewed"); },
};

const store = await import("../domain/store.ts");
const workspaces = await import("../domain/mock-workspaces.ts");
const mobile = await import("../services/mobile.ts");
const workspaceService = await import("../services/workspace.ts");

test("new local order moves from sales to finance to the assigned designer with two viewable receipts", async () => {
  store.setMockSession("TEST-SALES-NORLI-01");
  const order = store.createMockSalesOrder({
    businessType: "NOERLI_FORMAL", customerName: "测试流程客户", customerPhone: "10000000000", address: "测试地址",
    promisedDate: "2026-12-12", designerId: "TEST-DESIGNER-01", rush: false,
    initialPayments: {
      contractAmount: 5000,
      deposit: { amount: 500, receivedAt: "2026-10-10", account: "测试批准账户 A", receipt: { id: "deposit-file", originalName: "定金.jpg", mimeType: "image/jpeg", size: 2048, savedFilePath: "wxfile://deposit" } },
      prepayment: { amount: 1000, receivedAt: "2026-10-12", account: "测试批准账户 A", receipt: { id: "prepayment-file", originalName: "预付款.jpg", mimeType: "image/jpeg", size: 4096, savedFilePath: "wxfile://prepayment" } },
    },
  });
  assert.equal(store.getOrder(order.id)?.currentOwnerLabel, "财务部");
  assert.equal(workspaces.getMockWorkspace().tasks.some((item) => item.orderId === order.id), false);

  store.setMockSession("TEST-CHAIRMAN-01");
  const chairmanView = await mobile.loadMiniPaymentForm(order.id);
  assert.equal(chairmanView.receipts.length, 0);
  assert.deepEqual(chairmanView.facts[0]?.receiptAttachmentIds, []);
  await assert.rejects(mobile.previewMiniAttachment("deposit-file", "image/jpeg"), /无权查看/);
  store.setMockSession("TEST-SALES-NORLI-02");
  await assert.rejects(mobile.loadMiniPaymentForm(order.id), /无权查看/);

  store.clearSession();
  store.setMockSession("TEST-FINANCE-01");
  const task = workspaces.getMockWorkspace().tasks.find((item) => item.orderId === order.id);
  assert.equal(task?.actionCode, "CONFIRM_INITIAL_PAYMENTS");
  assert.equal(workspaces.getMockRoleOrders().some((item) => item.id === order.id), true);
  const payment = await mobile.loadMiniPaymentForm(order.id);
  assert.deepEqual(payment.facts.slice(0, 2).map((item) => item.amount), [500, 1000]);
  assert.equal(payment.receipts.length, 2);
  await mobile.previewMiniAttachment(payment.receipts[1]!.id, payment.receipts[1]!.mimeType);
  assert.equal(previewed, "wxfile://prepayment");

  const confirmed = await mobile.runMiniOrderCommand(order.id, "CONFIRM_INITIAL_PAYMENTS", { depositVerified: true, prepaymentVerified: true }, store.getOrder(order.id)!.updatedAt, "confirm-1");
  assert.equal(confirmed.currentOwnerLabel, "设计师郑思雁");
  assert.equal(workspaces.getMockWorkspace().tasks.some((item) => item.orderId === order.id), false);

  store.setMockSession("TEST-DESIGNER-01");
  assert.equal(workspaces.getMockWorkspace().tasks.find((item) => item.orderId === order.id)?.actionCode, "ACCEPT_DESIGN");
  const accepted = await mobile.runMiniOrderCommand(order.id, "ACCEPT_DESIGN", { designLeadDays: "3", scopeConfirmed: true }, store.getOrder(order.id)!.updatedAt, "design-1");
  assert.equal(accepted.currentOwnerLabel, "设计师郑思雁");
  assert.equal(accepted.nextAction, "设计师提交设计资料");
  assert.equal(workspaces.getMockWorkspace().tasks.find((item) => item.orderId === order.id)?.title, "正式提交设计资料");
  assert.equal(workspaces.getMockWorkspace().stats.find((item) => item.key === "delivery")?.value, 1);
  assert.equal(workspaces.getMockWorkspace().tasks.some((item) => item.id === "design-submit-1"), false);
});

test("old local order without saved payment facts stays with its sales owner", () => {
  store.setMockSession("TEST-SALES-NORLI-01");
  const order = store.createMockSalesOrder({ businessType: "NOERLI_FORMAL", customerName: "旧单客户", customerPhone: "10000000000", address: "测试地址", promisedDate: "2026-12-12", designerId: "TEST-DESIGNER-01", rush: false });
  assert.equal(store.getOrder(order.id)?.currentOwnerLabel, "销售郑佳");
  assert.equal(workspaces.getMockWorkspace().tasks.find((item) => item.orderId === order.id)?.actionCode, "REPORT_INITIAL_PAYMENT");
  store.setMockSession("TEST-FINANCE-01");
  assert.equal(workspaces.getMockWorkspace().tasks.some((item) => item.orderId === order.id), false);
});

test("design transfer moves the order and pending task, preserves the intake deadline, and mobile submission advances to admin", async () => {
  store.setMockSession("TEST-SALES-NORLI-01");
  const order = store.createMockSalesOrder({
    businessType: "NOERLI_FORMAL", customerName: "小冉酱流程", customerPhone: "10000000000", address: "测试地址", promisedDate: "2026-12-12", designerId: "TEST-DESIGNER-01", rush: false,
    initialPayments: {
      contractAmount: 8000,
      deposit: { amount: 500, receivedAt: "2026-10-10", account: "测试批准账户 A", receipt: { id: "design-deposit", originalName: "定金.jpg", mimeType: "image/jpeg", size: 100, savedFilePath: "wxfile://deposit" } },
      prepayment: { amount: 1000, receivedAt: "2026-10-12", account: "测试批准账户 A", receipt: { id: "design-prepay", originalName: "预付款.jpg", mimeType: "image/jpeg", size: 100, savedFilePath: "wxfile://prepay" } },
    },
  });
  store.setMockSession("TEST-FINANCE-01");
  await mobile.runMiniOrderCommand(order.id, "CONFIRM_INITIAL_PAYMENTS", { depositVerified: true, prepaymentVerified: true }, store.getOrder(order.id)!.updatedAt, "verify-transfer");
  store.setMockSession("TEST-DESIGNER-01");
  await mobile.runMiniOrderCommand(order.id, "ACCEPT_DESIGN", { designLeadDays: 3, scopeConfirmed: true }, store.getOrder(order.id)!.updatedAt, "accept-transfer");
  const before = store.getMockPaymentState(order.id)!;
  await assert.rejects(mobile.runMiniOrderCommand(order.id, "TRANSFER_DESIGN", { designerId: "TEST-DESIGNER-01", reason: "更换负责人" }, store.getOrder(order.id)!.updatedAt, "invalid-transfer"), /另一名设计师/);
  const transferred = await mobile.runMiniOrderCommand(order.id, "TRANSFER_DESIGN", { designerId: "TEST-DESIGNER-02", reason: "由林设计师接续" }, store.getOrder(order.id)!.updatedAt, "transfer-ok");
  assert.equal(transferred.designerOwnerId, "TEST-DESIGNER-02");
  assert.equal(transferred.currentOwnerLabel, "设计师林若溪");
  assert.equal(store.getMockPaymentState(order.id)?.designDueAt, before.designDueAt);
  assert.equal(workspaces.getMockWorkspace().tasks.some((item) => item.orderId === order.id), false);
  store.setMockSession("TEST-DESIGNER-02");
  assert.equal(workspaces.getMockWorkspace().tasks.find((item) => item.orderId === order.id)?.actionCode, "SUBMIT_DESIGN");
  assert.equal(workspaces.getMockWorkspace().stats.find((item) => item.key === "delivery")?.value, 1);
  const draft = { designVersion: "V1", surveyedAt: "2026-10-12", customerConfirmedAt: "2026-10-12", spaces: "主卧", materials: "橡木色", sampleBlockRemark: "", cadAttachmentIds: ["cad-1"], confirmationAttachmentIds: ["confirm-1"], sampleBlockAttachmentIds: [] };
  const files = [
    { id: "cad-1", category: "DESIGN_CAD", originalName: "设计.pdf", mimeType: "application/pdf", size: 100, savedFilePath: "wxfile://cad" },
    { id: "confirm-1", category: "DESIGN_CONFIRMATION", originalName: "确认图.jpg", mimeType: "image/jpeg", size: 100, savedFilePath: "wxfile://confirm" },
  ];
  await mobile.saveMiniDesignDraft(order.id, draft, files, store.getOrder(order.id)!.updatedAt, "save-design");
  store.clearSession();
  store.setMockSession("TEST-DESIGNER-02");
  assert.equal((await mobile.loadMiniDesignDraft(order.id)).files.length, 2);
  assert.equal(store.getOrder(order.id)?.stageLabel, "设计交付");
  const submitted = await mobile.runMiniOrderCommand(order.id, "SUBMIT_DESIGN", draft, store.getOrder(order.id)!.updatedAt, "submit-design");
  assert.equal(submitted.stageLabel, "审单拆单");
  assert.equal(submitted.currentOwnerLabel, "订单管理员");
  assert.match(submitted.salesNumber ?? "", /^TEST-N\d{8}$/);
  assert.equal(store.getOrder(order.id)?.salesNumber, submitted.salesNumber);
  assert.equal(workspaces.getMockWorkspace().tasks.some((item) => item.orderId === order.id), false);
  await assert.rejects(mobile.advanceMockPreReview(order.id), /订单管理员/);
  store.setMockSession("TEST-ORDER-ADMIN-01");
  assert.equal(workspaces.getMockWorkspace().tasks.find((item) => item.orderId === order.id)?.title, "前置审单");
  const afterReview = await mobile.advanceMockPreReview(order.id);
  assert.equal(afterReview.stageLabel, "技术拆单");
  assert.equal(afterReview.currentOwnerLabel, "技术部");
  await assert.rejects(mobile.advanceMockPreReview(order.id), /已经模拟通过/);
  assert.equal(workspaces.getMockWorkspace().tasks.some((item) => item.orderId === order.id), false);
  store.clearSession();
  store.setMockSession("TEST-TECHNICAL-01");
  assert.equal(workspaces.getMockWorkspace().tasks.find((item) => item.orderId === order.id)?.type, "TECHNICAL_DESKTOP");
  assert.equal(store.getOrder(order.id)?.stageLabel, "技术拆单");
  await assert.rejects(mobile.advanceMockPreReview(order.id), /订单管理员/);
});

test("mock notification reads survive navigation and account switching, and workspace badge follows unread count", async () => {
  store.setMockSession("TEST-DESIGNER-01");
  assert.equal((await workspaceService.loadNotifications()).filter((item) => !item.read).length, 2);
  assert.equal((await workspaceService.loadRoleWorkspace()).unreadCount, 2);
  await workspaceService.markNotificationRead("notice-1");
  assert.equal((await workspaceService.loadNotifications()).find((item) => item.id === "notice-1")?.read, true);
  assert.equal((await workspaceService.loadRoleWorkspace()).unreadCount, 1);
  store.clearSession();
  store.setMockSession("TEST-DESIGNER-01");
  assert.equal((await workspaceService.loadRoleWorkspace()).unreadCount, 1);
  await workspaceService.markNotificationRead("notice-2");
  assert.equal((await workspaceService.loadRoleWorkspace()).unreadCount, 0);
  store.setMockSession("TEST-DESIGNER-02");
  assert.equal((await workspaceService.loadRoleWorkspace()).unreadCount, 2);
});
