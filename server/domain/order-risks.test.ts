import assert from "node:assert/strict";
import test from "node:test";
import { deriveOrderRisks } from "./order-risks.js";

test("安装申请未提交不再投影为发货风险", () => {
  const risks = deriveOrderRisks({ stage: "INSTALLATION_APPLICATION", tailPaymentConfirmed: true, installationApplied: false });
  assert.equal(risks.length, 0);
});

test("外购已齐套只在发货执行展示，风险区仅保留真实阻断", () => {
  const common = {
    stage: "MATERIALS",
    tailPaymentConfirmed: false,
    installationApplied: false,
    fulfillmentTracks: {
      outsourced: {
        applicable: true,
        allShipped: false,
        readyCount: 1,
        lines: [{ name: "铝框玻璃门", status: "READY" }, { name: "铝蜂窝柜", status: "PARTIAL" }],
      },
    },
  };
  const procurementRisks = deriveOrderRisks(common);
  assert.deepEqual(procurementRisks.map((risk) => risk.type), []);

  const deliveryRisks = deriveOrderRisks({ ...common, stage: "DELIVERY", installationApplied: true });
  assert.deepEqual(deliveryRisks.map((risk) => risk.type), ["TAIL_PAYMENT", "OUTSOURCE_NOT_READY"]);
  assert.equal(deliveryRisks.find((risk) => risk.type === "OUTSOURCE_NOT_READY")?.responsible, "订单管理员");
});

test("生产期间不提前显示尾款或安装申请发货条件", () => {
  const risks = deriveOrderRisks({ stage: "PRODUCTION", tailPaymentConfirmed: false, tailPaymentReported: false, installationApplied: false });
  assert.deepEqual(risks.map((risk) => risk.resolutionCommand), []);
});

test("生产期间有路线已完工时投影真实尾款阻断", () => {
  const risks = deriveOrderRisks({
    stage: "PRODUCTION", tailPaymentConfirmed: false, tailPaymentReported: false, installationApplied: false,
    fulfillmentTracks: {
      manufactured: { routes: [{ productionAreaId: "area-a", kind: "PANEL", complete: true, shipped: false }] },
      outsourced: { applicable: false, allShipped: true, readyCount: 0, lines: [] },
    },
  });
  assert.deepEqual(risks.map((risk) => risk.type), ["TAIL_PAYMENT"]);
  assert.equal(risks[0]?.responsible, "所属销售");
});

test("车间异常以每道工序最后一次报工为准，后续完成会解除风险", () => {
  const common = { stage: "PRODUCTION", tailPaymentConfirmed: true, installationApplied: true };
  const issue = { id: "r1", productionProcessId: "p1", action: "ISSUE", note: "尺寸异常", reportedAt: "2026-08-29T01:00:00Z", process: { workshopLabel: "板式车间", processName: "开料" } };
  assert.equal(deriveOrderRisks({ ...common, productionReports: [issue] }).length, 1);
  assert.equal(deriveOrderRisks({ ...common, productionReports: [issue, { ...issue, id: "r2", action: "COMPLETE", reportedAt: "2026-08-29T02:00:00Z" }] }).length, 0);
});

test("已逾期待办展示责任部门并说明完成动作可解除", () => {
  const risks = deriveOrderRisks({ stage: "TECHNICAL", tailPaymentConfirmed: false, installationApplied: false, tasks: [{ id: "t1", title: "技术拆单", department: "技术部", status: "OVERDUE", dueAt: "2026-08-28T09:00:00Z" }] });
  assert.equal(risks[0].responsible, "技术部");
  assert.match(risks[0].impact, /完成业务动作后自动解除/);
});

test("旧版库存与线上采购待办不再投影为订单风险", () => {
  const common = { stage: "MATERIALS", tailPaymentConfirmed: false, installationApplied: false };
  const tasks = [
    { id: "legacy-procurement", title: "采购询价", department: "采购部", status: "OVERDUE", dueAt: "2026-08-20T09:00:00Z", uniqueKey: "order-1:MATERIALS:PROCUREMENT" },
    { id: "legacy-price-review", title: "采购报价待审价", department: "财务部", status: "OVERDUE", dueAt: "2026-08-21T09:00:00Z", uniqueKey: "PRICE_REVIEW:quote-1" },
    { id: "legacy-po", title: "生成采购单", department: "采购部", status: "OVERDUE", dueAt: "2026-08-22T09:00:00Z", uniqueKey: "CREATE_PO:quote-1" },
  ];
  const risks = deriveOrderRisks({ ...common, tasks });
  assert.deepEqual(risks.map((risk) => risk.type), []);
  assert.equal(risks.some((risk) => risk.type === "OVERDUE_TASK"), false);
});
