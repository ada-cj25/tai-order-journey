import assert from "node:assert/strict";
import test from "node:test";
import { sortTasksByUrgency, taskUrgency } from "./task-priority.js";

test("work queue sorts overdue, rush, near due and normal tasks", () => {
  const now = new Date("2026-08-29T10:00:00+08:00");
  const tasks = [
    { id: "normal", status: "PENDING", dueAt: new Date("2026-09-05T17:00:00+08:00"), order: { rush: false } },
    { id: "rush", status: "PENDING", dueAt: new Date("2026-09-06T17:00:00+08:00"), order: { rush: true } },
    { id: "soon", status: "PENDING", dueAt: new Date("2026-08-30T09:00:00+08:00"), order: { rush: false } },
    { id: "overdue", status: "PENDING", dueAt: new Date("2026-08-28T17:00:00+08:00"), order: { rush: false } },
  ];
  assert.deepEqual(sortTasksByUrgency(tasks, now).map((task) => task.id), ["overdue", "rush", "soon", "normal"]);
  assert.equal(taskUrgency(tasks[1], now), "RUSH");
});
