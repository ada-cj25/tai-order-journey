import { productionProcessAvailability, canReportProductionProcess } from "./production-progress.js";
import { PRODUCTION_ROUTE_LABELS } from "./route-execution.js";
import { sortTasksByUrgency, taskUrgency } from "./task-priority.js";
import { shanghaiBusinessDate } from "./business-date.js";

type WorkshopActor = {
  id: string;
  role: string;
  level?: string | null;
  workshop?: string | null;
  processCode?: string | null;
  processCodes?: readonly string[];
};

type WorkbenchProcess = {
  id: string;
  productionAreaId?: string | null;
  productionArea?: { id: string; name: string; productionNumber: string; cancelledAt?: Date | null } | null;
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
  metricMode?: string;
  status: string;
  startedAt?: Date | null;
  completedAt?: Date | null;
  lastReportedAt?: Date | null;
  updatedAt: Date;
};

type WorkbenchOrder = {
  id: string;
  trackingSerial: string;
  salesNumber?: string | null;
  productionNumber?: string | null;
  customerName: string;
  stage: string;
  rush: boolean;
  internalDueAt: Date;
  updatedAt: Date;
  productionProcesses: WorkbenchProcess[];
  tasks: Array<{ dueAt: Date; plannedStartAt?: Date | null; workloadDays?: number | null }>;
};

export type WorkshopTaskState = "ACTIONABLE" | "IN_PROGRESS" | "WAITING" | "ISSUE" | "COMPLETED_TODAY";

function dayKey(value: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

function dueLabel(value: Date) {
  const parts = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `车间最晚完成 · ${values.month}月${values.day}日`;
}

function processStatus(status: string, available: boolean) {
  if (status === "COMPLETE") return "DONE";
  if (status === "ISSUE") return "ISSUE";
  if (!available) return "LOCKED";
  if (status === "IN_PROGRESS") return "IN_PROGRESS";
  return "READY";
}

function statusLabel(state: WorkshopTaskState, waitingReason: string | null) {
  if (state === "COMPLETED_TODAY") return "今日已完成";
  if (state === "WAITING") return waitingReason ?? "等待前序工序完成";
  if (state === "ISSUE") return "存在异常";
  if (state === "IN_PROGRESS") return "加工中";
  return "可报工";
}

function urgencyLabel(urgency: string) {
  return urgency === "OVERDUE" ? "已逾期" : urgency === "RUSH" ? "加急" : urgency === "DUE_SOON" ? "24小时内到期" : "按计划";
}

export function projectWorkshopWorkbench(employee: WorkshopActor, orders: WorkbenchOrder[], now = new Date()) {
  const today = dayKey(shanghaiBusinessDate(now));
  const cards = orders.flatMap((order) => {
    const schedule = order.tasks[0];
    const dueAt = schedule?.dueAt ?? order.internalDueAt;
    return order.productionProcesses
      .filter((process) => !["REFERENCE_CONFIRMATION", "PACKAGE_COUNT"].includes(process.metricMode ?? ""))
      .filter((process) => !process.productionArea?.cancelledAt)
      .filter((process) => canReportProductionProcess(employee, process))
      .filter((process) => process.status !== "COMPLETE" || (process.completedAt && dayKey(process.completedAt) === today))
      .map((process) => {
        const siblings = order.productionProcesses.filter((candidate) => process.productionRouteId
          ? candidate.productionRouteId === process.productionRouteId
          : candidate.productionAreaId === process.productionAreaId);
        const availability = process.status === "COMPLETE"
          ? { available: false, reason: null }
          : productionProcessAvailability(siblings, { ...process, productionRouteReleasedAt: process.productionRoute?.releasedAt });
        const state: WorkshopTaskState = process.status === "COMPLETE"
          ? "COMPLETED_TODAY"
          : process.status === "ISSUE"
            ? "ISSUE"
            : !availability.available
              ? "WAITING"
              : process.status === "IN_PROGRESS" || Number(process.completedQty) > 0
                ? "IN_PROGRESS"
                : "ACTIONABLE";
        const urgency = taskUrgency({ dueAt, status: dueAt < now ? "OVERDUE" : "PENDING", order: { rush: order.rush } }, now);
        const area = process.productionArea;
        return {
          id: process.id,
          orderId: order.id,
          title: process.processName,
          subtitle: statusLabel(state, availability.reason),
          workshopLabel: process.workshopLabel,
          customerName: order.customerName,
          salesNumber: order.salesNumber ?? null,
          trackingSerial: order.trackingSerial,
          productionAreaId: area?.id ?? process.productionAreaId ?? "legacy",
          productionAreaName: area?.name ?? "历史整单生产",
          productionNumber: area?.productionNumber ?? order.productionNumber ?? "未分配生产编号",
          routeId: process.productionRoute?.id ?? process.productionRouteId ?? undefined,
          routeKind: process.productionRoute?.kind,
          routeLabel: process.productionRoute ? PRODUCTION_ROUTE_LABELS[process.productionRoute.kind] : "历史整单路线",
          processId: process.id,
          processCode: process.processCode,
          plannedQty: Number(process.plannedQty),
          completedQty: Number(process.completedQty),
          unit: process.unit,
          dueAt,
          dueLabel: dueLabel(dueAt),
          status: processStatus(process.status, availability.available),
          state,
          statusLabel: statusLabel(state, availability.reason),
          urgency,
          urgencyLabel: urgencyLabel(urgency),
          waitingReason: availability.available ? null : availability.reason,
          canReport: process.status !== "COMPLETE" && availability.available,
          startedAt: process.startedAt ?? null,
          lastReportedAt: process.lastReportedAt ?? null,
          updatedAt: process.updatedAt,
          orderUpdatedAt: order.updatedAt,
          rush: order.rush,
        };
      });
  });

  const unfinished = cards.filter((card) => card.state !== "COMPLETED_TODAY");
  const completedToday = cards.filter((card) => card.state === "COMPLETED_TODAY");
  const actionable = sortTasksByUrgency(unfinished.filter((card) => card.canReport).map((card) => ({ ...card, order: { rush: card.rush } })), now)
    .map(({ order: _order, ...card }) => card);
  const allUnfinished = sortTasksByUrgency(unfinished.map((card) => ({ ...card, order: { rush: card.rush } })), now)
    .map(({ order: _order, ...card }) => card);
  const updatedAt = cards.reduce((latest, card) => card.updatedAt > latest ? card.updatedAt : latest, new Date(0));

  return {
    summary: {
      allUnfinished: allUnfinished.length,
      actionable: actionable.length,
      waiting: allUnfinished.filter((card) => card.state === "WAITING").length,
      issue: allUnfinished.filter((card) => card.state === "ISSUE").length,
      completedToday: completedToday.length,
    },
    actionable,
    allUnfinished,
    completedToday,
    serverTime: now,
    updatedAt: updatedAt.getTime() > 0 ? updatedAt : now,
  };
}
