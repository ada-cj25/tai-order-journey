import assert from "node:assert/strict";
import test from "node:test";
import { OrdersService } from "../server/orders.service.js";
import type { Employee } from "../server/generated/prisma/client.js";

// Exercise the real draft service against an isolated persistence double, never user orders.
function fixture() {
  const order = { id: "test-pre-review-draft", stage: "PRE_REVIEW", productionNumber: "TEST-PREREVIEW", currentOwnerLabel: "订单管理员", nextAction: "前置审单", tailPaymentConfirmed: false, installationApplied: false };
  const records: Array<Record<string, any>> = [];
  const prisma = {
    order: { findFirst: async () => structuredClone(order), update: async ({ data }: { data: Record<string, unknown> }) => { assert.deepEqual(Object.keys(data), ["updatedAt"]); return order; } },
    productionArea: { findFirst: async ({ where }: { where: { id: string; orderId: string } }) => where.orderId === order.id && ["area-a", "area-b"].includes(where.id) ? { id: where.id } : null },
    stageSubmission: {
      findMany: async () => records.slice().reverse(),
      findFirst: async () => records[0] ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const record = structuredClone({ id: `draft-${records.length + 1}`, ...data });
        records.push(record);
        return record;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const record = records.find((item) => item.id === where.id)!;
        Object.assign(record, structuredClone(data));
        return record;
      },
    },
    $queryRaw: async () => [],
    $transaction: async (operation: (tx: unknown) => Promise<unknown>): Promise<unknown> => operation(prisma),
  };
  const service = new OrdersService(prisma as never, {} as never, {} as never, {} as never, { assertApproved: async () => undefined } as never);
  service.detail = async () => structuredClone({ ...order, stageSubmissions: records }) as never;
  const admin = { id: "test-order-admin", role: "ORDER_ADMIN" } as Employee;
  return { service, order, records, admin };
}

test("partial pre-review saves checks and comments, can be read again, and changes no workflow facts", async () => {
  const { service, order, records, admin } = fixture();
  const before = structuredClone(order);
  const payload = { checklist: ["合同范围与设计范围一致"], comment: "CAD待继续核对" };
  await service.saveDraft(order.id, "APPROVE_PRE_REVIEW", admin, payload);
  const reopened = await service.detail(order.id, admin);
  assert.deepEqual(reopened.stageSubmissions[0].payload, payload);
  assert.equal(records[0].status, "DRAFT");
  assert.equal(records[0].submittedBy, admin.id);
  assert.deepEqual(order, before);
});

test("saving again updates the draft and persists unchecked items and cleared comments", async () => {
  const { service, order, records, admin } = fixture();
  await service.saveDraft(order.id, "APPROVE_PRE_REVIEW", admin, { checklist: ["合同范围与设计范围一致"], comment: "待复核" });
  await service.saveDraft(order.id, "APPROVE_PRE_REVIEW", admin, { checklist: [], comment: "" });
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].payload, { checklist: [], comment: "" });
  await service.saveDraft(order.id, "APPROVE_PRE_REVIEW", admin, {});
  assert.deepEqual(records[0].payload, {});
});

test("formal approval still rejects the incomplete saved checks", async () => {
  const { service, order, records, admin } = fixture();
  const checklist = ["范围", "CAD", "材料", "外购", "客户确认", "交期"].map((label, i) => ({ label, checked: i === 0 }));
  await service.saveDraft(order.id, "APPROVE_PRE_REVIEW", admin, { checklist: ["范围"] });
  await assert.rejects(service.command(order.id, "APPROVE_PRE_REVIEW", admin, { checklist }), /逐项勾选/);
  assert.equal(order.stage, "PRE_REVIEW");
  assert.equal(records[0].status, "DRAFT");
});

test("pre-review draft saving keeps role and current-stage checks", async () => {
  const { service, order, records, admin } = fixture();
  await assert.rejects(service.saveDraft(order.id, "APPROVE_PRE_REVIEW", { ...admin, role: "SALES" }, {}), /当前角色/);
  order.stage = "TECHNICAL";
  await assert.rejects(service.saveDraft(order.id, "APPROVE_PRE_REVIEW", admin, {}));
  assert.equal(records.length, 0);
});

test("order administrator can persist a partial technical review and reopen it", async () => {
  const { service, order, records } = fixture();
  order.stage = "TECH_REVIEW";
  const reviewer = { id: "test-order-admin", role: "ORDER_ADMIN" } as Employee;
  const payload = { checklist: ["海迅资料与当前设计版本一致", "四车间计划数量可执行"], comment: "板材采购数量待继续核对" };
  await service.saveDraft(order.id, "APPROVE_TECH_REVIEW", reviewer, payload);
  const reopened = await service.detail(order.id, reviewer);
  assert.deepEqual(reopened.stageSubmissions[0].payload, payload);
  assert.equal(records[0].status, "DRAFT");
  assert.equal(records[0].submittedBy, reviewer.id);
  assert.equal(order.stage, "TECH_REVIEW");
});

test("technical splitting keeps a separate incomplete draft for every production area", async () => {
  const { service, order, records } = fixture();
  order.stage = "TECHNICAL";
  const technical = { id: "test-technical", role: "TECHNICAL" } as Employee;

  await service.saveDraft(order.id, "SUBMIT_TECHNICAL", technical, { productionAreaId: "area-a", panelEnabled: true, woodPaintEnabled: false, panelQty: 12, assemblyQty: 10 });
  await service.saveDraft(order.id, "SUBMIT_TECHNICAL", technical, { productionAreaId: "area-b", panelEnabled: false, woodPaintEnabled: true, woodQty: 8, paintQty: 7, assemblyQty: 6 });
  await service.saveDraft(order.id, "SUBMIT_TECHNICAL", technical, { productionAreaId: "area-a", panelEnabled: true, woodPaintEnabled: false, panelQty: 14, assemblyQty: 11 });

  assert.equal(records.length, 2);
  assert.deepEqual(records.find((item) => item.payload.productionAreaId === "area-a")?.payload, { productionAreaId: "area-a", panelEnabled: true, woodPaintEnabled: false, panelQty: 14, assemblyQty: 11 });
  assert.deepEqual(records.find((item) => item.payload.productionAreaId === "area-b")?.payload, { productionAreaId: "area-b", panelEnabled: false, woodPaintEnabled: true, woodQty: 8, paintQty: 7, assemblyQty: 6 });
});
