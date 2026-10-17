import assert from "node:assert/strict";
import test from "node:test";
import { areaProgressPercent, clampPercent, groupWorkshopTasks, orderProgressPercent, selectWorkshopTasks, sortWorkshopTasks, summarizeProductionAreas, taskProgressPercent, visibleNextTasks } from "../domain/projections";
import type { MiniOrder, MiniProductionArea, MiniTask } from "../domain/types";

test("progress projections clamp invalid and out-of-range values", () => {
  assert.equal(clampPercent(Number.NaN), 0);
  assert.equal(clampPercent(-4), 0);
  assert.equal(clampPercent(112), 100);
});

test("order and quantity progress use persisted numerator and denominator", () => {
  assert.equal(orderProgressPercent({ stageIndex: 4, stageTotal: 9, areaSummary: { percent: 0 } } as MiniOrder), 44);
  assert.equal(orderProgressPercent({ stageIndex: 6, stageTotal: 9, areaSummary: { percent: 20 } } as MiniOrder), 67);
  assert.equal(orderProgressPercent({ stageIndex: 9, stageTotal: 9 } as MiniOrder), 100);
  assert.equal(taskProgressPercent({ plannedQty: 32, completedQty: 18, status: "READY" } as MiniTask), 56);
});

test("next-task projection exposes only the following two steps", () => {
  const tasks = ["a", "b", "c", "d"].map((id) => ({ id } as MiniTask));
  assert.deepEqual(visibleNextTasks(tasks, "b").map((task) => task.id), ["c", "d"]);
});

test("each production area derives progress only from its own included processes", () => {
  const area = { workshopFlows: [{ key: "panel", label: "板式", processes: [
    { plannedQty: 32, completedQty: 32, status: "DONE", progressIncluded: true },
    { plannedQty: 32, completedQty: 16, status: "READY", progressIncluded: true },
    { status: "DONE", progressIncluded: false }
  ] }] } as MiniProductionArea;
  assert.equal(areaProgressPercent(area), 75);
});

test("whole-order area summary keeps completed, producing and waiting areas separate", () => {
  const areas = [
    { percent: 100, complete: true },
    { percent: 45, complete: false },
    { percent: 0, complete: false }
  ] as MiniProductionArea[];
  assert.deepEqual(summarizeProductionAreas(areas), { total: 3, completed: 1, inProgress: 1, waiting: 1, percent: 48 });
});

test("worker cards sort by urgency and can be searched across customer, sales and production identities", () => {
  const tasks = [
    { id: "normal", urgency: "NORMAL", dueAt: "2026-09-20", customerName: "周女士", salesNumber: "N001", productionNumber: "P001", productionAreaName: "儿童房", title: "打孔", state: "ACTIONABLE" },
    { id: "overdue", urgency: "OVERDUE", dueAt: "2026-09-10", customerName: "林先生", salesNumber: "N002", productionNumber: "P002", productionAreaName: "书房", title: "打孔", state: "IN_PROGRESS" },
  ] as MiniTask[];
  assert.deepEqual(sortWorkshopTasks(tasks).map((task) => task.id), ["overdue", "normal"]);
  assert.deepEqual(selectWorkshopTasks(tasks, "ALL", "P001").map((task) => task.id), ["normal"]);
  assert.deepEqual(selectWorkshopTasks(tasks, "IN_PROGRESS", "林先生").map((task) => task.id), ["overdue"]);
});

test("tracking groups area tasks by sales order", () => {
  const tasks = [
    { id: "a", orderId: "order-1", customerName: "周女士", salesNumber: "N001" },
    { id: "b", orderId: "order-1", customerName: "周女士", salesNumber: "N001" },
    { id: "c", orderId: "order-2", customerName: "林先生", salesNumber: "N002" },
  ] as MiniTask[];
  assert.deepEqual(groupWorkshopTasks(tasks).map((group) => [group.customerName, group.tasks.length]), [["周女士", 2], ["林先生", 1]]);
});
