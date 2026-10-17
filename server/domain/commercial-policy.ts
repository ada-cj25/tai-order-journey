export type CreationMode = "SALES_STANDARD" | "INTERNAL_EXCEPTION";
export type ChargeMode = "CHARGED" | "FREE";

export type CommercialOrder = {
  creationMode?: CreationMode | null;
  chargeMode?: ChargeMode | null;
  commercialConfirmedAt?: Date | string | null;
  salesId?: string | null;
};

export function allowedCreationModes(role: string): CreationMode[] {
  if (role === "SALES") return ["SALES_STANDARD"];
  if (["DESIGNER", "TECHNICAL", "ORDER_ADMIN"].includes(role)) return ["INTERNAL_EXCEPTION"];
  if (role === "CHAIRMAN") return ["SALES_STANDARD", "INTERNAL_EXCEPTION"];
  return [];
}

const LINKED_SUPPLEMENT_ROLES = new Set(["SALES", "DESIGNER", "TECHNICAL", "ORDER_ADMIN", "CHAIRMAN", "FINANCE", "PROCUREMENT", "WORKSHOP", "INSTALLER", "AFTERSALES"]);

export function canCreateLinkedSupplement(role: string) {
  return LINKED_SUPPLEMENT_ROLES.has(role);
}

export function effectiveCreationMode(requested: CreationMode | undefined, parentMode: CreationMode | null | undefined, role = "") {
  return parentMode ?? requested ?? (role === "SALES" ? "SALES_STANDARD" : "INTERNAL_EXCEPTION");
}

export function isInternalException(order: CommercialOrder) {
  return order.creationMode === "INTERNAL_EXCEPTION";
}

export function isCommerciallyConfirmedFree(order: CommercialOrder) {
  return isInternalException(order) && order.chargeMode === "FREE" && Boolean(order.commercialConfirmedAt);
}

export function tailPaymentSatisfied(order: CommercialOrder & { tailPaymentConfirmed?: boolean | null }) {
  return isCommerciallyConfirmedFree(order) || Boolean(order.tailPaymentConfirmed);
}

export function paymentReporterRole(order: CommercialOrder): "SALES" | "ORDER_ADMIN" | null {
  if (isCommerciallyConfirmedFree(order)) return null;
  return isInternalException(order) ? "ORDER_ADMIN" : "SALES";
}

export function canReportPayment(actor: { id: string; role: string }, order: CommercialOrder) {
  const reporter = paymentReporterRole(order);
  return reporter === "ORDER_ADMIN"
    ? actor.role === "ORDER_ADMIN"
    : reporter === "SALES" && actor.role === "SALES" && actor.id === order.salesId;
}

export function canReadPaymentAmounts(actor: { id: string; role: string }, order: CommercialOrder) {
  if (isInternalException(order)) return ["ORDER_ADMIN", "FINANCE", "CHAIRMAN"].includes(actor.role);
  return ["FINANCE", "CHAIRMAN"].includes(actor.role) || (actor.role === "SALES" && actor.id === order.salesId);
}

export function canReadPaymentReceipt(actor: { id: string; role: string }, order: CommercialOrder) {
  if (isInternalException(order)) return ["ORDER_ADMIN", "FINANCE"].includes(actor.role);
  return actor.role === "FINANCE" || (actor.role === "SALES" && actor.id === order.salesId);
}

export function canUploadPaymentReceipt(actor: { id: string; role: string }, order: CommercialOrder) {
  if (isInternalException(order)) return actor.role === "ORDER_ADMIN";
  return actor.role === "SALES" && actor.id === order.salesId;
}
