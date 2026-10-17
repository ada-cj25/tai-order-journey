import assert from "node:assert/strict";
import test from "node:test";
import { projectRouteExecution } from "./route-execution.js";

const process = (status: string, completedQty = status === "COMPLETE" ? 10 : 0, metricMode = "AREA_QUANTITY") => ({
  workshop: "PANEL", processCode: "PANEL-01", plannedQty: 10, completedQty, status, metricMode,
});

test("订单生产进度先按路线面积加权区域，再对区域等权", () => {
  const projection = projectRouteExecution({
    tailPaymentConfirmed: true,
    areas: [
      { id: "a", routes: [
        { id: "ap", productionAreaId: "a", kind: "PANEL", assemblyPlanQty: 10, releasedAt: new Date(), processes: [process("COMPLETE")] },
        { id: "aw", productionAreaId: "a", kind: "WOOD_PAINT", assemblyPlanQty: 10, releasedAt: new Date(), processes: [process("PENDING")] },
      ] },
      { id: "b", routes: [{ id: "bp", productionAreaId: "b", kind: "PANEL", assemblyPlanQty: 20, releasedAt: new Date(), processes: [process("COMPLETE")] }] },
    ],
  });
  assert.equal(projection.areas[0]?.percent, 50);
  assert.equal(projection.areas[1]?.percent, 100);
  assert.equal(projection.productionPercent, 75);
});

test("领五金和包件台账不计入路线生产百分比或完成门禁", () => {
  const projection = projectRouteExecution({
    tailPaymentConfirmed: false,
    areas: [{ id: "a", routes: [{
      id: "r", productionAreaId: "a", kind: "PANEL", assemblyPlanQty: 10, releasedAt: new Date(), processes: [
        process("COMPLETE"), process("PENDING", 0, "REFERENCE_CONFIRMATION"), process("PENDING", 0, "PACKAGE_COUNT"),
      ],
    }] }],
  });
  assert.equal(projection.routes[0]?.complete, true);
  assert.equal(projection.productionPercent, 100);
  assert.equal(projection.steps.find((step) => step.key === "DELIVERY")?.status, "BLOCKED");
  assert.equal(projection.completeUnshippedRouteIds[0], "r");
});

test("生产未全部完成时发货步骤可与生产同时活动", () => {
  const projection = projectRouteExecution({
    tailPaymentConfirmed: true,
    areas: [{ id: "a", routes: [
      { id: "p", productionAreaId: "a", kind: "PANEL", assemblyPlanQty: 10, releasedAt: new Date(), shippedAt: new Date(), processes: [process("COMPLETE")] },
      { id: "w", productionAreaId: "a", kind: "WOOD_PAINT", assemblyPlanQty: 10, processes: [process("PENDING")] },
    ] }],
  });
  assert.equal(projection.steps.find((step) => step.key === "MATERIALS")?.status, "ACTIVE");
  assert.equal(projection.steps.find((step) => step.key === "PRODUCTION")?.status, "ACTIVE");
  assert.equal(projection.steps.find((step) => step.key === "DELIVERY")?.status, "ACTIVE");
  assert.equal(projection.shipmentPercent, 50);
});

test("采购进度按区域路线分别计算并可分步保存", () => {
  const projection = projectRouteExecution({
    tailPaymentConfirmed: false,
    areas: [
      { id: "a", routes: [
        { id: "ap", productionAreaId: "a", kind: "PANEL", assemblyPlanQty: 10, releasedAt: new Date(), processes: [process("PENDING")] },
        { id: "aw", productionAreaId: "a", kind: "WOOD_PAINT", assemblyPlanQty: 10, processes: [process("PENDING")] },
      ] },
      { id: "b", routes: [
        { id: "bp", productionAreaId: "b", kind: "PANEL", assemblyPlanQty: 10, processes: [process("PENDING")] },
      ] },
    ],
  });
  assert.equal(projection.procurementPercent, 33);
  assert.equal(projection.steps.find((step) => step.key === "MATERIALS")?.status, "ACTIVE");
  assert.equal(projection.steps.find((step) => step.key === "MATERIALS")?.reason, "已确认 1/3 条区域采购路线");
});
