import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Employee, Prisma } from "./generated/prisma/client.js";
import { salesBusinessTypes } from "./domain/sales-policy.js";
import { costEnabled } from "./runtime-config.js";
import { canReadPaymentAmounts, canReadPaymentReceipt, canUploadPaymentReceipt, type CommercialOrder } from "./domain/commercial-policy.js";

type Actor = Pick<Employee, "id" | "role" | "level" | "businessUnit" | "workshop">;
type Db = Pick<Prisma.TransactionClient, "order" | "attachment">;

export function orderScope(employee: Actor): Prisma.OrderWhereInput {
  if (employee.role === "SALES") {
    const businessType = { in: salesBusinessTypes(employee.businessUnit) };
    // Brand is authoritative even for legacy orders attached to a wrong salesperson
    // or created by an administrator. Representatives must also own the order.
    return employee.level === "SUPERVISOR" ? { businessType, creationMode: "SALES_STANDARD" } : { businessType, creationMode: "SALES_STANDARD", salesId: employee.id };
  }
  if (employee.role === "DESIGNER") return { designerId: employee.id };
  const linkedSupplementCreatedByEmployee: Prisma.OrderWhereInput = { createdById: employee.id, parentOrderId: { not: null } };
  if (employee.role === "WORKSHOP") return { OR: [employee.workshop
    ? { productionProcesses: { some: { workshop: employee.workshop } } }
    : { id: { in: [] } }, linkedSupplementCreatedByEmployee] };
  if (employee.role === "INSTALLER") return { OR: [{ tasks: { some: { ownerId: employee.id } } }, linkedSupplementCreatedByEmployee] };
  if (employee.role === "AFTERSALES") return { OR: [{ stage: "BUSINESS_COMPLETE" }, linkedSupplementCreatedByEmployee] };
  if (["CHAIRMAN", "ORDER_ADMIN", "FINANCE", "PROCUREMENT", "TECHNICAL"].includes(employee.role)) return {};
  return { id: { in: [] } };
}

export async function requireOrder(db: Db, orderId: string, employee: Actor) {
  const order = await db.order.findFirst({ where: { id: orderId, ...orderScope(employee) } });
  if (!order) throw new NotFoundException("订单不存在或无权访问");
  return order;
}

function commercialOrder(value?: string | null | CommercialOrder): CommercialOrder {
  return typeof value === "object" && value !== null ? value : { salesId: value ?? null, creationMode: "SALES_STANDARD", chargeMode: "CHARGED" };
}

export function canReadFinancialEvidence(employee: Pick<Employee, "id" | "role">, order?: string | null | CommercialOrder) {
  return canReadPaymentAmounts(employee, commercialOrder(order));
}

export function canReadContractAmount(employee: Pick<Employee, "role">) {
  return ["CHAIRMAN", "ORDER_ADMIN", "FINANCE", "SALES", "DESIGNER"].includes(employee.role);
}

const PAYMENT_RECEIPT_CATEGORIES = new Set(["DEPOSIT_RECEIPT", "PREPAYMENT_RECEIPT", "TAIL_PAYMENT_RECEIPT", "PAYMENT_RECEIPT"]);
const AFTERSALES_COST_CATEGORIES = new Set(["AFTERSALES_COST"]);

export function canReadAttachment(employee: Pick<Employee, "id" | "role">, category: string, order?: string | null | CommercialOrder) {
  if (AFTERSALES_COST_CATEGORIES.has(category)) return costEnabled() && ["AFTERSALES", "FINANCE", "CHAIRMAN"].includes(employee.role);
  if (!PAYMENT_RECEIPT_CATEGORIES.has(category)) return true;
  return canReadPaymentReceipt(employee, commercialOrder(order));
}

export function canUploadAttachment(employee: Pick<Employee, "id" | "role">, category: string, order?: string | null | CommercialOrder) {
  if (AFTERSALES_COST_CATEGORIES.has(category)) return costEnabled() && ["AFTERSALES", "CHAIRMAN"].includes(employee.role);
  if (!PAYMENT_RECEIPT_CATEGORIES.has(category)) return canReadAttachment(employee, category, order);
  return canUploadPaymentReceipt(employee, commercialOrder(order));
}

export function redactPaymentReceiptReferences(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactPaymentReceiptReferences);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "receiptAttachmentIds")
    .map(([key, item]) => [key, redactPaymentReceiptReferences(item)]));
}

export async function requireAttachment(db: Db, id: string, employee: Actor) {
  const attachment = await db.attachment.findUnique({ where: { id } });
  if (!attachment) throw new NotFoundException("附件不存在或无权访问");
  const order = await requireOrder(db, attachment.orderId, employee);
  if (!canReadAttachment(employee, attachment.category, order)) throw new ForbiddenException("当前角色无权访问该附件类别");
  return attachment;
}

export function attachmentIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const result = new Set<string>();
  for (const [key, value] of Object.entries(payload)) {
    if (/attachmentIds$/i.test(key) && Array.isArray(value)) value.forEach((id) => { if (typeof id === "string") result.add(id); });
    else if (/attachmentId$/i.test(key) && typeof value === "string") result.add(value);
    else if (value && typeof value === "object") attachmentIds(value).forEach((id) => result.add(id));
  }
  return [...result];
}

export async function validateOrderAttachments(db: Db, orderId: string, payload: unknown, employee: Actor, command?: string) {
  const ids = attachmentIds(payload);
  if (!ids.length) return;
  const files = await db.attachment.findMany({ where: { id: { in: ids }, orderId } });
  const hasPaymentReceipt = files.some((file) => PAYMENT_RECEIPT_CATEGORIES.has(file.category));
  const order = hasPaymentReceipt ? await requireOrder(db, orderId, employee) : null;
  if (files.length !== ids.length || files.some((file) => !canReadAttachment(employee, file.category, order ?? undefined))) throw new ForbiddenException("附件必须属于当前订单且在当前角色权限内");
  const categories: Record<string, string> = {
    cadAttachmentIds: "DESIGN_CAD", confirmationAttachmentIds: "DESIGN_CONFIRMATION", sampleBlockAttachmentIds: "CUSTOMER_SAMPLE_BLOCK",
    haixunAttachmentIds: "HAIXUN_EXPORT", decompositionAttachmentIds: "DECOMPOSITION_SHEET", hardwareMaterialAttachmentIds: "HARDWARE_MATERIALS",
    paintWoodAttachmentIds: "PAINT_WOOD", solidWoodDoorAttachmentIds: "SOLID_WOOD_DOOR", veneerDoorAttachmentIds: "VENEER_DOOR",
    photoAttachmentIds: "INSTALLATION_PHOTO", acceptanceAttachmentIds: "CUSTOMER_ACCEPTANCE",
    ...(command === "REPORT_DEPOSIT" ? { receiptAttachmentIds: "DEPOSIT_RECEIPT" } : command === "REPORT_PREPAYMENT" ? { receiptAttachmentIds: "PREPAYMENT_RECEIPT" } : command === "REPORT_TAIL_PAYMENT" ? { receiptAttachmentIds: "TAIL_PAYMENT_RECEIPT" } : {}),
  };
  for (const [field, category] of Object.entries(categories)) {
    const references = (payload as Record<string, unknown>)[field];
    if (Array.isArray(references) && references.some((id) => files.find((file) => file.id === id)?.category !== category)) throw new ForbiddenException("附件类别与业务凭证不符，请在对应上传栏重新上传");
  }
}

export function redactOrderCosts<T extends Record<string, unknown>>(order: T, role: string) {
  if (costEnabled() && ["FINANCE", "CHAIRMAN"].includes(role)) return { ...order };
  const sensitive = /^materialCost|^cost|margin|profit|^unitCost$|^unitPrice$|^totalCost$|^pricedSubtotal$|^priceVersions?$|^currentPrice$|^missingPriceCount$/i;
  const scrub = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).filter(([key]) => !sensitive.test(key)).map(([key, item]) => [key, scrub(item)]));
    return value;
  };
  return scrub(order) as Record<string, unknown>;
}

export function redactOrderFinancialAmounts<T>(value: T, employee: Pick<Employee, "id" | "role">, order?: string | null | CommercialOrder): T {
  const canReadPayments = canReadFinancialEvidence(employee, order);
  const canReadContract = canReadContractAmount(employee);
  if (canReadPayments && canReadContract) return value;
  const contractSensitive = /^(amount|contractAmount|previousAmount|newAmount)$/i;
  const paymentSensitive = /^(receivedAmount|depositAmount|prepaymentAmount|tailPaymentAmount|depositReceived|prepaymentReceived|initialPaymentTotal|tailReceivable)$/i;
  const scrub = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(scrub);
    if (item && typeof item === "object" && Object.getPrototypeOf(item) === Object.prototype) {
      return Object.fromEntries(Object.entries(item)
        .filter(([key]) => !((!canReadContract && contractSensitive.test(key)) || (!canReadPayments && paymentSensitive.test(key))))
        .map(([key, nested]) => [key, scrub(nested)]));
    }
    return item;
  };
  return scrub(value) as T;
}
