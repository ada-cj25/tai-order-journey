import type { ReturnTypeOfPackageSummary } from "./package-count-task-types.js";

type Actor = { id: string; role: string; department: string; workshop?: string | null };
type Order = {
  id: string;
  trackingSerial: string;
  salesNumber?: string | null;
  productionNumber?: string | null;
  customerName: string;
  stage: string;
  rush: boolean;
  internalDueAt: Date;
  productionAreas: Array<{ id: string; name: string; productionNumber: string }>;
  packageSummary: ReturnTypeOfPackageSummary;
};

export function projectActionablePackageCountTasks(employee: Actor, orders: Order[], now = new Date()) {
  const procurement = employee.role === "PROCUREMENT";
  const assembly = employee.role === "WORKSHOP" && employee.workshop === "ASSEMBLY";
  if (!procurement && !assembly) return [];
  return orders.flatMap((order) => {
    const actionable = order.packageSummary.sources.filter((source) => procurement
      ? source.kind === "HARDWARE_AREA" && source.status !== "FINALIZED"
      : source.kind === "HARDWARE_AREA"
        ? source.status === "FINALIZED" && !source.handoffConfirmed && source.canConfirmHandoff
        : source.status !== "FINALIZED" && source.canAdd);
    return actionable.map((source) => {
      const productionArea = source.productionAreaId
        ? order.productionAreas.find((area) => area.id === source.productionAreaId) ?? null
        : null;
      const title = procurement
        ? `${source.label} · 登记并确认包数`
        : source.kind === "HARDWARE_AREA"
          ? `${source.label} · 确认领用 ${source.total} 包`
          : `${source.label} · 登记入库包件`;
      return {
        id: `package-count:${employee.role}:${order.id}:${source.sourceKey}`,
        orderId: order.id,
        ownerId: employee.id,
        department: procurement ? "采购部" : "组装车间",
        title,
        stage: order.stage,
        dueAt: order.internalDueAt,
        reminderAt: order.internalDueAt,
        status: order.internalDueAt < now ? "OVERDUE" : "PENDING",
        completedAt: null,
        delayDays: 0,
        uniqueKey: `${order.id}:PACKAGE_COUNT:${source.sourceKey}`,
        createdAt: order.internalDueAt,
        updatedAt: order.internalDueAt,
        order: {
          id: order.id,
          trackingSerial: order.trackingSerial,
          salesNumber: order.salesNumber,
          productionNumber: productionArea?.productionNumber ?? order.productionNumber,
          productionArea,
          taskScopeLabel: source.kind === "OUTSOURCED_PRODUCT" ? "整单外购" : productionArea ? null : "历史整单生产",
          customerName: order.customerName,
          stage: order.stage,
          rush: order.rush,
        },
      };
    });
  });
}
