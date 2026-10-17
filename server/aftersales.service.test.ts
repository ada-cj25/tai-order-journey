import assert from "node:assert/strict";
import test from "node:test";
import { AfterSalesService } from "./aftersales.service.js";

test("登记售后问题与首笔费用批次在同一事务中创建", async () => {
  const originalCostFlag = process.env.COST_MODULE_ENABLED;
  process.env.COST_MODULE_ENABLED = "true";
  let insideTransaction = false;
  let transactionCount = 0;
  const events: Array<Record<string, unknown>> = [];
  const order = { id: "order-1", updatedAt: new Date("2026-09-13T02:00:00.000Z"), stage: "BUSINESS_COMPLETE", businessType: "NOERLI_FORMAL", finalAcceptedAt: new Date("2026-09-01T00:00:00.000Z") };
  const caseRecord = { id: "case-1", orderId: order.id, caseNumber: "SH-2026-0001", issueType: "五金更换", description: "客户报修", status: "OPEN", updatedAt: new Date("2026-09-13T02:00:00.000Z") };
  const batchRecord = { id: "batch-1", afterSalesId: caseRecord.id, orderId: order.id, incurredOn: new Date("2026-09-12T16:00:00.000Z"), amount: 128.5, description: "本次问题：客户报修", attachmentIds: [], recordedBy: "aftersales-1", recordedAt: new Date("2026-09-13T02:00:00.000Z") };
  const tx = {
    $queryRaw: async () => [],
    $executeRaw: async () => 1,
    order: {
      findFirst: async () => order,
      update: async () => order,
    },
    attachment: { findMany: async () => [] },
    afterSalesCase: {
      count: async () => 0,
      create: async () => { assert.equal(insideTransaction, true); return caseRecord; },
    },
    afterSalesCostBatch: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        assert.equal(insideTransaction, true);
        assert.equal(data.afterSalesId, caseRecord.id);
        assert.equal(data.amount, 128.5);
        return batchRecord;
      },
    },
    orderEvent: { create: async ({ data }: { data: Record<string, unknown> }) => { events.push(data); return data; } },
  };
  const prisma = {
    ...tx,
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => {
      transactionCount += 1;
      insideTransaction = true;
      try { return await callback(tx); } finally { insideTransaction = false; }
    },
  };

  try {
    const service = new AfterSalesService(prisma as never);
    const result = await service.create({ orderId: order.id, issueType: "五金更换", description: "客户报修", incurredOn: "2026-09-13", amount: 128.5 }, { id: "aftersales-1", role: "AFTERSALES" } as never, { expectedUpdatedAt: order.updatedAt.toISOString() });
    assert.equal(transactionCount, 1);
    assert.equal(result.costSubtotal, 128.5);
    assert.equal(result.costStatus, "CUMULATIVE");
    assert.deepEqual(events.map((event) => event.type), ["AFTERSALES_CREATED", "AFTERSALES_COST_ADDED"]);
  } finally {
    if (originalCostFlag === undefined) delete process.env.COST_MODULE_ENABLED;
    else process.env.COST_MODULE_ENABLED = originalCostFlag;
  }
});

test("售后登记拒绝缺失的本次费用", async () => {
  const originalCostFlag = process.env.COST_MODULE_ENABLED;
  process.env.COST_MODULE_ENABLED = "true";
  try {
    const service = new AfterSalesService({} as never);
    await assert.rejects(
      service.create({ orderId: "order-1", issueType: "调整", description: "门板调整" }, { id: "aftersales-1", role: "AFTERSALES" } as never),
      (error: Error) => error.message === "售后费用必须大于0",
    );
  } finally {
    if (originalCostFlag === undefined) delete process.env.COST_MODULE_ENABLED;
    else process.env.COST_MODULE_ENABLED = originalCostFlag;
  }
});

test("售后列表只在成本开启时附带可查看的费用凭证", async () => {
  const previous = process.env.COST_MODULE_ENABLED;
  const employee = { id: "aftersales-1", role: "AFTERSALES" };
  const row = { id: "case-1", orderId: "order-1", status: "OPEN", order: { id: "order-1", stage: "BUSINESS_COMPLETE" }, costBatches: [
    { id: "batch-1", amount: 48, attachmentIds: ["attachment-1"], voidedAt: null },
    { id: "batch-2", amount: 20, attachmentIds: [], voidedAt: new Date() },
  ] };
  let attachmentReads = 0;
  const prisma = {
    afterSalesCase: { findMany: async () => [row] },
    attachment: { findMany: async () => { attachmentReads += 1; return [{ id: "attachment-1", originalName: "现场.jpg", mimeType: "image/jpeg" }]; } },
  };
  try {
    process.env.COST_MODULE_ENABLED = "true";
    const enabled = await new AfterSalesService(prisma as never).list(employee as never);
    assert.equal(enabled[0]?.costSubtotal, 48);
    assert.equal(enabled[0]?.costBatches?.[0]?.attachments?.[0]?.originalName, "现场.jpg");
    assert.equal(attachmentReads, 1);
    process.env.COST_MODULE_ENABLED = "false";
    const disabled = await new AfterSalesService(prisma as never).list(employee as never);
    assert.equal(disabled[0]?.costSubtotal, null);
    assert.equal(disabled[0]?.costBatches, undefined);
    assert.equal(attachmentReads, 1);
  } finally {
    if (previous === undefined) delete process.env.COST_MODULE_ENABLED;
    else process.env.COST_MODULE_ENABLED = previous;
  }
});
