import assert from "node:assert/strict";
import test from "node:test";
import { isAreaFinalAfterRouteBatch, validateRouteShipmentBatches } from "./route-shipment.js";

const routes = [{
  id: "panel",
  productionAreaId: "bedroom",
  areaName: "卧室",
  routeLabel: "板式路线",
  complete: true,
  finalShipmentRecorded: false,
  batchCount: 1,
}, {
  id: "wood",
  productionAreaId: "bedroom",
  areaName: "卧室",
  routeLabel: "实木油漆路线",
  complete: true,
  finalShipmentRecorded: true,
  batchCount: 1,
}];

test("路线未确认末批时可继续登记后续批次", () => {
  const selected = validateRouteShipmentBatches(routes, [{ productionRouteId: "panel", isFinalBatch: false }]);
  assert.equal(selected[0]?.sequence, 2);
  assert.equal(selected[0]?.isFinalBatch, false);
});

test("路线确认末批后关闭后续发货入口", () => {
  assert.throws(() => validateRouteShipmentBatches(routes, [{ productionRouteId: "wood", isFinalBatch: false }]), /已确认末批/);
});

test("区域只在所有路线都确认末批后收口", () => {
  assert.equal(isAreaFinalAfterRouteBatch(["panel", "wood"], ["wood"], [{ productionRouteId: "panel", isFinalBatch: false }]), false);
  assert.equal(isAreaFinalAfterRouteBatch(["panel", "wood"], ["wood"], [{ productionRouteId: "panel", isFinalBatch: true }]), true);
});
