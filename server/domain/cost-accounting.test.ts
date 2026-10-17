import assert from "node:assert/strict";
import test from "node:test";
import { calculateWorkshopCostLines, summarizeAfterSalesCosts, summarizeInstallationCosts, summarizeOutsourceCosts } from "./cost-accounting.js";

test("外购成本按已审批清单的计划数量和最新已登记单价归集，缺价不假装完成", () => {
  assert.deepEqual(summarizeOutsourceCosts([{ plannedQty: 3, unitPrice: 12.3456 }, { plannedQty: 2, unitPrice: null }]), { subtotal: 37.04, missingPriceCount: 1, complete: false });
  assert.deepEqual(summarizeOutsourceCosts([{ plannedQty: 1, unitPrice: 0 }]), { subtotal: 0, missingPriceCount: 0, complete: true });
  assert.deepEqual(summarizeOutsourceCosts([]), { subtotal: 0, missingPriceCount: 0, complete: true });
});

test("车间成本按启用路线的区域面积和快照综合单价计算", () => {
  const lines = calculateWorkshopCostLines({ panelEnabled: true, woodPaintEnabled: true, panelPlanQty: 10, woodPlanQty: 2, paintPlanQty: 2, assemblyPlanQty: 10 }, [
    { id: "panel-v1", workshop: "PANEL", version: 1, unitPrice: 12 },
    { id: "assembly-v1", workshop: "ASSEMBLY", version: 1, unitPrice: 3.4 },
    { id: "wood-v1", workshop: "WOOD", version: 1, unitPrice: 80 },
    { id: "paint-v1", workshop: "PAINT", version: 1, unitPrice: 60 },
  ]);
  assert.deepEqual(lines.map((line) => [line.workshop, line.lineTotal]), [["PANEL", 120], ["WOOD", 160], ["PAINT", 120], ["ASSEMBLY", 34]]);
});

test("未启用路线不产生车间成本行", () => {
  const lines = calculateWorkshopCostLines({ panelEnabled: true, woodPaintEnabled: false, panelPlanQty: 5, woodPlanQty: 0, paintPlanQty: 0, assemblyPlanQty: 5 }, [
    { id: "panel-v1", workshop: "PANEL", version: 1, unitPrice: 12 },
    { id: "assembly-v1", workshop: "ASSEMBLY", version: 1, unitPrice: 3.4 },
  ]);
  assert.deepEqual(lines.map((line) => line.workshop), ["PANEL", "ASSEMBLY"]);
});

test("安装成本按区域批次安装费加车次运输费归集", () => {
  const result = summarizeInstallationCosts([
    { installedAt: "2026-09-10", transportCost: 120, areas: [{ productionAreaId: "living", sequence: 1, installationFee: 300, isFinalBatch: false }, { productionAreaId: "bedroom", sequence: 1, installationFee: 200, isFinalBatch: true }] },
    { installedAt: "2026-09-11", transportCost: 80, areas: [{ productionAreaId: "living", sequence: 2, installationFee: 150, isFinalBatch: true }] },
  ], ["living", "bedroom"]);
  assert.deepEqual(result, { installationFees: 650, transportFees: 200, subtotal: 850, complete: true });
});

test("已作废区域的末批不能代替有效区域收口", () => {
  const result = summarizeInstallationCosts([
    { installedAt: "2026-09-10", transportCost: 100, areas: [{ productionAreaId: "cancelled", sequence: 1, installationFee: 100, isFinalBatch: true }] },
  ], ["living"]);
  assert.equal(result.complete, false);
});

test("技术审单历史安装费不再提前进入成本，发货批次才是唯一来源", () => {
  const result = summarizeInstallationCosts([], ["living", "bedroom"]);
  assert.equal(result.installationFees, 0);
  assert.equal(result.subtotal, 0);
  assert.equal(result.complete, false);
});

test("售后成本只累计有效批次并始终保持累计状态", () => {
  assert.deepEqual(summarizeAfterSalesCosts([{ amount: 120.55 }, { amount: 80, voidedAt: "2026-09-12" }, { amount: 29.45 }]), { status: "CUMULATIVE", subtotal: 150 });
});
