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
const workspaces = await import("../domain/mock-workspaces.ts");
const mobile = await import("../services/mobile.ts");
const shipments = await import("../domain/mock-shipment.ts");

test("new TEST order follows technical review and route gates before four-workshop reporting", async () => {
  store.setMockSession("TEST-SALES-NORLI-01");
  const created = store.createMockSalesOrder({
    businessType: "NOERLI_FORMAL", customerName: "三区域测试", customerPhone: "10000000000", address: "测试地址",
    promisedDate: "2026-12-12", designerId: "TEST-DESIGNER-01", rush: false,
    initialPayments: {
      contractAmount: 50000,
      deposit: { amount: 5000, receivedAt: "2026-10-10", account: "测试批准账户 A", receipt: { id: "mock-deposit", originalName: "定金.jpg", mimeType: "image/jpeg", size: 10, savedFilePath: "wxfile://deposit" } },
      prepayment: { amount: 10000, receivedAt: "2026-10-12", account: "测试批准账户 A", receipt: { id: "mock-prepayment", originalName: "预付款.jpg", mimeType: "image/jpeg", size: 10, savedFilePath: "wxfile://prepayment" } },
    },
  });
  store.setMockSession("TEST-FINANCE-01");
  store.confirmMockInitialPayments(created.id, { depositVerified: true, prepaymentVerified: true });
  store.setMockSession("TEST-DESIGNER-01");
  store.acceptMockDesign(created.id, { designLeadDays: 3, scopeConfirmed: true });
  const design = { designVersion: "V1", surveyedAt: "2026-10-12", customerConfirmedAt: "2026-10-12", cadAttachmentIds: ["cad"], confirmationAttachmentIds: ["confirm"], sampleBlockAttachmentIds: [] };
  const files = [
    { id: "cad", category: "DESIGN_CAD", originalName: "设计.pdf", mimeType: "application/pdf", size: 10, savedFilePath: "wxfile://cad" },
    { id: "confirm", category: "DESIGN_CONFIRMATION", originalName: "确认图.jpg", mimeType: "image/jpeg", size: 10, savedFilePath: "wxfile://confirm" },
  ];
  store.saveMockDesign(created.id, design, files, true);
  store.setMockSession("TEST-ORDER-ADMIN-01");
  store.approveMockPreReview(created.id);
  assert.throws(() => store.submitMockTechnicalSplit(created.id), /技术拆单员/);

  store.setMockSession("TEST-TECHNICAL-01");
  const split = store.submitMockTechnicalSplit(created.id);
  assert.deepEqual(split.productionAreas.map((area) => [area.name, area.routeLabel]), [
    ["厨房", "实木油漆路线"], ["阳台", "板式路线"], ["主卧", "板式路线＋实木油漆路线"],
  ]);
  assert.equal(split.stageLabel, "技术审单");
  assert.deepEqual(split.productionAreas.map((area) => area.productionNumber), ["TEST-26101001", "TEST-26101002", "TEST-26101003"]);
  assert.match(split.dueLabel, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(split.productionAreas.flatMap((area) => area.workshopFlows).every((flow) => flow.processes[0]?.status === "LOCKED"), true);
  assert.equal(workspaces.getMockWorkspace().tasks.some((task) => task.orderId === created.id), false);

  store.setMockSession("TEST-ORDER-ADMIN-01");
  assert.equal(workspaces.getMockWorkspace().tasks.find((task) => task.orderId === created.id)?.title, "技术审单");
  assert.equal(store.approveMockTechnicalReview(created.id).stageLabel, "采购准备");
  store.setMockSession("TEST-PROCUREMENT-01");
  assert.equal(workspaces.getMockWorkspace().tasks.find((task) => task.orderId === created.id)?.title, "放行生产路线");
  assert.equal(workspaces.getMockWorkspace().tasks.some((task) => task.orderId === created.id && task.type === "PROCUREMENT_PACKAGE"), true);
  const panelRelease = store.completeMockProcurementRoute(created.id, "PANEL");
  assert.equal(panelRelease.stageLabel, "生产执行");
  assert.equal(panelRelease.productionAreas[0]?.workshopFlows[0]?.processes[0]?.status, "LOCKED");
  assert.equal(panelRelease.productionAreas[1]?.workshopFlows[0]?.processes[0]?.status, "READY");
  assert.equal(panelRelease.productionAreas[2]?.workshopFlows[0]?.processes[0]?.status, "READY");
  assert.throws(() => store.completeMockProcurementRoute(created.id, "PANEL"), /已经放行/);

  store.setMockSession("TEST-W101");
  const panelTasks = store.getMockWorkshopWorkbench().actionable.filter((task) => task.orderId === created.id);
  assert.deepEqual(panelTasks.map((task) => task.productionAreaName).sort(), ["主卧", "阳台"]);
  const balconyNumber = panelRelease.productionAreas[1]!.productionNumber;
  assert.equal(store.resolveMockProductionNumber(balconyNumber).status, "DIRECT");
  const first = panelTasks.find((task) => task.productionAreaName === "阳台")!;
  store.submitProductionReport({ orderId: created.id, processId: first.processId!, action: "PROGRESS", completedQty: 20, expectedUpdatedAt: store.getOrder(created.id)!.updatedAt, idempotencyKey: "test-panel-partial" });
  assert.equal(store.getTask(first.id)?.completedQty, 20);
  assert.throws(() => store.submitProductionReport({ orderId: created.id, processId: first.processId!, action: "PROGRESS", completedQty: 10, expectedUpdatedAt: store.getOrder(created.id)!.updatedAt, idempotencyKey: "test-panel-backwards" }), /累计完成数量/);
  store.submitProductionReport({ orderId: created.id, processId: first.processId!, action: "COMPLETE", expectedUpdatedAt: store.getOrder(created.id)!.updatedAt, idempotencyKey: "test-panel-cut" });
  store.clearSession();
  store.setMockSession("TEST-W102");
  assert.equal(store.getMockWorkshopWorkbench().actionable.some((task) => task.orderId === created.id && task.productionAreaName === "阳台" && task.title === "封边"), true);
  assert.equal(store.getOrder(created.id)!.productionAreas[1]?.percent! > 0, true);

  store.setMockSession("TEST-PROCUREMENT-01");
  const woodRelease = store.completeMockProcurementRoute(created.id, "WOOD_PAINT");
  assert.equal(woodRelease.productionAreas[0]?.workshopFlows[0]?.processes[0]?.status, "READY");
  const hardwareTask = workspaces.getMockWorkspace().tasks.find((task) => task.orderId === created.id && task.type === "PROCUREMENT_PACKAGE");
  assert.equal(hardwareTask?.description, "3个生产区域等待最终数量");
  assert.equal(hardwareTask?.actionRoute, `/pages/role-center/index?section=procurement&orderId=${created.id}`);
  assert.equal(workspaces.getMockWorkspace().stats.find((item) => item.key === "package")?.value, workspaces.getMockWorkspace().tasks.filter((task) => task.type === "PROCUREMENT_PACKAGE").length);
  store.setMockSession("TEST-W002");
  assert.equal(store.getMockWorkshopWorkbench().actionable.some((task) => task.orderId === created.id && task.productionAreaName === "厨房"), true);
  for (const item of store.getOrder(created.id)!.productionAreas[0]!.workshopFlows.find((flow) => flow.key === "WOOD")!.processes) {
    store.submitProductionReport({ orderId: created.id, processId: item.id, action: "COMPLETE", expectedUpdatedAt: store.getOrder(created.id)!.updatedAt, idempotencyKey: `wood-${item.id}` });
  }
  assert.equal(store.getOrder(created.id)!.productionAreas[0]!.workshopFlows.find((flow) => flow.key === "PAINT")!.processes[0]?.status, "READY");
  store.setMockSession("TEST-W003");
  for (const item of store.getOrder(created.id)!.productionAreas[0]!.workshopFlows.find((flow) => flow.key === "PAINT")!.processes) {
    store.submitProductionReport({ orderId: created.id, processId: item.id, action: "COMPLETE", expectedUpdatedAt: store.getOrder(created.id)!.updatedAt, idempotencyKey: `paint-${item.id}` });
  }
  assert.equal(store.getOrder(created.id)!.productionAreas[0]!.workshopFlows.find((flow) => flow.key === "ASSEMBLY_WOOD_PAINT")!.processes[0]?.status, "READY");
  store.setMockSession("TEST-W004");
  assert.equal(store.getMockWorkshopWorkbench().actionable.some((task) => task.orderId === created.id && task.productionAreaName === "厨房"), true);
  const kitchenAssembly = store.getOrder(created.id)!.productionAreas[0]!.workshopFlows.find((flow) => flow.key === "ASSEMBLY_WOOD_PAINT")!;
  assert.throws(() => store.submitProductionReport({ orderId: created.id, processId: kitchenAssembly.processes[3]!.id, action: "START", expectedUpdatedAt: store.getOrder(created.id)!.updatedAt, idempotencyKey: "assembly-milestone-start" }), /只支持一键完成打卡/);
  const kitchenSource = `MANUFACTURED_ROUTE:${store.getOrder(created.id)!.productionAreas[0]!.id}-ASSEMBLY_WOOD_PAINT`;
  assert.throws(() => store.runMockPackageCountCommand(created.id, kitchenSource, "ADD_COUNT", 2), /待对应路线完成组装打包/);
  for (const item of kitchenAssembly.processes.filter((process) => !["ASSEMBLY-02", "ASSEMBLY-03"].includes(process.processCode))) {
    store.submitProductionReport({ orderId: created.id, processId: item.id, action: "COMPLETE", expectedUpdatedAt: store.getOrder(created.id)!.updatedAt, idempotencyKey: `assembly-${item.id}` });
  }
  assert.equal(store.getOrder(created.id)!.productionAreas[0]?.complete, true);
  assert.throws(() => store.submitProductionReport({ orderId: created.id, processId: kitchenAssembly.processes[1]!.id, action: "COMPLETE", expectedUpdatedAt: store.getOrder(created.id)!.updatedAt, idempotencyKey: "assembly-hardware-invalid" }), /包件台账/);
  store.runMockPackageCountCommand(created.id, kitchenSource, "ADD_COUNT", 2);
  store.runMockPackageCountCommand(created.id, kitchenSource, "ADD_COUNT", 3);
  assert.equal(store.getMockPackageSummary(created.id).sources.find((source) => source.sourceKey === kitchenSource)?.total, 5);
  assert.equal(store.getMockPackageSummary(created.id).sources.find((source) => source.sourceKey === kitchenSource)?.entries.length, 2);
  store.runMockPackageCountCommand(created.id, kitchenSource, "FINALIZE_SOURCE");
  assert.equal(store.getOrder(created.id)!.productionAreas[0]?.workshopFlows.find((flow) => flow.key === "ASSEMBLY_WOOD_PAINT")?.processes[2]?.status, "DONE");
  const hardwareKey = `HARDWARE_AREA:${store.getOrder(created.id)!.productionAreas[0]!.id}`;
  assert.throws(() => store.runMockPackageCountCommand(created.id, hardwareKey, "CONFIRM_HARDWARE_HANDOFF"), /采购最终确认/);
  storage.set(`tai-mini-hardware:${created.id}`, { [store.getOrder(created.id)!.productionAreas[0]!.id]: 4 });
  store.setMockSession("TEST-PROCUREMENT-01");
  assert.equal(workspaces.getMockWorkspace().tasks.find((task) => task.orderId === created.id && task.type === "PROCUREMENT_PACKAGE")?.description, "2个生产区域等待最终数量");
  store.setMockSession("TEST-W004");
  store.runMockPackageCountCommand(created.id, hardwareKey, "CONFIRM_HARDWARE_HANDOFF");
  assert.equal(store.getMockPackageSummary(created.id).hardwareTotal, 4);
  assert.equal(store.getMockPackageSummary(created.id).sources.find((source) => source.sourceKey === hardwareKey)?.handoffConfirmed, true);
  assert.equal(store.getOrder(created.id)!.productionAreas[0]?.complete, true);
  store.clearSession();
  store.setMockSession("TEST-W004");
  assert.equal(store.getOrder(created.id)!.productionAreas[0]?.complete, true);
  assert.equal(store.getMockPackageSummary(created.id).manufacturedTotal, 5);
  assert.equal(store.getMockPackageSummary(created.id).sources.find((source) => source.sourceKey === hardwareKey)?.handoffConfirmed, true);
  assert.equal(store.getOrder(created.id)!.areaSummary.completed, 1);

  const completeFlow = (areaName: string, flowKey: string, employeeId: string) => {
    store.setMockSession(employeeId);
    const area = store.getOrder(created.id)!.productionAreas.find((item) => item.name === areaName)!;
    for (const item of area.workshopFlows.find((flow) => flow.key === flowKey)!.processes.filter((process) => !["ASSEMBLY-02", "ASSEMBLY-03"].includes(process.processCode))) {
      if (item.status === "DONE") continue;
      store.submitProductionReport({ orderId: created.id, processId: item.id, action: "COMPLETE", expectedUpdatedAt: store.getOrder(created.id)!.updatedAt, idempotencyKey: `finish-${item.id}` });
    }
  };
  completeFlow("阳台", "PANEL", "TEST-WORKSHOP-SUPERVISOR");
  completeFlow("阳台", "ASSEMBLY_PANEL", "TEST-W004");
  completeFlow("主卧", "PANEL", "TEST-WORKSHOP-SUPERVISOR");
  completeFlow("主卧", "WOOD", "TEST-W002");
  completeFlow("主卧", "PAINT", "TEST-W003");
  completeFlow("主卧", "ASSEMBLY_PANEL", "TEST-W004");
  completeFlow("主卧", "ASSEMBLY_WOOD_PAINT", "TEST-W004");
  assert.equal(store.getOrder(created.id)?.areaSummary.completed, 3);
  assert.equal(store.getOrder(created.id)?.stageLabel, "发货");
  store.setMockSession("TEST-ORDER-ADMIN-01");
  assert.equal(workspaces.getMockWorkspace().tasks.find((task) => task.orderId === created.id)?.title, "生产已完成，待核验尾款");
  assert.equal(workspaces.getMockWorkspace().tasks.find((task) => task.orderId === created.id)?.type, "TAIL_PAYMENT");
  store.setMockSession("TEST-SALES-NORLI-01");
  storage.set(`tai-mini-completed:${created.id}:REPORT_TAIL_PAYMENT`, true);
  const tailTask = workspaces.getMockWorkspace().tasks.find((task) => task.orderId === created.id && task.type === "TAIL_PAYMENT");
  assert.equal(tailTask?.actionCode, "REPORT_TAIL_PAYMENT");
  assert.equal(tailTask?.actionRoute, `/pages/tail-payment/index?orderId=${encodeURIComponent(created.id)}`);
  assert.equal(store.getOrder(created.id)?.nextAction, "所属销售报备尾款到账与凭证，财务核验后可发货");
  const tail = { amount: 35000, receivedAt: "2026-10-13", account: "测试批准账户 A", receipt: { id: "tail-receipt", originalName: "尾款.jpg", mimeType: "image/jpeg", size: 10, savedFilePath: "wxfile://tail" } };
  assert.throws(() => store.reportMockTailPayment(created.id, { ...tail, amount: 30000 }), /尾款金额/);
  store.reportMockTailPayment(created.id, tail);
  assert.equal(workspaces.getMockWorkspace().tasks.some((task) => task.orderId === created.id && task.type === "TAIL_PAYMENT"), false);
  store.setMockSession("TEST-FINANCE-01");
  storage.set(`tai-mini-completed:${created.id}:CONFIRM_TAIL_PAYMENT`, true);
  assert.equal(workspaces.getMockWorkspace().tasks.find((task) => task.orderId === created.id && task.actionCode === "CONFIRM_TAIL_PAYMENT")?.title, "核验尾款到账");
  const paymentForm = await mobile.loadMiniPaymentForm(created.id);
  assert.deepEqual(paymentForm.availableCommands, ["CONFIRM_TAIL_PAYMENT"]);
  assert.equal(paymentForm.facts.find((fact) => fact.key === "TAIL")?.amount, 35000);
  assert.equal(paymentForm.receipts.some((receipt) => receipt.id === "tail-receipt"), true);
  assert.throws(() => store.confirmMockTailPayment(created.id, { verified: false }), /实际到账/);
  store.confirmMockTailPayment(created.id, { verified: true });
  assert.equal(workspaces.getMockWorkspace().tasks.some((task) => task.orderId === created.id && task.actionCode === "CONFIRM_TAIL_PAYMENT"), false);
  assert.equal(Boolean(store.getMockPaymentState(created.id)?.tailConfirmedAt), true);
  store.setMockSession("TEST-PROCUREMENT-01");
  storage.set(`tai-mini-hardware:${created.id}`, Object.fromEntries(store.getOrder(created.id)!.productionAreas.map((area) => [area.id, 4])));
  assert.equal(workspaces.getMockWorkspace().tasks.some((task) => task.orderId === created.id && task.type === "PROCUREMENT_PACKAGE"), false);
  store.setMockSession("TEST-ORDER-ADMIN-01");
  const shipmentTask = workspaces.getMockWorkspace().tasks.find((task) => task.orderId === created.id && task.type === "SHIPMENT");
  assert.equal(shipmentTask?.title, "登记发货车次");
  assert.equal(shipmentTask?.actionRoute, `/pages/shipment/index?orderId=${created.id}`);

  const planned = shipments.mockShipmentRoutes(store.getOrder(created.id)!).filter((route) => route.completed);
  assert.equal(planned.length, 4);
  const groups = [planned.slice(0, 1), planned.slice(1, 2), planned.slice(2)];
  groups.forEach((group, index) => shipments.recordMockShipment(store.getOrder(created.id)!, {
    routes: group.map((route) => ({ id: route.id, areaName: route.areaName, productionNumber: route.productionNumber, isFinalBatch: true })),
    outsourceIds: [], vehicle: `测试车${index + 1}`, installerId: index === 1 ? "TEST-INSTALLER-02" : "TEST-INSTALLER-01",
    installationTeamLabel: index === 1 ? "安装二组" : "安装一组", contact: "客户", plannedAt: "2026-10-15", siteConditions: "可进场",
  }));
  assert.equal(store.getOrder(created.id)?.stageLabel, "安装");
  assert.equal(store.getOrder(created.id)?.stageIndex, 8);
  const allShipments = store.getOrder(created.id)!.shipments!;
  assert.equal(allShipments.length, 3);
  store.setMockSession("TEST-INSTALLER-01");
  const assigned = workspaces.getMockWorkspace().tasks.filter((task) => task.orderId === created.id && task.type === "INSTALLATION");
  assert.equal(assigned.length, 2);
  assert.equal(assigned.every((task) => task.actionRoute?.includes("shipmentId=")), true);
  assert.throws(() => shipments.recordMockInstallation(created.id, allShipments[1]!.id, { type: "COMPLETE", reportedOn: "2026-10-16", note: "", photoPaths: ["wxfile://photo"], transportCost: 0 }), /没有该车次/);
  shipments.recordMockInstallation(created.id, allShipments[0]!.id, { type: "PARTIAL", reportedOn: "2026-10-16", note: "待补装", photoPaths: ["wxfile://photo"], transportCost: null });
  assert.equal(workspaces.getMockWorkspace().tasks.filter((task) => task.orderId === created.id && task.type === "INSTALLATION").length, 2);
  shipments.recordMockInstallation(created.id, allShipments[0]!.id, { type: "COMPLETE", reportedOn: "2026-10-17", note: "", photoPaths: ["wxfile://photo"], transportCost: 12 });
  assert.equal(workspaces.getMockWorkspace().tasks.filter((task) => task.orderId === created.id && task.type === "INSTALLATION").length, 1);
  shipments.recordMockInstallation(created.id, allShipments[2]!.id, { type: "COMPLETE", reportedOn: "2026-10-17", note: "", photoPaths: ["wxfile://photo"], transportCost: 12 });
  store.setMockSession("TEST-INSTALLER-02");
  assert.equal(workspaces.getMockWorkspace().tasks.filter((task) => task.orderId === created.id && task.type === "INSTALLATION").length, 1);
  shipments.recordMockInstallation(created.id, allShipments[1]!.id, { type: "COMPLETE", reportedOn: "2026-10-17", note: "", photoPaths: ["wxfile://photo"], transportCost: 12 });
  assert.equal(store.getOrder(created.id)?.stageLabel, "待客户验收");
  assert.equal(workspaces.getMockWorkspace().tasks.some((task) => task.orderId === created.id && task.type === "CUSTOMER_ACCEPTANCE"), true);
  store.setMockSession("TEST-ORDER-ADMIN-01");
  assert.equal(workspaces.getMockWorkspace().tasks.find((task) => task.orderId === created.id && task.type === "CUSTOMER_ACCEPTANCE")?.actionRoute, `/pages/installation/index?mode=acceptance&orderId=${created.id}`);
  shipments.recordMockCustomerAcceptance(created.id, { acceptedAt: "2026-10-18", conclusion: "验收通过", signaturePath: "wxfile://signature" });
  assert.equal(store.getOrder(created.id)?.stageLabel, "验收完成");
  assert.equal(workspaces.getMockWorkspace().tasks.some((task) => task.orderId === created.id && task.type === "CUSTOMER_ACCEPTANCE"), false);
});

test("existing local TEST-AREA numbers migrate while keeping completed workshop quantities", () => {
  const saved = storage.get("tai-mini-local-orders") as Array<{ id: string; customerName: string; productionAreas: Array<{ productionNumber: string; workshopFlows: Array<{ processes: Array<{ completedQty: number }> }> }> }>;
  const order = saved.find((item) => item.customerName === "三区域测试")!;
  const before = order.productionAreas[0]!.workshopFlows[0]!.processes[0]!.completedQty;
  order.productionAreas.forEach((area, index) => { area.productionNumber = `TEST-AREA-old-${index + 1}`; });
  delete (order as any).siteType;
  delete (order as any).finishType;
  storage.set("tai-mini-local-orders", saved);
  const migrated = store.getOrder(order.id)!;
  assert.deepEqual(migrated.productionAreas.map((area) => area.productionNumber), ["TEST-26101001", "TEST-26101002", "TEST-26101003"]);
  assert.equal(migrated.productionAreas[0]!.workshopFlows[0]!.processes[0]!.completedQty, before);
  assert.match(migrated.dueLabel, /^\d{4}-\d{2}-\d{2}$/);
});
