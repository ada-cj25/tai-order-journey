import assert from "node:assert/strict";
import test from "node:test";
import { ProductionService } from "../server/production.service.js";
import type { Employee } from "../server/generated/prisma/client.js";
import { LOCAL_WORKERS } from "../server/domain/local-worker-roster.js";
import { WORKSHOP_PROCESS_TEMPLATES, WORKSHOP_LABELS } from "../server/domain/workshop-processes.js";

function fixture() {
  const order = { id: "isolated-workers", stage: "PRODUCTION", updatedAt: new Date(), productionReady: false };
  const area = { id: "area-1", orderId: order.id, name: "客厅", productionNumber: "TEST-AREA-01", status: "PRODUCTION", shipmentAreas: [] as any[] };
  const processes = Object.entries(WORKSHOP_PROCESS_TEMPLATES).flatMap(([workshop, names]) => names.map((name, i) => ({
    id: `${workshop}-${String(i + 1).padStart(2, "0")}`, processCode: `${workshop}-${String(i + 1).padStart(2, "0")}`, orderId: order.id,
    productionAreaId: area.id,
    workshop, workshopLabel: WORKSHOP_LABELS[workshop as keyof typeof WORKSHOP_LABELS], processName: name, sequence: i + 1,
    plannedQty: 2, completedQty: 0, unit: "件", status: "PENDING", startedAt: null,
  })));
  const reports: any[] = [], events: any[] = [], submissions: any[] = [];
  const stageCalls: string[] = [];
  const prisma = {
    order: { findFirst: async () => order, update: async ({ data }: any) => Object.assign(order, data) },
    productionProcess: {
      findFirst: async ({ where }: any) => processes.find((process) => process.id === where.id),
      findMany: async () => structuredClone(processes),
      update: async ({ where, data }: any) => Object.assign(processes.find((process) => process.id === where.id)!, data),
    },
    productionReport: { create: async ({ data }: any) => reports.push(structuredClone(data)) },
    productionArea: {
      findMany: async () => [{ ...structuredClone(area), productionProcesses: structuredClone(processes) }],
      update: async ({ data }: any) => Object.assign(area, data),
    },
    orderEvent: { create: async ({ data }: any) => events.push(structuredClone(data)) },
    stageSubmission: { create: async ({ data }: any) => submissions.push(structuredClone(data)) },
    $queryRaw: async () => [],
    $transaction: async (operation: (tx: unknown) => Promise<unknown>): Promise<unknown> => operation(prisma),
  };
  const scheduler = { completeProductionWorkshop: async () => ({ count: 1 }), completeStage: async () => stageCalls.push("complete"), planStage: async () => stageCalls.push("plan") };
  const service = new ProductionService(prisma as never, scheduler as never);
  const workers = LOCAL_WORKERS.map((worker) => ({ ...worker, id: worker.username } as Employee));
  return { service, order, processes, reports, events, submissions, stageCalls, workers };
}

test("the real reporting service accepts 12 assigned workers through all 23 steps and records each reporter separately", async () => {
  const { service, order, processes, reports, submissions, stageCalls, workers } = fixture();
  const actors: string[] = [];
  for (const process of processes) {
    const actor = workers.find((worker) => worker.processCodes.includes(process.processCode))!;
    const wrongActor = workers.find((worker) => worker.workshop === actor.workshop && worker.id !== actor.id) ?? workers[0];
    await assert.rejects(service.report(order.id, { processId: process.id, action: "COMPLETE" }, wrongActor), /当前账号不是该工序负责人/);
    await service.report(order.id, { processId: process.id, action: "COMPLETE" }, actor);
    actors.push(actor.id);
    assert.equal(reports.at(-1).reportedBy, actor.id);
    assert.equal(reports.at(-1).productionProcessId, process.id);
    if (process !== processes.at(-1)) assert.equal(order.stage, "PRODUCTION");
  }
  assert.equal(new Set(actors).size, 12);
  assert.equal(reports.length, 23);
  assert.equal(order.stage, "DELIVERY");
  assert.equal(order.productionReady, true);
  assert.equal(submissions.length, 1);
  assert.deepEqual(stageCalls, ["complete", "plan"]);
});

test("multi-process reporting allows veneer and 制作2 in parallel but gates 送油漆 on both", async () => {
  const { service, order, processes, reports, workers } = fixture();
  const worker = (name: string) => workers.find((item) => item.username === name)!;
  const report = (processId: string, name: string, action: "COMPLETE" | "PROGRESS" = "COMPLETE", completedQty?: number) => service.report(order.id, { processId, action, completedQty }, worker(name));
  await assert.rejects(report("PAINT-01", "paintsand"), /木工/);
  await assert.rejects(report("ASSEMBLY-01", "assemblyworker"), /板式.*油漆/);
  await report("WOOD-01", "woodcut");
  await report("WOOD-02", "woodmake", "PROGRESS", 1);
  await assert.rejects(report("WOOD-03", "woodveneer"), /前序/);
  await report("WOOD-02", "woodmake");
  await report("WOOD-04", "woodmake");
  await assert.rejects(report("WOOD-05", "woodmake"), /前序/);
  assert.equal(reports.length, 4);
  await report("WOOD-03", "woodveneer");
  await report("WOOD-05", "woodmake");
  await report("PAINT-01", "paintsand");
  await report("PAINT-02", "paintspray");
  await assert.rejects(report("PAINT-04", "paintspray"), /前序/);
  await report("PAINT-03", "paintsand");
  await report("PAINT-04", "paintspray");
  assert.equal(reports.filter((item) => item.reportedBy === "paintspray").length, 2);
  assert.equal(processes.find((item) => item.id === "PAINT-06")!.status, "PENDING");
  assert.equal(order.stage, "PRODUCTION");
});
