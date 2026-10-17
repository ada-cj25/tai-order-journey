import assert from "node:assert/strict";
import test from "node:test";
import { ReminderPlanner } from "./reminder.service.js";

test("设计下单逾期只按分配版本向当前设计师和所属销售各通知一次", async () => {
  const now = new Date("2026-09-19T09:30:00.000Z");
  const task = {
    id: "task-v2",
    orderId: "order-1",
    ownerId: "designer-2",
    stage: "DESIGN_PENDING",
    title: "设计下单",
    dueAt: new Date("2026-09-18T09:30:00.000Z"),
    reminderAt: new Date("2026-09-17T09:30:00.000Z"),
    status: "PENDING",
    escalatedAt: null as Date | null,
    uniqueKey: "order-1:DESIGN_PENDING:v2",
    order: { trackingSerial: "GD-1", salesNumber: null, salesId: "sales-1" },
  };
  const notifications = new Map<string, Record<string, unknown>>();
  const prisma = {
    task: {
      findMany: async () => [task],
      findUnique: async () => task,
      update: async ({ data }: any) => Object.assign(task, data),
    },
    employee: { findMany: async () => [] },
    notification: {
      upsert: async ({ where, create, update }: any) => {
        notifications.set(where.uniqueKey, { ...(notifications.get(where.uniqueKey) ?? create), ...update });
      },
    },
    $queryRaw: async () => [],
    $transaction: async (callback: (tx: any) => Promise<void>) => callback(prisma),
  };
  const planner = new ReminderPlanner(prisma as never);
  await planner.scan(now);
  await planner.scan(now);
  assert.deepEqual([...notifications.keys()].sort(), [
    "order-1:DESIGN_PENDING:v2:OVERDUE:designer-2",
    "order-1:DESIGN_PENDING:v2:OVERDUE:sales-1",
  ]);
  assert.equal(task.status, "OVERDUE");
});
