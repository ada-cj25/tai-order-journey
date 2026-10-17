import assert from "node:assert/strict";
import test from "node:test";
import type { Employee } from "./generated/prisma/client.js";
import { MaterialCostService } from "./material-cost.service.js";

const finance = { id: "finance-1", role: "FINANCE" } as Employee;

test("外购成本只允许财务角色登记，且单位成本必须有效", async () => {
  const service = new MaterialCostService({} as never, {} as never);
  await assert.rejects(() => service.addOutsourceCostPrice("order-1", "line-1", { ...finance, role: "PROCUREMENT" }, { unitPrice: 10 }), /只有财务或董事长管理员/);
  await assert.rejects(() => service.addOutsourceCostPrice("order-1", "line-1", finance, { unitPrice: -1 }), /非负金额/);
  await assert.rejects(() => service.addOutsourceCostPrice("order-1", "line-1", finance, { unitPrice: 1.12345 }), /四位小数/);
});

test("外购产品单价按版本保存，调价须说明原因且审计事件不暴露金额", async () => {
  const events: Array<{ title: string; description: string }> = [];
  const versions: Array<{ version: number; unitPrice: number; note: string | null }> = [];
  const tx = {
    $executeRaw: async () => undefined,
    outsourceProductLine: { findFirst: async () => ({ id: "line-1", name: "外购台面" }) },
    outsourceProductCostVersion: {
      findFirst: async () => versions.at(-1) ?? null,
      create: async ({ data }: { data: { version: number; unitPrice: number; note: string | null } }) => {
        versions.push({ version: data.version, unitPrice: data.unitPrice, note: data.note });
        return { id: `price-${data.version}`, version: data.version };
      },
    },
    orderEvent: { create: async ({ data }: { data: { title: string; description: string } }) => { events.push(data); } },
  };
  const prisma = { $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx) };
  const service = new MaterialCostService(prisma as never, {} as never);
  await service.addOutsourceCostPrice("order-1", "line-1", finance, { unitPrice: 0 });
  await assert.rejects(() => service.addOutsourceCostPrice("order-1", "line-1", finance, { unitPrice: 12.5 }), /填写原因/);
  await service.addOutsourceCostPrice("order-1", "line-1", finance, { unitPrice: 12.5, note: "供应商最终报价" });
  assert.deepEqual(versions, [{ version: 1, unitPrice: 0, note: null }, { version: 2, unitPrice: 12.5, note: "供应商最终报价" }]);
  assert.equal(events.length, 2);
  assert.ok(events.every((event) => !event.title.includes("12.5") && !event.description.includes("12.5")));
});
