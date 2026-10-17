import assert from "node:assert/strict";
import test from "node:test";
import { WORKSHOP_PROCESS_TEMPLATES } from "./workshop-processes.js";
import { projectActionableProductionTasks } from "./production-task-projection.js";

const actor = { id: "woodmake", role: "WORKSHOP", level: "STAFF", department: "木工（实木）车间", workshop: "WOOD", processCodes: ["WOOD-02", "WOOD-04", "WOOD-05"] };
const processes = WORKSHOP_PROCESS_TEMPLATES.WOOD.map((processName, index) => ({ id: `p${index + 1}`, workshop: "WOOD", workshopLabel: "木工（实木）车间", processCode: `WOOD-${String(index + 1).padStart(2, "0")}`, processName, sequence: index + 1, plannedQty: 4, completedQty: index === 0 ? 4 : 0, unit: "件", status: index === 0 ? "COMPLETE" : "PENDING" }));
const order = { id: "o1", trackingSerial: "GD-1", productionNumber: "26081101", customerName: "测试客户", stage: "PRODUCTION", rush: false, internalDueAt: new Date("2026-09-30T09:00:00Z"), productionProcesses: processes, tasks: [{ dueAt: new Date("2026-09-20T09:00:00Z"), plannedStartAt: null, workloadDays: null }] };

test("worker personal queue shows only assigned processes whose predecessors are complete", () => {
  const tasks = projectActionableProductionTasks(actor, [order], new Date("2026-09-01T00:00:00Z"));
  assert.deepEqual(tasks.map((task) => task.processCode), ["WOOD-02"]);
  assert.equal(tasks[0]?.title, "制作1报工（0/4件）");
  assert.equal(tasks[0]?.order.productionNumber, "26081101");
});

test("worker personal queue advances to the next assigned process only after intermediate work completes", () => {
  const progressed = processes.map((process) => process.processCode === "WOOD-02" || process.processCode === "WOOD-03" ? { ...process, completedQty: 4, status: "COMPLETE" } : process);
  const tasks = projectActionableProductionTasks(actor, [{ ...order, productionProcesses: progressed }], new Date("2026-09-01T00:00:00Z"));
  assert.deepEqual(tasks.map((task) => task.processCode), ["WOOD-04"]);
});

test("locked, completed and unassigned processes never enter the worker queue", () => {
  const locked = projectActionableProductionTasks(actor, [{ ...order, productionProcesses: processes.map((process) => process.sequence === 1 ? { ...process, completedQty: 0, status: "PENDING" } : process) }]);
  assert.equal(locked.length, 0);
  assert.equal(projectActionableProductionTasks({ ...actor, processCodes: ["WOOD-03"] }, [order]).length, 0);
  assert.equal(projectActionableProductionTasks({ ...actor, level: "SUPERVISOR" }, [order]).length, 0);
});

test("路线采购未释放时不进入车间待办，释放后显示区域和路线", () => {
  const routeProcesses = processes.map((process) => ({
    ...process,
    productionAreaId: "area-living-room",
    productionArea: { id: "area-living-room", name: "客厅", productionNumber: "26081102" },
    productionRouteId: "route-wood",
    productionRoute: { id: "route-wood", kind: "WOOD_PAINT" as const, releasedAt: null as Date | null },
  }));
  const locked = projectActionableProductionTasks(actor, [{ ...order, productionProcesses: routeProcesses }]);
  assert.equal(locked.length, 0);

  const released = routeProcesses.map((process) => ({
    ...process,
    productionRoute: { ...process.productionRoute, releasedAt: new Date("2026-09-01T00:00:00Z") },
  }));
  const tasks = projectActionableProductionTasks(actor, [{ ...order, productionProcesses: released }]);
  assert.equal(tasks[0]?.title, "客厅 · 实木油漆路线 · 制作1报工（0/4件）");
  assert.equal(tasks[0]?.order.productionNumber, "26081102");
});
