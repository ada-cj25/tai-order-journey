import assert from "node:assert/strict";
import test from "node:test";

const storage = new Map<string, unknown>();
(globalThis as typeof globalThis & { wx: unknown }).wx = {
  getStorageSync: (key: string) => storage.get(key),
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key),
  getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
};

const store = await import("../domain/store.ts");

test("mock worker sees two customers, six unfinished areas and four actionable drills", () => {
  store.initializeMockSession();
  const workbench = store.getMockWorkshopWorkbench();
  assert.deepEqual(workbench.summary, { allUnfinished: 6, actionable: 4, waiting: 2, issue: 0, completedToday: 0 });
  assert.deepEqual(new Set(workbench.allUnfinished.map((task) => task.customerName)), new Set(["周女士", "林先生"]));
  assert.equal(workbench.actionable.every((task) => task.title === "打孔" && task.canReport), true);
});

test("complete reporting is idempotent and immediately removes the process from actionable work", () => {
  const task = store.getMockWorkshopWorkbench().actionable.find((item) => item.productionNumber === "TEST-DEMO-AREA-01");
  assert.ok(task?.processId);
  const report = {
    orderId: task.orderId,
    processId: task.processId,
    action: "COMPLETE" as const,
    completedQty: task.plannedQty,
    idempotencyKey: "same-report-attempt",
    expectedUpdatedAt: task.orderUpdatedAt,
  };
  const first = store.submitProductionReport(report);
  const replay = store.submitProductionReport(report);
  assert.equal(first.status, "DONE");
  assert.deepEqual(replay, first);
  const refreshed = store.getMockWorkshopWorkbench();
  assert.equal(refreshed.actionable.some((item) => item.id === task.id), false);
  assert.equal(refreshed.completedToday.some((item) => item.id === task.id), true);
});

test("scan resolution distinguishes actionable, waiting and invalid production numbers", () => {
  assert.equal(store.resolveMockProductionNumber("TEST-DEMO-AREA-04").status, "DIRECT");
  assert.equal(store.resolveMockProductionNumber("TEST-DEMO-AREA-02").status, "WAITING");
  assert.equal(store.resolveMockProductionNumber("UNKNOWN").status, "INVALID");
});

test("sales representatives see only their orders while brand supervisors see the whole brand", async () => {
  const workspaces = await import("../domain/mock-workspaces.ts");
  store.setMockSession("TEST-SALES-NORLI-01");
  const representativeOrders = workspaces.getMockRoleOrders();
  assert.ok(representativeOrders.length > 0);
  assert.equal(representativeOrders.every((order) => order.salesOwnerId === "TEST-SALES-NORLI-01"), true);

  store.setMockSession("TEST-SALES-NORLI-MANAGER");
  const noerliOrders = workspaces.getMockRoleOrders();
  assert.equal(noerliOrders.every((order) => order.businessUnit === "NOERLI"), true);
  assert.ok(new Set(noerliOrders.map((order) => order.salesOwnerId)).size > 1);

  store.setMockSession("TEST-SALES-AIKEJU-MANAGER");
  const aikejuOrders = workspaces.getMockRoleOrders();
  assert.equal(aikejuOrders.length, 2);
  assert.equal(aikejuOrders.every((order) => order.businessUnit === "AIKEJU"), true);
  assert.equal(aikejuOrders.some((order) => order.businessUnit === "NOERLI"), false);
});

test("all active mobile roles have a four-entry role workspace and non-workshop mock dashboard", async () => {
  const workspaces = await import("../domain/mock-workspaces.ts");
  const roles = await import("../domain/roles.ts");
  for (const employee of store.mockEmployees) {
    store.setMockSession(employee.id);
    const config = roles.roleWorkspace(employee.role, employee.level);
    assert.equal(config.navigationItems.length, 4, employee.roleLabel);
    assert.ok(config.allowedPages.includes("profile"), employee.roleLabel);
    if (employee.role !== "WORKSHOP") {
      const workspace = workspaces.getMockWorkspace();
      assert.equal(workspace.employee.id, employee.id);
      assert.ok(workspace.title.length > 0);
    }
  }
  assert.equal(roles.roleWorkspace("WORKSHOP", "SUPERVISOR").supportedTaskTypes.includes("WORKSHOP_SUPERVISOR"), true);
});

test("preloaded sample orders do not create false finance tasks or confirm payments", async () => {
  const workspaces = await import("../domain/mock-workspaces.ts");
  const mobile = await import("../services/mobile.ts");
  store.setMockSession("TEST-FINANCE-01");
  const task = workspaces.getMockWorkspace().tasks.find((item) => item.orderId === "TEST-DEMO-AIKEJU-002" || item.orderId === "TEST-DEMO-MINI-001");
  assert.equal(task, undefined);
  await assert.rejects(mobile.runMiniOrderCommand("TEST-DEMO-AIKEJU-002", "CONFIRM_INITIAL_PAYMENTS", { depositVerified: true, prepaymentVerified: true }, "", "mock-command-idempotency"), /没有可核验的付款事实/);
});

test("local login selection and logout clear the active identity", () => {
  const employee = store.setMockSession("TEST-SALES-AIKEJU-MANAGER");
  storage.set("tai-mini-sales-draft", { customerName: "测试草稿" });
  assert.equal(store.getStoredSession()?.id, employee.id);
  store.clearSession();
  assert.equal(store.getStoredSession(), null);
  assert.equal(storage.has("tai-mini-sales-draft"), false);
});

test("mock sales order remains visible after account switching, with brand scope and linked supplement", async () => {
  const workspaces = await import("../domain/mock-workspaces.ts");
  const mobile = await import("../services/mobile.ts");
  store.setMockSession("TEST-SALES-NORLI-01");
  assert.deepEqual((await mobile.loadMiniReferenceData()).businessTypes, ["NOERLI_FORMAL", "NOERLI_SUPPLEMENT"]);
  const created = store.createMockSalesOrder({ businessType: "NOERLI_FORMAL", customerName: "测试新客户", customerPhone: "10000000000", address: "测试地址", promisedDate: "2026-12-12", designerId: "TEST-DESIGNER-01", rush: false });
  assert.equal(workspaces.getMockRoleOrders().some((order) => order.id === created.id), true);
  store.clearSession();
  store.setMockSession("TEST-SALES-NORLI-MANAGER");
  assert.equal(workspaces.getMockRoleOrders().some((order) => order.id === created.id), true);
  store.setMockSession("TEST-FINANCE-01");
  assert.equal(workspaces.getMockRoleOrders().some((order) => order.id === created.id), true);
  store.setMockSession("TEST-SALES-AIKEJU-01");
  assert.equal(workspaces.getMockRoleOrders().some((order) => order.id === created.id), false);
  assert.equal(await mobile.loadRoleOrder(created.id), undefined);
  assert.deepEqual((await mobile.loadMiniReferenceData()).businessTypes, ["AIKEJU_FORMAL", "AIKEJU_SUPPLEMENT"]);
  store.setMockSession("TEST-SALES-NORLI-01");
  const supplement = store.createMockSalesOrder({ businessType: "NOERLI_SUPPLEMENT", parentOrderId: created.id, customerName: "", customerPhone: "", address: "", promisedDate: "2026-12-20", designerId: "TEST-DESIGNER-01", rush: false });
  assert.equal(supplement.parentOrderId, created.id);
  assert.equal(supplement.customerName, created.customerName);
  assert.equal(workspaces.getMockRoleOrders().some((order) => order.id === supplement.id), true);
});

test("mock order missing payment facts stays in its owner's current tasks for re-reporting", async () => {
  const workspaces = await import("../domain/mock-workspaces.ts");
  store.setMockSession("TEST-SALES-NORLI-01");
  const created = store.createMockSalesOrder({ businessType: "NOERLI_FORMAL", customerName: "待办测试客户", customerPhone: "10000000000", address: "测试地址", promisedDate: "2026-12-12", designerId: "TEST-DESIGNER-01", rush: false });
  const ownerTask = workspaces.getMockWorkspace().tasks.find((item) => item.orderId === created.id);
  assert.ok(ownerTask);
  assert.equal(ownerTask.actionRoute, `/pages/sales-create/index?orderId=${created.id}`);
  assert.equal(ownerTask.customerName, created.customerName);

  store.setMockSession("TEST-SALES-NORLI-MANAGER");
  assert.equal(workspaces.getMockWorkspace().tasks.some((item) => item.orderId === created.id), false);
  store.setMockSession("TEST-SALES-AIKEJU-01");
  assert.equal(workspaces.getMockWorkspace().tasks.some((item) => item.orderId === created.id), false);
});
