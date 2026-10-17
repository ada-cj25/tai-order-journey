import assert from "node:assert/strict";
import test from "node:test";
import { projectFulfillment } from "./fulfillment.js";

test("外购只受尾款门禁并按产品齐套发货", () => {
  const result = projectFulfillment({
    tailPaymentConfirmed: true,
    installationApplied: false,
    outsourceMode: "REQUIRED",
    productionAreas: [{ id: "area", complete: false, shipped: false }],
    outsourceLines: [
      { id: "door", name: "铝框玻璃门", plannedQty: 4, unit: "件", arrivals: [{ id: "a1", quantity: 2, arrivedOn: "2026-09-01" }, { id: "a2", quantity: 2, arrivedOn: "2026-09-02" }] },
      { id: "cabinet", name: "铝蜂窝柜", plannedQty: 2, unit: "件", arrivals: [{ id: "a3", quantity: 1, arrivedOn: "2026-09-02" }] },
    ],
  });
  assert.equal(result.manufactured.allowed, false);
  assert.equal(result.outsourced.lines[0]?.canShip, true);
  assert.equal(result.outsourced.lines[1]?.canShip, false);
  assert.equal(result.outsourced.canShipAny, true);
});

test("定制产品发货不再以安装申请为门槛", () => {
  const result = projectFulfillment({
    tailPaymentConfirmed: true,
    installationApplied: false,
    outsourceMode: "NONE",
    productionAreas: [{ id: "area", complete: true, shipped: false }],
    outsourceLines: [],
  });
  assert.equal(result.manufactured.allowed, true);
});

test("定制产品发货后可进入安装，但外购未发阻止安装完成", () => {
  const pending = projectFulfillment({
    tailPaymentConfirmed: true,
    installationApplied: true,
    outsourceMode: "REQUIRED",
    productionAreas: [{ id: "area", complete: true, shipped: true }],
    outsourceLines: [{ id: "door", name: "涂料门", plannedQty: 1, unit: "件", arrivals: [{ id: "a1", quantity: 1, arrivedOn: "2026-09-01" }] }],
  });
  assert.equal(pending.installationCompletionAllowed, false);
  const complete = projectFulfillment({
    tailPaymentConfirmed: true,
    installationApplied: true,
    outsourceMode: "REQUIRED",
    productionAreas: [{ id: "area", complete: true, shipped: true }],
    outsourceLines: [{ id: "door", name: "涂料门", plannedQty: 1, unit: "件", arrivals: [], shipmentLine: { shipmentId: "shipment" } }],
  });
  assert.equal(complete.installationCompletionAllowed, true);
});

test("无外购和历史豁免订单不增加安装完成阻断", () => {
  for (const outsourceMode of ["NONE", "LEGACY_EXEMPT"] as const) {
    const result = projectFulfillment({ tailPaymentConfirmed: true, installationApplied: true, outsourceMode, productionAreas: [{ id: "a", complete: true, shipped: true }], outsourceLines: [] });
    assert.equal(result.installationCompletionAllowed, true);
  }
});

test("同一区域可多批发货，末批且全部批次安装完成后区域才收口", () => {
  const pending = projectFulfillment({
    tailPaymentConfirmed: true,
    installationApplied: true,
    outsourceMode: "NONE",
    productionAreas: [{ id: "a", complete: true, shipped: false, shipmentBatches: [{ isFinalBatch: false, installed: true }] }],
    outsourceLines: [],
  });
  assert.equal(pending.manufactured.allowed, true);
  assert.equal(pending.manufactured.shipped, false);
  assert.equal(pending.installationCompletionAllowed, false);

  const complete = projectFulfillment({
    tailPaymentConfirmed: true,
    installationApplied: true,
    outsourceMode: "NONE",
    productionAreas: [{ id: "a", complete: true, shipped: false, shipmentBatches: [{ isFinalBatch: false, installed: true }, { isFinalBatch: true, installed: true }] }],
    outsourceLines: [],
  });
  assert.equal(complete.manufactured.shipped, true);
  assert.equal(complete.installationCompletionAllowed, true);
});

test("路线模式任一完工路线可独立发货，未完工路线不阻断", () => {
  const result = projectFulfillment({
    tailPaymentConfirmed: true,
    installationApplied: false,
    outsourceMode: "NONE",
    productionAreas: [{
      id: "area-a",
      complete: false,
      shipped: false,
      routes: [
        { id: "route-panel", kind: "PANEL", complete: true, shipped: false },
        { id: "route-wood", kind: "WOOD_PAINT", complete: false, shipped: false },
      ],
    }],
    outsourceLines: [],
  });
  assert.equal(result.manufactured.allowed, true);
  assert.deepEqual(result.manufactured.allowedProductionRouteIds, ["route-panel"]);
  assert.equal(result.manufactured.allProductionAreasComplete, false);
  assert.equal(result.manufactured.shipped, false);
});

test("路线模式必须全部路线已发且所属车次已安装才收口", () => {
  const result = projectFulfillment({
    tailPaymentConfirmed: true,
    installationApplied: false,
    outsourceMode: "NONE",
    productionAreas: [{ id: "area-a", complete: true, shipped: true, routes: [
      { id: "route-panel", kind: "PANEL", complete: true, shipped: true, shipmentInstalled: true },
      { id: "route-wood", kind: "WOOD_PAINT", complete: true, shipped: true, shipmentInstalled: false },
    ] }],
    outsourceLines: [],
  });
  assert.equal(result.manufactured.shipped, true);
  assert.equal(result.manufactured.installed, false);
  assert.equal(result.installationCompletionAllowed, false);
});

test("路线可多批发货，未确认末批时仍可继续发货", () => {
  const pending = projectFulfillment({
    tailPaymentConfirmed: true,
    installationApplied: false,
    outsourceMode: "NONE",
    productionAreas: [{ id: "area-a", complete: true, shipped: false, routes: [{
      id: "route-panel", kind: "PANEL", complete: true, shipped: false,
      shipmentBatches: [{ isFinalBatch: false, installed: true }],
    }] }],
    outsourceLines: [],
  });
  assert.equal(pending.manufactured.shipped, false);
  assert.equal(pending.manufactured.allowed, true);
  assert.deepEqual(pending.manufactured.allowedProductionRouteIds, ["route-panel"]);

  const finalized = projectFulfillment({
    tailPaymentConfirmed: true,
    installationApplied: false,
    outsourceMode: "NONE",
    productionAreas: [{ id: "area-a", complete: true, shipped: false, routes: [{
      id: "route-panel", kind: "PANEL", complete: true, shipped: false,
      shipmentBatches: [{ isFinalBatch: false, installed: true }, { isFinalBatch: true, installed: false }],
    }] }],
    outsourceLines: [],
  });
  assert.equal(finalized.manufactured.shipped, true);
  assert.equal(finalized.manufactured.allowed, false);
  assert.equal(finalized.manufactured.installed, false);
});
