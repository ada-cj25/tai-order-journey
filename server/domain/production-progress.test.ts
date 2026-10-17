import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProductionProcessAvailable,
  assertProcessAvailable,
  calculateProductionProgress,
  canReportProductionProcess,
  normalizeProductionReport,
  productionProcessAvailability,
  WORKSHOP_PROCESS_TEMPLATES,
} from "./production-progress.js";

test("partial workshop reporting is persisted as progress without completing production", () => {
  const report = normalizeProductionReport({ plannedQty: 398, completedQty: 126, action: "PROGRESS" });
  assert.deepEqual(report, { plannedQty: 398, completedQty: 126, status: "IN_PROGRESS" });

  const summary = calculateProductionProgress([
    { workshop: "PANEL", plannedQty: 398, completedQty: 398 },
    { workshop: "PANEL", plannedQty: 398, completedQty: 126 },
    { workshop: "WOOD", plannedQty: 24, completedQty: 0 },
  ]);
  assert.equal(summary.complete, false);
  assert.equal(summary.workshops.PANEL.completedQty, 524);
  assert.equal(summary.workshops.PANEL.plannedQty, 796);
  assert.equal(summary.workshops.PANEL.percent, 66);
});

test("production completes only when every released process reaches its planned quantity", () => {
  const processes = Object.entries(WORKSHOP_PROCESS_TEMPLATES).flatMap(([workshop, steps]) =>
    steps.map(() => ({ workshop, plannedQty: 10, completedQty: 10 })),
  );
  assert.equal(calculateProductionProgress(processes).complete, true);
  processes[3]!.completedQty = 9;
  assert.equal(calculateProductionProgress(processes).complete, false);
});

test("a completed workshop is projected independently while sibling workshops on the route remain pending", () => {
  const summary = calculateProductionProgress([
    { workshop: "PANEL", plannedQty: 20, completedQty: 20, status: "COMPLETE", metricMode: "AREA_QUANTITY" },
    { workshop: "PANEL", plannedQty: 20, completedQty: 20, status: "COMPLETE", metricMode: "AREA_QUANTITY" },
    { workshop: "ASSEMBLY", plannedQty: 30, completedQty: 0, status: "PENDING", metricMode: "AREA_QUANTITY" },
    { workshop: "ASSEMBLY", plannedQty: 1, completedQty: 0, status: "PENDING", metricMode: "REFERENCE_CONFIRMATION" },
  ]);

  assert.equal(summary.complete, false);
  assert.equal(summary.workshops.PANEL.complete, true);
  assert.equal(summary.workshops.ASSEMBLY.complete, false);
});

test("a progress report cannot exceed the planned quantity", () => {
  assert.throws(
    () => normalizeProductionReport({ plannedQty: 10, completedQty: 11, action: "PROGRESS" }),
    /不能超过计划数量/,
  );
});

test("workshop process templates exactly follow 流程图(2).xls", () => {
  assert.deepEqual(WORKSHOP_PROCESS_TEMPLATES.PANEL, ["开料", "封边", "打孔", "清洗修边", "品检", "送组装车间"]);
  assert.deepEqual(WORKSHOP_PROCESS_TEMPLATES.WOOD, ["开料", "制作1", "贴皮", "制作2", "送油漆车间"]);
  assert.deepEqual(WORKSHOP_PROCESS_TEMPLATES.PAINT, ["白坯打磨", "喷底漆", "一次油磨", "喷底漆", "二次油磨", "喷面漆", "品检", "送组装车间"]);
  assert.deepEqual(WORKSHOP_PROCESS_TEMPLATES.ASSEMBLY, ["打包", "领五金", "入库", "订单生产完成"]);
});

test("a workshop process stays locked until its own previous process completes", () => {
  const processes = [{ sequence: 1, status: "IN_PROGRESS" }, { sequence: 2, status: "PENDING" }];
  assert.throws(() => assertProcessAvailable(processes, 2), /前序工序/);
  processes[0]!.status = "COMPLETE";
  assert.doesNotThrow(() => assertProcessAvailable(processes, 2));
  assert.doesNotThrow(() => assertProcessAvailable(processes, 1));
});

test("paint waits for every wood process while panel and wood may start independently", () => {
  const processes = [
    { workshop: "PANEL", sequence: 1, status: "PENDING" },
    { workshop: "WOOD", sequence: 1, status: "COMPLETE" },
    { workshop: "WOOD", sequence: 2, status: "IN_PROGRESS" },
    { workshop: "PAINT", sequence: 1, status: "PENDING" },
  ];
  assert.equal(productionProcessAvailability(processes, processes[0]!).available, true);
  assert.equal(productionProcessAvailability(processes, processes[1]!).available, true);
  assert.throws(() => assertProductionProcessAvailable(processes, processes[3]!), /木工（实木）车间全部工序完成后开放/);
  processes[2]!.status = "COMPLETE";
  assert.doesNotThrow(() => assertProductionProcessAvailable(processes, processes[3]!));
});

test("贴皮是可选并行工序，送油漆只在存在贴皮时等待它", () => {
  const withVeneer = [
    { workshop: "WOOD", processCode: "WOOD-01", sequence: 1, status: "COMPLETE" },
    { workshop: "WOOD", processCode: "WOOD-02", sequence: 2, status: "COMPLETE" },
    { workshop: "WOOD", processCode: "WOOD-03", sequence: 3, status: "PENDING" },
    { workshop: "WOOD", processCode: "WOOD-04", sequence: 4, status: "PENDING" },
    { workshop: "WOOD", processCode: "WOOD-05", sequence: 5, status: "PENDING" },
  ];
  assert.equal(productionProcessAvailability(withVeneer, withVeneer[2]!).available, true);
  assert.equal(productionProcessAvailability(withVeneer, withVeneer[3]!).available, true);
  withVeneer[3]!.status = "COMPLETE";
  assert.equal(productionProcessAvailability(withVeneer, withVeneer[4]!).available, false);
  withVeneer[2]!.status = "COMPLETE";
  assert.equal(productionProcessAvailability(withVeneer, withVeneer[4]!).available, true);

  const withoutVeneer = withVeneer.filter((process) => process.processCode !== "WOOD-03");
  assert.equal(productionProcessAvailability(withoutVeneer, withoutVeneer.find((process) => process.processCode === "WOOD-05")!).available, true);
});

test("assembly opens when panel OR the complete wood-paint route finishes", () => {
  const processes = [
    { workshop: "PANEL", sequence: 1, status: "COMPLETE" },
    { workshop: "PAINT", sequence: 1, status: "IN_PROGRESS" },
    { workshop: "ASSEMBLY", sequence: 1, status: "PENDING" },
  ];
  assert.doesNotThrow(() => assertProductionProcessAvailable(processes, processes[2]!));

  const woodPaintOnly = [
    { workshop: "WOOD", sequence: 1, status: "COMPLETE" },
    { workshop: "PAINT", sequence: 1, status: "COMPLETE" },
    { workshop: "ASSEMBLY", sequence: 1, status: "PENDING" },
  ];
  assert.doesNotThrow(() => assertProductionProcessAvailable(woodPaintOnly, woodPaintOnly[2]!));
  woodPaintOnly[1]!.status = "IN_PROGRESS";
  assert.throws(() => assertProductionProcessAvailable(woodPaintOnly, woodPaintOnly[2]!), /木工与油漆车间全部工序完成后开放/);
});

test("领五金是独立统计，不锁住自产入库且不计入生产完成", () => {
  const assembly = [
    { workshop: "PANEL", sequence: 1, status: "COMPLETE", metricMode: "AREA_QUANTITY" },
    { workshop: "ASSEMBLY", sequence: 1, status: "COMPLETE", metricMode: "AREA_QUANTITY" },
    { workshop: "ASSEMBLY", sequence: 2, status: "PENDING", metricMode: "REFERENCE_CONFIRMATION" },
    { workshop: "ASSEMBLY", sequence: 3, status: "PENDING", metricMode: "PACKAGE_COUNT" },
    { workshop: "ASSEMBLY", sequence: 4, status: "PENDING", metricMode: "MILESTONE" },
  ];
  const warehouse = assembly.find((process) => process.workshop === "ASSEMBLY" && process.sequence === 3)!;
  const milestone = assembly.find((process) => process.workshop === "ASSEMBLY" && process.sequence === 4)!;
  assert.equal(productionProcessAvailability(assembly, warehouse).available, true);
  warehouse.status = "COMPLETE";
  assert.equal(productionProcessAvailability(assembly, milestone).available, true);
  milestone.status = "COMPLETE";
  const progress = calculateProductionProgress(assembly.filter((process) => process.workshop === "ASSEMBLY").map((process) => ({ ...process, plannedQty: 1, completedQty: process.status === "COMPLETE" ? 1 : 0 })));
  assert.equal(progress.complete, true);
  assert.equal(progress.workshops.ASSEMBLY.completedSteps, 2);
  assert.equal(progress.workshops.ASSEMBLY.totalSteps, 2);
});

test("production reporting is limited to the exact process owner, workshop supervisor, or chairman", () => {
  const panelCut = { workshop: "PANEL", processCode: "PANEL-01" };
  assert.equal(canReportProductionProcess({ role: "WORKSHOP", workshop: "PANEL", processCode: "PANEL-01", level: "STAFF" }, panelCut), true);
  assert.equal(canReportProductionProcess({ role: "WORKSHOP", workshop: "PANEL", processCode: "PANEL-02", level: "STAFF" }, panelCut), false);
  assert.equal(canReportProductionProcess({ role: "WORKSHOP", workshop: "PANEL", level: "SUPERVISOR" }, panelCut), true);
  assert.equal(canReportProductionProcess({ role: "WORKSHOP", workshop: "WOOD", level: "SUPERVISOR" }, panelCut), false);
  assert.equal(canReportProductionProcess({ role: "ORDER_ADMIN" }, panelCut), false);
  assert.equal(canReportProductionProcess({ role: "CHAIRMAN" }, panelCut), true);
});
