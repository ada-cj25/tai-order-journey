import assert from "node:assert/strict";
import test from "node:test";
import { groupPackageActions, selectPackageActions, type MiniPackageAction } from "../domain/package-workbench";

function action(orderId: string, sourceKey: string, kind: MiniPackageAction["kind"], label: string, total: number): MiniPackageAction {
  return {
    orderId, customerName: "小冉酱", salesNumber: orderId === "order-1" ? "N26100001" : "N26100002",
    trackingSerial: `GD-${orderId}`, productionAreaId: sourceKey, sourceKey, kind, label,
    actionLabel: kind === "HARDWARE_AREA" ? "确认领五金" : "统计包件", total,
  };
}

test("assembly package queue groups by order while keeping every source independently actionable", () => {
  const actions = [
    action("order-1", "hardware-kitchen", "HARDWARE_AREA", "厨房·五金包", 2),
    action("order-1", "hardware-balcony", "HARDWARE_AREA", "阳台·五金包", 1),
    action("order-1", "manufactured-kitchen", "MANUFACTURED_ROUTE", "厨房·板式路线·自产成品入库", 3),
    action("order-2", "hardware-bedroom", "HARDWARE_AREA", "主卧·五金包", 4),
    action("order-2", "outsourced-sink", "OUTSOURCED_PRODUCT", "台盆·外购入库", 1),
  ];
  const groups = groupPackageActions(actions);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => [group.orderId, group.actionCount, group.hardwareCount, group.hardwareTotal, group.manufacturedCount, group.outsourcedCount]), [
    ["order-1", 3, 2, 3, 1, 0],
    ["order-2", 2, 1, 4, 0, 1],
  ]);
  assert.deepEqual(groups[0].sections.map((section) => [section.key, section.actions.map((item) => item.sourceKey)]), [
    ["hardware", ["hardware-kitchen", "hardware-balcony"]],
    ["manufactured", ["manufactured-kitchen"]],
  ]);
  assert.deepEqual(selectPackageActions(actions, "N26100002").map((item) => item.sourceKey), ["hardware-bedroom", "outsourced-sink"]);
  assert.deepEqual(selectPackageActions(actions, "阳台").map((item) => item.sourceKey), ["hardware-balcony"]);
});
