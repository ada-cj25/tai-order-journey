import assert from "node:assert/strict";
import test from "node:test";
import { projectPackageCountAvailability, projectPackageSummary } from "./package-counting.js";

test("外购入库包件按到货事实分步开放并说明责任人", () => {
  assert.deepEqual(projectPackageCountAvailability({ kind: "OUTSOURCED_PRODUCT", arrivedQty: 0, plannedQty: 3, total: 0 }), {
    canAdd: false,
    canFinalize: false,
    detail: "待订单管理员登记外购到货；到货后由组装登记包件",
  });
  assert.deepEqual(projectPackageCountAvailability({ kind: "OUTSOURCED_PRODUCT", arrivedQty: 1, plannedQty: 3, total: 0 }), {
    canAdd: true,
    canFinalize: false,
    detail: "已部分到货，组装可继续登记包件；全部到货后可统计完成",
  });
  assert.deepEqual(projectPackageCountAvailability({ kind: "OUTSOURCED_PRODUCT", arrivedQty: 3, plannedQty: 3, total: 1 }), {
    canAdd: true,
    canFinalize: true,
    detail: "已全部到货，组装可继续登记包件或统计完成",
  });
});

test("自产入库包件只在对应路线完成组装打包后开放", () => {
  assert.deepEqual(projectPackageCountAvailability({ kind: "MANUFACTURED_ROUTE", prerequisiteComplete: false, total: 0 }), {
    canAdd: false,
    canFinalize: false,
    detail: "待对应路线完成组装打包",
  });
  assert.deepEqual(projectPackageCountAvailability({ kind: "MANUFACTURED_ROUTE", prerequisiteComplete: true, total: 0 }), {
    canAdd: true,
    canFinalize: true,
    detail: "组装打包已完成，请登记实际包件数",
  });
});

test("发货包件数按五金、自产入库和外购入库实时汇总", () => {
  const source = (kind: "HARDWARE_AREA" | "MANUFACTURED_AREA" | "MANUFACTURED_ROUTE" | "OUTSOURCED_PRODUCT", total: number, status: "OPEN" | "FINALIZED", id = "1") => ({ sourceKey: `${kind}:${id}`, kind, label: kind, status, total, handoffConfirmed: false, canAdd: true, canFinalize: true, entries: [] });
  const partial = projectPackageSummary({ sources: [source("HARDWARE_AREA", 5, "FINALIZED"), source("MANUFACTURED_AREA", 30, "FINALIZED"), source("OUTSOURCED_PRODUCT", 0, "OPEN")] });
  assert.equal(partial.currentTotal, 35);
  assert.equal(partial.status, "PARTIAL");
  const complete = projectPackageSummary({ sources: [source("HARDWARE_AREA", 5, "FINALIZED"), source("MANUFACTURED_AREA", 30, "FINALIZED"), source("OUTSOURCED_PRODUCT", 4, "FINALIZED")] });
  assert.equal(complete.currentTotal, 39);
  assert.equal(complete.status, "COMPLETE");

  const routes = projectPackageSummary({ sources: [source("HARDWARE_AREA", 5, "FINALIZED"), source("MANUFACTURED_ROUTE", 12, "FINALIZED", "panel"), source("MANUFACTURED_ROUTE", 8, "FINALIZED", "wood")] });
  assert.equal(routes.manufacturedTotal, 20);
  assert.equal(routes.currentTotal, 25);
});

test("历史已结束订单不将旧件数冒充新口径", () => {
  const result = projectPackageSummary({ sources: [], legacyClosed: true, legacyApplicationEstimate: 88, legacyShipmentPieceTotal: 90 });
  assert.equal(result.status, "LEGACY_UNVERIFIED");
  assert.equal(result.currentTotal, 0);
  assert.equal(result.legacyApplicationEstimate, 88);
});
