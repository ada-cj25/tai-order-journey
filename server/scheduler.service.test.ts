import test from "node:test";
import assert from "node:assert/strict";
import { TaskScheduler } from "./scheduler.service.js";

test("planning a returned design stage reopens the original designer task without extending its deadline", async (t) => {
  // Keep the pending-task scenario before its fixed deadline on every run.
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-12T09:00:00.000Z") });
  const designDueAt = new Date("2026-10-13T09:00:00.000Z");
  const upserts: Array<Record<string, unknown>> = [];
  const db = {
    order: {
      findUniqueOrThrow: async () => ({
        id: "order-1",
        designerId: "designer-1",
        designDueAt,
        designAssignmentVersion: 3,
        internalDueAt: designDueAt,
      }),
    },
    task: {
      upsert: async (args: Record<string, unknown>) => {
        upserts.push(args);
        return args;
      },
    },
  };
  const scheduler = new TaskScheduler(db as never);

  await scheduler.planStage("order-1", "DESIGN_ACCEPTED", new Date("2026-09-10T04:13:00.000Z"), db as never);

  assert.equal(upserts.length, 1);
  const args = upserts[0] as { where: { uniqueKey: string }; create: Record<string, unknown>; update: Record<string, unknown> };
  assert.equal(args.where.uniqueKey, "order-1:DESIGN_ACCEPTED:v3");
  assert.equal(args.create.ownerId, "designer-1");
  assert.equal(args.create.title, "设计提交修订版本");
  assert.equal((args.create.dueAt as Date).toISOString(), designDueAt.toISOString());
  assert.equal(args.update.title, "设计提交修订版本");
  assert.equal(args.update.status, "PENDING");
  assert.equal(args.update.completedAt, null);
});

test("设计下单任务按分配版本创建并使用七个自然日截止", async () => {
  const upserts: Array<Record<string, unknown>> = [];
  const db = {
    order: { findUniqueOrThrow: async () => ({ id: "order-2", designerId: "designer-2", designAssignmentVersion: 4 }) },
    task: { upsert: async (args: Record<string, unknown>) => { upserts.push(args); return args; } },
  };
  const scheduler = new TaskScheduler(db as never);
  const availableAt = new Date("2026-09-11T09:30:00.000Z");
  const dueAt = await scheduler.planDesignIntake("order-2", availableAt, 4, db as never);
  assert.equal(dueAt?.toISOString(), "2026-09-18T09:30:00.000Z");
  const args = upserts[0] as { where: { uniqueKey: string }; create: Record<string, unknown> };
  assert.equal(args.where.uniqueKey, "order-2:DESIGN_PENDING:v4");
  assert.equal(args.create.ownerId, "designer-2");
});

test("每个自产发货车次创建独立安装待办", async () => {
  const upserts: Array<Record<string, unknown>> = [];
  const plannedInstallationAt = new Date("2099-09-19T16:00:00.000Z");
  const db = {
    order: { findUniqueOrThrow: async () => ({ id: "order-3" }) },
    shipment: { findMany: async () => [{ id: "shipment-1", vehicle: "测试车", deliveredAt: new Date(), plannedInstallationAt, assignedInstallerId: "installer-1", areas: [{ areaName: "卧室", sequence: 2 }] }] },
    task: { upsert: async (args: Record<string, unknown>) => { upserts.push(args); return args; } },
  };
  const scheduler = new TaskScheduler(db as never);

  await scheduler.planStage("order-3", "INSTALLATION", new Date(), db as never);

  const args = upserts[0] as { where: { uniqueKey: string }; create: Record<string, unknown> };
  assert.equal(args.where.uniqueKey, "order-3:INSTALLATION:shipment-1");
  assert.equal(args.create.ownerId, "installer-1");
  assert.equal(args.create.title, "卧室第2车次安装");
  assert.equal((args.create.dueAt as Date).toISOString(), "2099-09-20T09:00:00.000Z");
});

test("完成一个发货车次只关闭对应安装待办", async () => {
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    task: {
      findUnique: async () => ({ id: "task-1", uniqueKey: "order-4:INSTALLATION:shipment-2", status: "PENDING", dueAt: new Date("2026-09-20T09:00:00.000Z") }),
      update: async (args: Record<string, unknown>) => { updates.push(args); return args; },
    },
    notification: { updateMany: async () => ({ count: 1 }) },
  };
  const scheduler = new TaskScheduler(db as never);
  const result = await scheduler.completeShipmentInstallation("order-4", "shipment-2", new Date("2026-09-20T08:00:00.000Z"), db as never);
  assert.equal(result.count, 1);
  assert.equal((updates[0] as { where: { id: string } }).where.id, "task-1");
  assert.equal((updates[0] as { data: { status: string } }).data.status, "COMPLETE");
});
