import { runtime } from "../config/runtime";
import { getMockRoleOrders } from "../domain/mock-workspaces";
import { getMockAfterSalesCases } from "../domain/mock-aftersales";
import { mockShipmentQueueItem } from "../domain/mock-shipment";
import { getMockOutsourceLines, mockArrivalKey } from "../domain/mock-outsource";
import { acceptMockDesign, approveMockPreReview, approveMockTechnicalReview, completeMockProcurementRoute, confirmMockInitialPayments, confirmMockTailPayment, getMockDesignState, getMockPackageSummary, getMockPaymentState, getMockTechnicalState, getOrder, getOrders, getStoredSession, saveMockDesign, submitMockTechnicalSplit, transferMockDesign, type MockDesignFile } from "../domain/store";
import type { MiniAfterSalesCase, MiniOrder, MiniReferenceData } from "../domain/types";
import type { MiniShipmentQueueItem } from "../domain/shipment-queue";
import { miniDownload, miniRequest, miniUpload } from "./client";

export function loadRoleOrders(): Promise<MiniOrder[]> {
  return runtime.mode === "mock" ? Promise.resolve(getMockRoleOrders()) : miniRequest<MiniOrder[]>("/api/v1/mini/orders");
}

export function loadMiniShipmentQueue(): Promise<MiniShipmentQueueItem[]> {
  if (runtime.mode === "mock") return Promise.resolve(getMockRoleOrders().map(mockShipmentQueueItem).filter((item): item is MiniShipmentQueueItem => Boolean(item)));
  return miniRequest<MiniShipmentQueueItem[]>("/api/v1/mini/shipments");
}

export function loadRoleOrder(id: string): Promise<MiniOrder | undefined> {
  if (runtime.mode === "mock") return Promise.resolve(getMockRoleOrders().some((item) => item.id === id) ? getOrder(id) : undefined);
  return miniRequest<MiniOrder>(`/api/v1/mini/orders/${encodeURIComponent(id)}`);
}

export function advanceMockPreReview(orderId: string): Promise<MiniOrder> {
  if (runtime.mode !== "mock") return Promise.reject(new Error("仅本机模拟模式可使用此测试操作"));
  try { return Promise.resolve(approveMockPreReview(orderId)); }
  catch (error) { return Promise.reject(error); }
}

export function advanceMockTechnicalSplit(orderId: string): Promise<MiniOrder> {
  if (runtime.mode !== "mock") return Promise.reject(new Error("仅本机模拟模式可使用此测试操作"));
  try { return Promise.resolve(submitMockTechnicalSplit(orderId)); }
  catch (error) { return Promise.reject(error); }
}

export function advanceMockTechnicalReview(orderId: string): Promise<MiniOrder> {
  if (runtime.mode !== "mock") return Promise.reject(new Error("仅本机模拟模式可使用此测试操作"));
  try { return Promise.resolve(approveMockTechnicalReview(orderId)); }
  catch (error) { return Promise.reject(error); }
}

export function advanceMockProcurementRoute(orderId: string, kind: "PANEL" | "WOOD_PAINT"): Promise<MiniOrder> {
  if (runtime.mode !== "mock") return Promise.reject(new Error("仅本机模拟模式可使用此测试操作"));
  try { return Promise.resolve(completeMockProcurementRoute(orderId, kind)); }
  catch (error) { return Promise.reject(error); }
}

export function loadMiniReferenceData(): Promise<MiniReferenceData> {
  if (runtime.mode === "mock") {
    const unit = getStoredSession()?.businessUnit;
    return Promise.resolve({
    businessTypes: unit ? [`${unit}_FORMAL`, `${unit}_SUPPLEMENT`] : [],
    designers: [{ id: "TEST-DESIGNER-01", name: "设计师郑思雁", department: "设计部" }, { id: "TEST-DESIGNER-02", name: "设计师林若溪", department: "设计部" }],
    paymentAccounts: ["测试批准账户 A", "测试批准账户 B"],
    installers: [{ id: "TEST-INSTALLER-01", name: "赵师傅", department: "安装一组" }, { id: "TEST-INSTALLER-02", name: "孙师傅", department: "安装二组" }],
  });
  }
  return miniRequest<MiniReferenceData>("/api/v1/mini/reference-data");
}

export function createMiniOrder(payload: Record<string, unknown>, idempotencyKey: string) {
  return miniRequest<MiniOrder>("/api/v1/mini/orders", { method: "POST", body: payload, idempotencyKey });
}

export function loadMiniSalesDraft(): Promise<Record<string, unknown> | null> {
  if (runtime.mode === "mock") return Promise.resolve(wx.getStorageSync<Record<string, unknown>>("tai-mini-sales-draft") || null);
  return miniRequest<{ payload: Record<string, unknown> | null }>("/api/v1/mini/drafts/SALES_ORDER/NEW").then((result) => result.payload);
}

export function saveMiniSalesDraft(payload: Record<string, unknown>) {
  if (runtime.mode === "mock") { wx.setStorageSync("tai-mini-sales-draft", payload); return Promise.resolve(); }
  return miniRequest("/api/v1/mini/drafts/SALES_ORDER/NEW", { method: "POST", body: { payload } }).then(() => undefined);
}

export function clearMiniSalesDraft() {
  wx.removeStorageSync("tai-mini-sales-draft");
  return runtime.mode === "mock" ? Promise.resolve() : miniRequest("/api/v1/mini/drafts/SALES_ORDER/NEW/clear", { method: "POST" }).then(() => undefined);
}

export function runMiniOrderCommand(orderId: string, command: string, payload: Record<string, unknown>, expectedUpdatedAt: string, idempotencyKey: string) {
  if (runtime.mode === "mock") {
    const order = getOrder(orderId);
    if (!order) return Promise.reject(new Error("模拟订单不存在"));
    if (["CONFIRM_DEPOSIT", "CONFIRM_INITIAL_PAYMENTS", "CONFIRM_TAIL_PAYMENT"].includes(command) && !order.trackingSerial.startsWith("TEST-DEMO-GD-")) {
      return Promise.reject(new Error("预置演示单没有可核验的付款事实，请使用新建订单测试"));
    }
    if (command === "CONFIRM_DEPOSIT") return Promise.reject(new Error("本机演示尚无这笔款项的可核验报备"));
    if (order.trackingSerial.startsWith("TEST-DEMO-GD-") && command === "CONFIRM_TAIL_PAYMENT") {
      try { return Promise.resolve(confirmMockTailPayment(orderId, payload)); }
      catch (error) { return Promise.reject(error); }
    }
    if (order.trackingSerial.startsWith("TEST-DEMO-GD-") && command === "REPORT_TAIL_PAYMENT") return Promise.reject(new Error("请在尾款报备页面上传并保存凭证"));
    if (order.trackingSerial.startsWith("TEST-DEMO-GD-") && command === "CONFIRM_INITIAL_PAYMENTS") {
      try { return Promise.resolve(confirmMockInitialPayments(orderId, payload)); }
      catch (error) { return Promise.reject(error); }
    }
    if (order.trackingSerial.startsWith("TEST-DEMO-GD-") && command === "ACCEPT_DESIGN") {
      try { return Promise.resolve(acceptMockDesign(orderId, payload)); }
      catch (error) { return Promise.reject(error); }
    }
    if (order.trackingSerial.startsWith("TEST-DEMO-GD-") && command === "TRANSFER_DESIGN") {
      try { return Promise.resolve(transferMockDesign(orderId, payload)); }
      catch (error) { return Promise.reject(error); }
    }
    if (order.trackingSerial.startsWith("TEST-DEMO-GD-") && command === "SUBMIT_DESIGN") {
      try { return Promise.resolve(saveMockDesign(orderId, payload, getMockDesignState(orderId)?.files ?? [], true)); }
      catch (error) { return Promise.reject(error); }
    }
    wx.setStorageSync(`tai-mini-completed:${orderId}:${command}`, true);
    return Promise.resolve({ ...order, updatedAt: new Date().toISOString() });
  }
  return miniRequest<MiniOrder>(`/api/v1/mini/orders/${orderId}/commands`, { method: "POST", body: { command, payload }, expectedUpdatedAt, idempotencyKey });
}

export interface MiniDesignFile { id: string; category: string; originalName: string; mimeType: string; size: number; savedFilePath?: string }
export function loadMiniDesignDraft(orderId: string): Promise<{ payload: Record<string, unknown> | null; files: MiniDesignFile[] }> {
  if (runtime.mode === "mock") {
    const state = getMockDesignState(orderId);
    return Promise.resolve({ payload: state?.payload ?? null, files: state?.files ?? [] });
  }
  return miniRequest(`/api/v1/mini/orders/${encodeURIComponent(orderId)}/design-draft`);
}

export function saveMiniDesignDraft(orderId: string, payload: Record<string, unknown>, files: MiniDesignFile[], expectedUpdatedAt: string, idempotencyKey: string): Promise<MiniOrder> {
  if (runtime.mode === "mock") {
    try { return Promise.resolve(saveMockDesign(orderId, payload, files as MockDesignFile[], false)); }
    catch (error) { return Promise.reject(error); }
  }
  return miniRequest<MiniOrder>(`/api/v1/mini/orders/${encodeURIComponent(orderId)}/drafts`, { method: "POST", body: { command: "SUBMIT_DESIGN", payload }, expectedUpdatedAt, idempotencyKey });
}

export function saveMockDesignFile(file: MiniDesignFile): Promise<MiniDesignFile> {
  return new Promise((resolve, reject) => wx.saveFile({ tempFilePath: file.savedFilePath ?? "", success: (result) => resolve({ ...file, savedFilePath: result.savedFilePath }), fail: () => reject(new Error("文件保存在本机失败，请重新选择")) }));
}

export interface MiniPaymentForm {
  order: { id: string; trackingSerial: string; salesNumber: string | null; customerName: string; updatedAt: string };
  facts: Array<{ key: "DEPOSIT" | "PREPAYMENT" | "TAIL"; label: string; reported: boolean; confirmed: boolean; amount: number | null; receivedAt: string | null; account: string | null; receiptAttachmentIds: string[] }>;
  receipts: Array<{ id: string; originalName: string; mimeType: string; size: number }>;
  receiptRestricted: boolean;
  availableCommands: string[];
}

export interface MiniProcurementForm {
  order: { id: string; trackingSerial: string; salesNumber: string | null; customerName: string; updatedAt: string };
  routes: Array<{ id: string; kind: "PANEL" | "WOOD_PAINT"; label: string; dueAt: string | null; completedAt: string | null; productionNumbers: string[] }>;
  hardwareAreas: Array<{ id: string; name: string; productionNumber: string; total: number; finalized: boolean }>;
}

export interface MiniSupplySummary {
  order: { id: string; trackingSerial: string; salesNumber: string | null; customerName: string; updatedAt: string };
  hardwareAreas: Array<{ id: string; name: string; productionNumber: string; total: number; finalized: boolean; handoffConfirmed: boolean }>;
  hardwareTotal: number;
  hardwareFinalized: number;
  packageTotal: number;
  packageStatus: string;
  manufacturedTotal: number;
  outsourcedPackageTotal: number;
  packageSources: Array<{ sourceKey: string; label: string; kind: string; total: number; finalized: boolean; detail: string }>;
  outsourceLines: Array<{ id: string; name: string; usageArea: string | null; note: string | null; unit: string; plannedQty: number; arrivedQty: number; remainingQty: number; shipped: boolean; arrivals: Array<{ id: string; quantity: number; arrivedOn: string }> }>;
  outsourceReady: number;
  outsourcePending: number;
}

export async function loadMiniSupplySummary(orderId: string): Promise<MiniSupplySummary> {
  if (runtime.mode !== "mock") return miniRequest<MiniSupplySummary>(`/api/v1/mini/orders/${encodeURIComponent(orderId)}/supply-summary`);
  const employee = getStoredSession();
  if (!employee || !["PROCUREMENT", "ORDER_ADMIN", "CHAIRMAN"].includes(employee.role)) throw new Error("当前岗位不能查看包件与外购到货统计");
  const order = getOrder(orderId);
  if (!order || !getMockRoleOrders().some((row) => row.id === orderId)) throw new Error("订单不存在或无权查看");
  const packages = getMockPackageSummary(orderId);
  const hardwareAreas = order.productionAreas.map((area) => {
    const source = packages.sources.find((item) => item.kind === "HARDWARE_AREA" && item.productionAreaId === area.id);
    return { id: area.id, name: area.name, productionNumber: area.productionNumber, total: source?.total ?? 0, finalized: source?.status === "FINALIZED", handoffConfirmed: source?.handoffConfirmed ?? false };
  });
  const outsourceLines: MiniSupplySummary["outsourceLines"] = getMockOutsourceLines(orderId);
  return { order: { id: order.id, trackingSerial: order.trackingSerial, salesNumber: order.salesNumber, customerName: order.customerName, updatedAt: order.updatedAt }, hardwareAreas, hardwareTotal: packages.hardwareTotal, hardwareFinalized: hardwareAreas.filter((area) => area.finalized).length,
    packageTotal: packages.currentTotal, packageStatus: packages.status, manufacturedTotal: packages.manufacturedTotal, outsourcedPackageTotal: packages.outsourcedTotal,
    packageSources: packages.sources.filter((source) => source.kind !== "HARDWARE_AREA").map((source) => ({ sourceKey: source.sourceKey, label: source.label, kind: source.kind, total: source.total, finalized: source.status === "FINALIZED", detail: source.detail })),
    outsourceLines, outsourceReady: outsourceLines.filter((line) => line.arrivedQty >= line.plannedQty).length, outsourcePending: outsourceLines.filter((line) => !line.shipped && line.remainingQty > 0).length };
}

export async function recordMiniOutsourceArrival(orderId: string, lineId: string, quantity: number, arrivedOn: string, expectedUpdatedAt: string): Promise<MiniSupplySummary> {
  if (runtime.mode !== "mock") {
    await miniRequest(`/api/v1/mini/orders/${encodeURIComponent(orderId)}/outsource/products/${encodeURIComponent(lineId)}/arrivals`, { method: "POST", body: { quantity, arrivedOn }, expectedUpdatedAt, idempotencyKey: `mini-arrival-${orderId}-${lineId}-${Date.now()}` });
    return loadMiniSupplySummary(orderId);
  }
  if (getStoredSession()?.role !== "ORDER_ADMIN") throw new Error("只有订单管理员可登记外购到货");
  const summary = await loadMiniSupplySummary(orderId);
  const line = summary.outsourceLines.find((item) => item.id === lineId);
  if (!line || line.shipped || !Number.isInteger(quantity) || quantity <= 0 || quantity > line.remainingQty || !/^\d{4}-\d{2}-\d{2}$/.test(arrivedOn)) throw new Error("本次到货数量或日期无效");
  wx.setStorageSync(mockArrivalKey(orderId, lineId), [...line.arrivals, { id: `mock-arrival-${Date.now()}`, quantity, arrivedOn }]);
  return loadMiniSupplySummary(orderId);
}

export interface MiniPaymentAccount {
  id: string;
  name: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewComment?: string | null;
  requestedAt: string;
}

function mockPaymentAccounts(): MiniPaymentAccount[] {
  return wx.getStorageSync<MiniPaymentAccount[]>("tai-mini-payment-accounts") || [
    { id: "mock-account-1", name: "招商银行上海基本户", status: "PENDING", requestedAt: "2026-09-13T16:00:00+08:00" },
    { id: "mock-account-2", name: "测试批准账户 A", status: "APPROVED", requestedAt: "2026-09-01T09:00:00+08:00" },
  ];
}

export function loadMiniPaymentForm(orderId: string): Promise<MiniPaymentForm> {
  if (runtime.mode !== "mock") return miniRequest<MiniPaymentForm>(`/api/v1/mini/orders/${encodeURIComponent(orderId)}/payment-form`);
  const order = getOrder(orderId);
  if (!order) return Promise.reject(new Error("模拟订单不存在"));
  const employee = getStoredSession();
  const ownSalesOrder = employee?.role === "SALES" && order.salesOwnerId === employee.id;
  if (employee?.role !== "FINANCE" && employee?.role !== "CHAIRMAN" && !ownSalesOrder) return Promise.reject(new Error("无权查看订单收款资料"));
  const payment = getMockPaymentState(orderId);
  if (order.trackingSerial.startsWith("TEST-DEMO-GD-")) {
    const restricted = employee?.role === "CHAIRMAN";
    const tail = payment?.tail;
    return Promise.resolve({
      order: { id: order.id, trackingSerial: order.trackingSerial, salesNumber: order.salesNumber, customerName: order.customerName, updatedAt: order.updatedAt },
      facts: ([
        { key: "DEPOSIT" as const, label: "定金", fact: payment?.deposit },
        { key: "PREPAYMENT" as const, label: "预付款", fact: payment?.prepayment },
        { key: "TAIL" as const, label: "尾款", fact: tail },
      ]).map(({ key, label, fact }) => ({ key, label, reported: Boolean(fact), confirmed: key === "TAIL" ? Boolean(payment?.tailConfirmedAt) : Boolean(fact && payment?.status !== "AWAITING_FINANCE"), amount: fact?.amount ?? null, receivedAt: fact?.receivedAt ?? null, account: fact && !restricted ? fact.account : null, receiptAttachmentIds: fact && !restricted ? [fact.receipt.id] : [] })),
      receipts: restricted || !payment ? [] : [payment.deposit.receipt, payment.prepayment.receipt, ...(tail ? [tail.receipt] : [])].map(({ id, originalName, mimeType, size }) => ({ id, originalName, mimeType, size })),
      receiptRestricted: restricted,
      availableCommands: employee?.role === "FINANCE" && payment?.status === "AWAITING_FINANCE" ? ["CONFIRM_INITIAL_PAYMENTS"] : employee?.role === "FINANCE" && tail && !payment?.tailConfirmedAt ? ["CONFIRM_TAIL_PAYMENT"] : [],
    });
  }
  return Promise.resolve({
    order: { id: order.id, trackingSerial: order.trackingSerial, salesNumber: order.salesNumber, customerName: order.customerName, updatedAt: order.updatedAt },
    facts: [
      { key: "DEPOSIT", label: "定金", reported: true, confirmed: false, amount: 5000, receivedAt: "2026-09-12", account: "测试批准账户 A", receiptAttachmentIds: ["mock-receipt-deposit"] },
      { key: "PREPAYMENT", label: "预付款", reported: true, confirmed: false, amount: 12000, receivedAt: "2026-09-13", account: "测试批准账户 A", receiptAttachmentIds: ["mock-receipt-prepayment"] },
      { key: "TAIL", label: "尾款", reported: order.id === "TEST-DEMO-MINI-001", confirmed: false, amount: 36000, receivedAt: "2026-09-13", account: "测试批准账户 A", receiptAttachmentIds: ["mock-receipt-tail"] },
    ],
    receipts: [],
    receiptRestricted: getStoredSession()?.role === "CHAIRMAN",
    availableCommands: order.id === "TEST-DEMO-MINI-001" ? ["CONFIRM_TAIL_PAYMENT"] : ["CONFIRM_INITIAL_PAYMENTS"],
  });
}

export function loadMiniProcurementForm(orderId: string): Promise<MiniProcurementForm> {
  if (runtime.mode !== "mock") return miniRequest<MiniProcurementForm>(`/api/v1/mini/orders/${encodeURIComponent(orderId)}/procurement-form`);
  const order = getOrder(orderId);
  if (!order) return Promise.reject(new Error("模拟订单不存在"));
  const savedTotals = wx.getStorageSync<Record<string, number>>(`tai-mini-hardware:${orderId}`) || {};
  const technical = getMockTechnicalState(orderId);
  if (technical) return Promise.resolve({
    order: { id: order.id, trackingSerial: order.trackingSerial, salesNumber: order.salesNumber, customerName: order.customerName, updatedAt: order.updatedAt },
    routes: ([
      { kind: "PANEL" as const, label: "板式路线", completedAt: technical.panelReleasedAt ?? null, flowKey: "PANEL" },
      { kind: "WOOD_PAINT" as const, label: "实木油漆路线", completedAt: technical.woodPaintReleasedAt ?? null, flowKey: "WOOD" },
    ]).map((route) => ({ id: `${order.id}-${route.kind}`, kind: route.kind, label: route.label, dueAt: order.dueAt, completedAt: route.completedAt, productionNumbers: order.productionAreas.filter((area) => area.workshopFlows.some((flow) => flow.key === route.flowKey)).map((area) => area.productionNumber) })),
    hardwareAreas: order.productionAreas.map((area) => ({ id: area.id, name: area.name, productionNumber: area.productionNumber, total: savedTotals[area.id] ?? 0, finalized: Object.prototype.hasOwnProperty.call(savedTotals, area.id) })),
  });
  return Promise.resolve({
    order: { id: order.id, trackingSerial: order.trackingSerial, salesNumber: order.salesNumber, customerName: order.customerName, updatedAt: order.updatedAt },
    routes: [
      { id: `${order.id}-panel`, kind: "PANEL", label: "板式路线", dueAt: order.dueAt, completedAt: wx.getStorageSync<string>(`tai-mini-procurement:${order.id}:PANEL`) || null, productionNumbers: order.productionAreas.map((area) => area.productionNumber) },
      { id: `${order.id}-wood`, kind: "WOOD_PAINT", label: "实木油漆路线", dueAt: order.dueAt, completedAt: wx.getStorageSync<string>(`tai-mini-procurement:${order.id}:WOOD_PAINT`) || null, productionNumbers: [] },
    ],
    hardwareAreas: order.productionAreas.map((area, index) => ({ id: area.id, name: area.name, productionNumber: area.productionNumber, total: savedTotals[area.id] ?? index + 2, finalized: Object.prototype.hasOwnProperty.call(savedTotals, area.id) })),
  });
}

export function listMiniPaymentAccounts(): Promise<MiniPaymentAccount[]> {
  return runtime.mode === "mock" ? Promise.resolve(mockPaymentAccounts()) : miniRequest<MiniPaymentAccount[]>("/api/v1/mini/payment-accounts");
}

export function requestMiniPaymentAccount(name: string): Promise<MiniPaymentAccount> {
  if (runtime.mode !== "mock") return miniRequest<MiniPaymentAccount>("/api/v1/mini/payment-accounts", { method: "POST", body: { name } });
  const rows = mockPaymentAccounts();
  const account = { id: `mock-account-${Date.now()}`, name: name.trim(), status: "PENDING" as const, requestedAt: new Date().toISOString() };
  wx.setStorageSync("tai-mini-payment-accounts", [account, ...rows]);
  return Promise.resolve(account);
}

export function reviewMiniPaymentAccount(id: string, decision: "APPROVE" | "REJECT", comment: string): Promise<MiniPaymentAccount> {
  if (runtime.mode !== "mock") return miniRequest<MiniPaymentAccount>(`/api/v1/mini/payment-accounts/${encodeURIComponent(id)}/review`, { method: "POST", body: { decision, comment } });
  const rows = mockPaymentAccounts();
  const account = rows.find((item) => item.id === id);
  if (!account) return Promise.reject(new Error("账户申请不存在"));
  account.status = decision === "APPROVE" ? "APPROVED" : "REJECTED";
  account.reviewComment = comment.trim() || null;
  wx.setStorageSync("tai-mini-payment-accounts", rows);
  return Promise.resolve(account);
}

export function completeMiniProcurementRoute(orderId: string, kind: "PANEL" | "WOOD_PAINT", expectedUpdatedAt: string, overrideReason: string) {
  if (runtime.mode === "mock") {
    if (getMockTechnicalState(orderId)) completeMockProcurementRoute(orderId, kind);
    else { wx.setStorageSync(`tai-mini-procurement:${orderId}:${kind}`, new Date().toISOString()); wx.setStorageSync(`tai-mini-completed:${orderId}:COMPLETE_PROCUREMENT_ROUTE`, true); }
    return loadMiniProcurementForm(orderId);
  }
  return miniRequest<MiniProcurementForm>(`/api/v1/mini/orders/${encodeURIComponent(orderId)}/procurement-routes/${kind}/complete`, { method: "POST", body: { attested: true, overrideReason }, expectedUpdatedAt, idempotencyKey: `mini-procurement-${orderId}-${kind}-${Date.now()}` });
}

export function finalizeMiniHardwarePackages(orderId: string, areas: Array<{ productionAreaId: string; total: number }>, expectedUpdatedAt: string) {
  if (runtime.mode === "mock") { wx.setStorageSync(`tai-mini-hardware:${orderId}`, Object.fromEntries(areas.map((area) => [area.productionAreaId, area.total]))); wx.setStorageSync(`tai-mini-completed:${orderId}:FINALIZE_HARDWARE_PACKAGES`, true); return loadMiniProcurementForm(orderId); }
  return miniRequest<MiniProcurementForm>(`/api/v1/mini/orders/${encodeURIComponent(orderId)}/package-counts/hardware/finalize`, { method: "POST", body: { areas }, expectedUpdatedAt, idempotencyKey: `mini-hardware-${orderId}-${Date.now()}` });
}

export async function previewMiniAttachment(attachmentId: string, mimeType: string) {
  if (runtime.mode === "mock") {
    const employee = getStoredSession();
    const match = getOrders().flatMap((order) => {
      const payment = getMockPaymentState(order.id);
      return payment ? [payment.deposit.receipt, payment.prepayment.receipt, ...(payment.tail ? [payment.tail.receipt] : [])].map((receipt) => ({ order, receipt })) : [];
    }).find(({ receipt }) => receipt.id === attachmentId);
    if (!match || !(employee?.role === "FINANCE" || employee?.role === "SALES" && match.order.salesOwnerId === employee.id)) throw new Error("凭证不存在或无权查看");
    if (match.receipt.mimeType.startsWith("image/")) wx.previewImage({ urls: [match.receipt.savedFilePath], current: match.receipt.savedFilePath });
    else wx.openDocument({ filePath: match.receipt.savedFilePath });
    return;
  }
  const path = await miniDownload(`/api/v1/mini/attachments/${encodeURIComponent(attachmentId)}`);
  if (mimeType.startsWith("image/")) wx.previewImage({ urls: [path], current: path });
  else wx.openDocument({ filePath: path, showMenu: false });
}

export interface MiniShipmentForm {
  order: { id: string; trackingSerial: string; salesNumber: string | null; customerName: string; updatedAt: string };
  tailPaymentConfirmed: boolean;
  routes: Array<{ id: string; areaId: string; areaName: string; productionNumber: string; routeLabel: string; completed: boolean; batchCount: number; finalBatchRecorded: boolean }>;
  outsourceLines: Array<{ id: string; name: string; usageArea: string | null; plannedQty: number; arrivedQty: number; unit: string; shipped: boolean }>;
}

export function loadMiniShipmentForm(orderId: string) {
  return miniRequest<MiniShipmentForm>(`/api/v1/mini/orders/${orderId}/shipment-form`);
}

export function completeMiniInstallation(orderId: string, shipmentId: string, payload: Record<string, unknown>, expectedUpdatedAt: string, idempotencyKey: string) {
  return miniRequest<MiniOrder>(`/api/v1/mini/orders/${orderId}/shipments/${shipmentId}/complete-installation`, { method: "POST", body: payload, expectedUpdatedAt, idempotencyKey });
}

export function reportMiniInstallationProgress(orderId: string, shipmentId: string, payload: Record<string, unknown>, expectedUpdatedAt: string, idempotencyKey: string) {
  return miniRequest<MiniOrder>(`/api/v1/mini/orders/${orderId}/shipments/${shipmentId}/installation-progress`, { method: "POST", body: payload, expectedUpdatedAt, idempotencyKey });
}

export function uploadMiniAttachment(orderId: string, filePath: string, category: string, productionAreaId?: string, originalName?: string) {
  return miniUpload<{ id: string }>(`/api/v1/mini/attachments/${orderId}`, filePath, { category, ...(productionAreaId ? { productionAreaId } : {}), ...(originalName ? { originalName } : {}) });
}

type ApiAfterSales = Omit<MiniAfterSalesCase, "customerName" | "salesNumber" | "statusLabel" | "warrantyLabel"> & {
  order: { customerName: string; salesNumber: string | null; trackingSerial: string };
  warrantyStartsAt?: string | null;
  warrantyExpiresAt?: string | null;
};

export async function loadMiniAfterSalesCases(): Promise<MiniAfterSalesCase[]> {
  if (runtime.mode === "mock") return getMockAfterSalesCases();
  const rows = await miniRequest<ApiAfterSales[]>("/api/v1/mini/aftersales");
  return rows.map((item) => ({
    id: item.id, caseNumber: item.caseNumber, orderId: item.orderId, customerName: item.order.customerName,
    salesNumber: item.order.salesNumber ?? item.order.trackingSerial, issueType: item.issueType, description: item.description, status: item.status,
    statusLabel: item.status === "OPEN" ? "新问题" : item.status === "IN_PROGRESS" ? "处理中" : "已解决",
    warrantyLabel: item.warrantyExpiresAt ? `质保至 ${String(item.warrantyExpiresAt).slice(0, 10)}` : "无自动质保期",
    updatedAt: item.updatedAt, resolution: item.resolution, costSubtotal: item.costSubtotal, costStatus: item.costStatus,
    costBatches: item.costBatches?.map((batch) => ({ ...batch, incurredOn: String(batch.incurredOn).slice(0, 10) })),
  }));
}

export function addMiniAfterSalesCostBatch(caseId: string, payload: { incurredOn: string; amount: number; description: string; attachmentIds: string[] }, expectedUpdatedAt: string, idempotencyKey: string) {
  return miniRequest(`/api/v1/mini/aftersales/${encodeURIComponent(caseId)}/cost-batches`, { method: "POST", body: payload, expectedUpdatedAt, idempotencyKey });
}

export function voidMiniAfterSalesCostBatch(caseId: string, batchId: string, reason: string, expectedUpdatedAt: string, idempotencyKey: string) {
  return miniRequest(`/api/v1/mini/aftersales/${encodeURIComponent(caseId)}/cost-batches/${encodeURIComponent(batchId)}/void`, { method: "POST", body: { reason }, expectedUpdatedAt, idempotencyKey });
}

export function transitionMiniAfterSales(caseId: string, action: "START" | "RESOLVE", resolution: string | undefined, expectedUpdatedAt: string, idempotencyKey: string) {
  return miniRequest(`/api/v1/mini/aftersales/${caseId}/actions`, { method: "POST", body: { action, resolution }, expectedUpdatedAt, idempotencyKey });
}

export function createMiniAfterSales(payload: { orderId: string; issueType: string; description: string; incurredOn: string; amount: number; attachmentIds: string[] }, expectedUpdatedAt: string, idempotencyKey: string) {
  return miniRequest("/api/v1/mini/aftersales", { method: "POST", body: payload, expectedUpdatedAt, idempotencyKey });
}
