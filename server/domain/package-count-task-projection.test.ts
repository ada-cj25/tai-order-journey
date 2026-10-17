import assert from "node:assert/strict";
import test from "node:test";
import { projectActionablePackageCountTasks } from "./package-count-task-projection.js";

const base = { id: "o1", trackingSerial: "GD-1", salesNumber: "N1", productionNumber: null, customerName: "客户", stage: "PRODUCTION", rush: false, internalDueAt: new Date("2026-09-20"), productionAreas: [{ id: "a", name: "儿童房", productionNumber: "26091012" }, { id: "b", name: "卫生间", productionNumber: "26091013" }], packageSummary: { currentTotal: 0, status: "NOT_STARTED" as const, hardwareTotal: 0, manufacturedTotal: 0, outsourcedTotal: 0, pendingSources: [], legacyApplicationEstimate: null, legacyShipmentPieceTotal: null, sources: [{ sourceKey: "HARDWARE_AREA:a", kind: "HARDWARE_AREA" as const, label: "儿童房·五金包", productionAreaId: "a", status: "OPEN" as const, total: 0, handoffConfirmed: false, canAdd: true, canFinalize: true, canConfirmHandoff: false, detail: "由采购登记并确认本区域五金包数", entries: [] }] } };

test("采购与组装只收到各自可执行的包件统计待办", () => {
  assert.equal(projectActionablePackageCountTasks({ id: "p", role: "PROCUREMENT", department: "采购部" }, [base]).length, 1);
  assert.equal(projectActionablePackageCountTasks({ id: "a", role: "WORKSHOP", department: "组装", workshop: "ASSEMBLY" }, [base]).length, 0);
  const confirmed = { ...base, packageSummary: { ...base.packageSummary, sources: [{ ...base.packageSummary.sources[0]!, status: "FINALIZED" as const, canConfirmHandoff: true }] } };
  assert.equal(projectActionablePackageCountTasks({ id: "a", role: "WORKSHOP", department: "组装", workshop: "ASSEMBLY" }, [confirmed]).length, 1);
});

test("组装包件待办逐来源投影，已完成来源消失且区域来源保留区域编号", () => {
  const pending = {
    ...base,
    packageSummary: {
      ...base.packageSummary,
      sources: [
        { ...base.packageSummary.sources[0]!, status: "FINALIZED" as const, handoffConfirmed: true, canConfirmHandoff: true },
        { ...base.packageSummary.sources[0]!, sourceKey: "MANUFACTURED_ROUTE:r-b", kind: "MANUFACTURED_ROUTE" as const, label: "卫生间·板式路线·自产成品入库", productionAreaId: "b", status: "OPEN" as const, canAdd: true, total: 0 },
        { ...base.packageSummary.sources[0]!, sourceKey: "OUTSOURCED_PRODUCT:o-1", kind: "OUTSOURCED_PRODUCT" as const, label: "铝蜂窝柜·外购入库", productionAreaId: undefined, status: "OPEN" as const, canAdd: true, total: 1 },
      ],
    },
  };
  const tasks = projectActionablePackageCountTasks({ id: "assembly", role: "WORKSHOP", department: "组装", workshop: "ASSEMBLY" }, [pending]);
  assert.deepEqual(tasks.map((task) => task.uniqueKey), [
    "o1:PACKAGE_COUNT:MANUFACTURED_ROUTE:r-b",
    "o1:PACKAGE_COUNT:OUTSOURCED_PRODUCT:o-1",
  ]);
  assert.deepEqual(tasks[0]?.order.productionArea, { id: "b", name: "卫生间", productionNumber: "26091013" });
  assert.equal(tasks[1]?.order.productionArea, null);
  assert.equal(tasks[1]?.order.taskScopeLabel, "整单外购");
});
