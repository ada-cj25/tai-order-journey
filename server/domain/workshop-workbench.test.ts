import assert from "node:assert/strict";
import test from "node:test";
import { projectWorkshopWorkbench } from "./workshop-workbench.js";

const actor = { id: "worker-drill", role: "WORKSHOP", level: "STAFF", workshop: "PANEL", processCodes: ["PANEL-03"] };

function areaProcesses(orderId: string, areaIndex: number, available: boolean) {
  const productionArea = { id: `${orderId}-area-${areaIndex}`, name: `区域${areaIndex}`, productionNumber: `${orderId}-P-${areaIndex}`, cancelledAt: null };
  const productionRoute = { id: `${orderId}-route-${areaIndex}`, kind: "PANEL" as const, releasedAt: new Date("2026-09-01T00:00:00Z") };
  return [
    { id: `${orderId}-a${areaIndex}-cut`, processCode: "PANEL-01", processName: "开料", sequence: 1, status: "COMPLETE" },
    { id: `${orderId}-a${areaIndex}-edge`, processCode: "PANEL-02", processName: "封边", sequence: 2, status: available ? "COMPLETE" : "IN_PROGRESS" },
    { id: `${orderId}-a${areaIndex}-drill`, processCode: "PANEL-03", processName: "打孔", sequence: 3, status: "PENDING" },
  ].map((process) => ({
    ...process,
    productionAreaId: productionArea.id,
    productionArea,
    productionRouteId: productionRoute.id,
    productionRoute,
    workshop: "PANEL",
    workshopLabel: "板式车间",
    plannedQty: 20,
    completedQty: 0,
    unit: "㎡",
    metricMode: "AREA_QUANTITY",
    startedAt: null,
    completedAt: process.status === "COMPLETE" ? new Date("2026-09-10T00:00:00Z") : null,
    lastReportedAt: null,
    updatedAt: new Date("2026-09-12T00:00:00Z"),
  }));
}

function order(id: string, customerName: string, availability: boolean[]) {
  return {
    id,
    trackingSerial: `TRACK-${id}`,
    salesNumber: `N-${id}`,
    productionNumber: null,
    customerName,
    stage: "PRODUCTION",
    rush: false,
    internalDueAt: new Date("2026-09-16T09:00:00Z"),
    updatedAt: new Date("2026-09-13T00:00:00Z"),
    productionProcesses: availability.flatMap((available, index) => areaProcesses(id, index + 1, available)),
    tasks: [{ dueAt: new Date("2026-09-16T09:00:00Z"), plannedStartAt: null, workloadDays: null }],
  };
}

test("workshop workbench exposes six assigned areas but only four unlocked tasks", () => {
  const result = projectWorkshopWorkbench(actor, [
    order("zhou", "周女士", [true, false, false]),
    order("lin", "林先生", [true, true, true]),
  ], new Date("2026-09-13T00:00:00Z"));

  assert.equal(result.summary.allUnfinished, 6);
  assert.equal(result.summary.actionable, 4);
  assert.equal(result.summary.waiting, 2);
  assert.equal(result.actionable.every((task) => task.processCode === "PANEL-03" && task.canReport), true);
  assert.deepEqual(new Set(result.allUnfinished.map((task) => task.customerName)), new Set(["周女士", "林先生"]));
  assert.match(result.allUnfinished.find((task) => task.state === "WAITING")?.waitingReason ?? "", /前序工序/);
});

test("unassigned workshop processes never appear in a worker workbench", () => {
  const result = projectWorkshopWorkbench({ ...actor, processCodes: ["PANEL-04"] }, [order("zhou", "周女士", [true])]);
  assert.equal(result.summary.allUnfinished, 0);
  assert.equal(result.summary.actionable, 0);
});
