import { runtime } from "../config/runtime";
import { getMockPackageSummary, getOrders, runMockPackageCountCommand } from "../domain/store";
import type { MiniPackageSummary } from "../domain/types";
import type { MiniPackageAction } from "../domain/package-workbench";
import { miniRequest } from "./client";

export function loadPackageWorkbench(): Promise<MiniPackageAction[]> {
  if (runtime.mode !== "mock") return miniRequest<MiniPackageAction[]>("/api/v1/mini/workshop/package-workbench");
  return Promise.resolve(getOrders().filter((order) => order.stageIndex >= 6 && order.stageIndex <= 8).flatMap((order) => getMockPackageSummary(order.id).sources
    .filter((source) => source.kind === "HARDWARE_AREA" ? source.status === "FINALIZED" && !source.handoffConfirmed : source.status === "OPEN" && source.canAdd)
    .map((source) => ({ orderId: order.id, customerName: order.customerName, salesNumber: order.salesNumber, trackingSerial: order.trackingSerial,
      productionAreaId: source.productionAreaId ?? "", sourceKey: source.sourceKey, kind: source.kind, label: source.label,
      actionLabel: source.kind === "HARDWARE_AREA" ? "确认领五金" : "统计包件", total: source.total }))));
}

export function loadPackageSummary(orderId: string): Promise<MiniPackageSummary> {
  if (runtime.mode === "mock") return Promise.resolve(getMockPackageSummary(orderId));
  return miniRequest<MiniPackageSummary>(`/api/v1/mini/orders/${encodeURIComponent(orderId)}/package-counts`);
}

export function submitPackageCountCommand(orderId: string, sourceKey: string, command: "ADD_COUNT" | "FINALIZE_SOURCE" | "CONFIRM_HARDWARE_HANDOFF", expectedUpdatedAt: string, quantity?: number): Promise<MiniPackageSummary> {
  if (runtime.mode === "mock") return Promise.resolve(runMockPackageCountCommand(orderId, sourceKey, command, quantity));
  return miniRequest<MiniPackageSummary>(`/api/v1/mini/orders/${encodeURIComponent(orderId)}/package-counts/${encodeURIComponent(sourceKey)}/commands`, {
    method: "POST", body: { command, ...(quantity == null ? {} : { quantity }) }, expectedUpdatedAt,
    idempotencyKey: `mini-package-${orderId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
}
