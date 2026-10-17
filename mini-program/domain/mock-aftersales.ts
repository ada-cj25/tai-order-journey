import { getMockShipmentState } from "./mock-shipment-state";
import type { MiniAfterSalesCase, MiniAfterSalesCostBatch, MiniEmployee, MiniOrder } from "./types";

const STORAGE_KEY = "tai-mini-aftersales-cases";
const seed: MiniAfterSalesCase[] = [
  { id: "after-1", caseNumber: "TEST-SH-2026-0008", orderId: "TEST-DEMO-MINI-001", customerName: "方女士", salesNumber: "N26070036", issueType: "五金调整", description: "柜门铰链异响，需上门检查", status: "OPEN", statusLabel: "新问题", warrantyLabel: "诺尔丽质保期内", updatedAt: "2026-09-13T18:40:00+08:00", costSubtotal: 0, costStatus: "CUMULATIVE", costBatches: [] },
  { id: "after-2", caseNumber: "TEST-SH-2026-0011", orderId: "TEST-DEMO-LIN-ORDER-002", customerName: "林女士", salesNumber: "N26080049", issueType: "门板调整", description: "洗手台门板高低差调整", status: "IN_PROGRESS", statusLabel: "处理中", warrantyLabel: "诺尔丽质保期内", updatedAt: "2026-09-13T18:40:00+08:00", costSubtotal: 0, costStatus: "CUMULATIVE", costBatches: [] },
];

function read(): MiniAfterSalesCase[] {
  const saved = wx.getStorageSync<MiniAfterSalesCase[]>(STORAGE_KEY);
  return Array.isArray(saved) ? saved : seed;
}

function save(cases: MiniAfterSalesCase[]): void { wx.setStorageSync(STORAGE_KEY, cases); }
function requireAfterSales(employee: MiniEmployee | null): void { if (employee?.role !== "AFTERSALES") throw new Error("只有售后人员可以办理售后"); }
function validDate(value: string): boolean {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month! - 1 && parsed.getUTCDate() === day;
}
function validCost(incurredOn: string, amount: number, description: string): void {
  if (!validDate(incurredOn)) throw new Error("请选择有效的费用发生日期");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("费用金额必须大于 0");
  if (!description.trim()) throw new Error("请填写费用说明");
}
function subtotal(batches: MiniAfterSalesCostBatch[]): number {
  return Math.round(batches.filter((item) => !item.voidedAt).reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
}

export function getMockAfterSalesCases(): MiniAfterSalesCase[] { return JSON.parse(JSON.stringify(read())) as MiniAfterSalesCase[]; }

export function createMockAfterSalesCase(order: MiniOrder, employee: MiniEmployee | null, input: { issueType: string; description: string; incurredOn: string; amount: number; attachmentIds?: string[]; attachments?: MiniAfterSalesCostBatch["attachments"] }): MiniAfterSalesCase {
  requireAfterSales(employee);
  if (order.stageLabel !== "验收完成") throw new Error("订单完成客户验收后才能登记售后");
  if (!input.issueType.trim() || !input.description.trim()) throw new Error("请填写问题类型和事实说明");
  validCost(input.incurredOn, input.amount, input.description);
  const now = new Date().toISOString();
  const cases = read();
  const year = now.slice(0, 4);
  const next = cases.filter((item) => item.caseNumber.startsWith(`TEST-SH-${year}-`)).reduce((max, item) => Math.max(max, Number(item.caseNumber.slice(-4)) || 0), 0) + 1;
  const acceptance = getMockShipmentState(order.id).acceptance;
  const warrantyYears = order.businessType?.startsWith("NOERLI") ? 20 : order.businessType?.startsWith("AIKEJU") ? 10 : null;
  const warrantyLabel = acceptance && warrantyYears ? `${warrantyYears}年质保 · ${acceptance.acceptedAt}起` : warrantyYears ? "质保起始日待核对" : "无自动质保期";
  const batch: MiniAfterSalesCostBatch = { id: `mock-cost-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, incurredOn: input.incurredOn, amount: input.amount, description: `本次问题：${input.description.trim()}`, recordedAt: now, attachmentIds: input.attachmentIds ?? [], attachments: input.attachments ?? [] };
  const result: MiniAfterSalesCase = { id: `mock-after-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, caseNumber: `TEST-SH-${year}-${String(next).padStart(4, "0")}`, orderId: order.id, customerName: order.customerName, salesNumber: order.salesNumber ?? order.trackingSerial, issueType: input.issueType.trim(), description: input.description.trim(), status: "OPEN", statusLabel: "新问题", warrantyLabel, updatedAt: now, costSubtotal: input.amount, costStatus: "CUMULATIVE", costBatches: [batch] };
  save([result, ...cases]);
  return result;
}

export function transitionMockAfterSalesCase(caseId: string, employee: MiniEmployee | null, action: "START" | "RESOLVE", resolution?: string): void {
  requireAfterSales(employee);
  const cases = read();
  const row = cases.find((item) => item.id === caseId);
  if (!row) throw new Error("售后单不存在");
  if (action === "START" && row.status !== "OPEN") throw new Error("只有新问题可以开始处理");
  if (action === "RESOLVE" && (row.status !== "IN_PROGRESS" || !resolution?.trim())) throw new Error("请先开始处理并填写结果");
  row.status = action === "START" ? "IN_PROGRESS" : "RESOLVED";
  row.statusLabel = action === "START" ? "处理中" : "已解决";
  if (action === "RESOLVE") row.resolution = resolution!.trim();
  row.updatedAt = new Date().toISOString();
  save(cases);
}

export function addMockAfterSalesCostBatch(caseId: string, employee: MiniEmployee | null, input: { incurredOn: string; amount: number; description: string; attachmentIds?: string[]; attachments?: MiniAfterSalesCostBatch["attachments"] }): void {
  requireAfterSales(employee);
  validCost(input.incurredOn, input.amount, input.description);
  const cases = read();
  const row = cases.find((item) => item.id === caseId);
  if (!row) throw new Error("售后单不存在");
  const now = new Date().toISOString();
  row.costBatches = [{ id: `mock-cost-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, incurredOn: input.incurredOn, amount: input.amount, description: input.description.trim(), attachmentIds: input.attachmentIds ?? [], attachments: input.attachments ?? [], recordedAt: now }, ...(row.costBatches ?? [])];
  row.costSubtotal = subtotal(row.costBatches);
  row.updatedAt = now;
  save(cases);
}

export function voidMockAfterSalesCostBatch(caseId: string, batchId: string, employee: MiniEmployee | null, reason: string): void {
  requireAfterSales(employee);
  if (!reason.trim()) throw new Error("请填写作废原因");
  const cases = read();
  const row = cases.find((item) => item.id === caseId);
  const batch = row?.costBatches?.find((item) => item.id === batchId);
  if (!row || !batch || batch.voidedAt) throw new Error("可作废的费用记录不存在");
  const now = new Date().toISOString();
  batch.voidedAt = now;
  batch.voidReason = reason.trim();
  row.costSubtotal = subtotal(row.costBatches ?? []);
  row.updatedAt = now;
  save(cases);
}
