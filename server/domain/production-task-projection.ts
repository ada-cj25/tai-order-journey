import { canReportProductionProcess, productionProcessAvailability } from "./production-progress.js";
import { PRODUCTION_ROUTE_LABELS } from "./route-execution.js";

type Actor = {
  id: string;
  role: string;
  level?: string | null;
  department: string;
  workshop?: string | null;
  processCode?: string | null;
  processCodes?: readonly string[];
};

type Process = {
  id: string;
  productionAreaId?: string | null;
  productionArea?: { id: string; name: string; productionNumber: string } | null;
  productionRouteId?: string | null;
  productionRoute?: { id: string; kind: "PANEL" | "WOOD_PAINT"; releasedAt?: Date | null } | null;
  workshop: string;
  workshopLabel: string;
  processCode: string;
  processName: string;
  sequence: number;
  plannedQty: unknown;
  completedQty: unknown;
  unit: string;
  status: string;
  metricMode?: string;
};

type ProductionOrder = {
  id: string;
  trackingSerial: string;
  salesNumber?: string | null;
  productionNumber: string | null;
  customerName: string;
  stage: string;
  rush: boolean;
  internalDueAt: Date;
  productionProcesses: Process[];
  tasks: Array<{ dueAt: Date; plannedStartAt: Date | null; workloadDays: number | null }>;
};

export function projectActionableProductionTasks(employee: Actor, orders: ProductionOrder[], now = new Date()) {
  if (employee.role !== "WORKSHOP" || employee.level !== "STAFF" || !employee.workshop) return [];

  return orders.flatMap((order) => {
    const workshopSchedule = order.tasks[0];
    const dueAt = workshopSchedule?.dueAt ?? order.internalDueAt;
    return order.productionProcesses
      .filter((process) => process.status !== "COMPLETE")
      .filter((process) => !["REFERENCE_CONFIRMATION", "PACKAGE_COUNT"].includes(process.metricMode ?? ""))
      .filter((process) => canReportProductionProcess(employee, process))
      .filter((process) => productionProcessAvailability(
        order.productionProcesses.filter((candidate) => process.productionRouteId ? candidate.productionRouteId === process.productionRouteId : candidate.productionAreaId === process.productionAreaId),
        { ...process, productionRouteReleasedAt: process.productionRoute?.releasedAt },
      ).available)
      .map((process) => ({
        id: `production-process:${process.id}`,
        orderId: order.id,
        ownerId: employee.id,
        department: process.workshopLabel,
        title: `${process.productionArea?.name ? `${process.productionArea.name} · ` : ""}${process.productionRoute ? `${PRODUCTION_ROUTE_LABELS[process.productionRoute.kind]} · ` : ""}${process.processName}报工（${Number(process.completedQty)}/${Number(process.plannedQty)}${process.unit}）`,
        stage: "PRODUCTION",
        workshop: process.workshop,
        productionRouteId: process.productionRouteId ?? null,
        processId: process.id,
        processCode: process.processCode,
        dueAt,
        plannedStartAt: workshopSchedule?.plannedStartAt ?? null,
        workloadDays: workshopSchedule?.workloadDays ?? null,
        reminderAt: dueAt,
        status: dueAt < now ? "OVERDUE" : "PENDING",
        completedAt: null,
        delayDays: 0,
        uniqueKey: `${order.id}:PRODUCTION:${process.productionRouteId ?? process.productionAreaId ?? "legacy"}:${process.processCode}`,
        createdAt: dueAt,
        updatedAt: dueAt,
        order: {
          id: order.id,
          trackingSerial: order.trackingSerial,
          salesNumber: order.salesNumber,
          productionNumber: process.productionArea?.productionNumber ?? order.productionNumber,
          productionArea: process.productionArea ?? null,
          customerName: order.customerName,
          stage: order.stage,
          rush: order.rush,
        },
      }));
  });
}
