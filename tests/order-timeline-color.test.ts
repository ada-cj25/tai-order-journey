import assert from "node:assert/strict";
import test from "node:test";
import { orderTimelineColor } from "../src/order-timeline-color";

test("all return and rejection events use a red dot", () => {
  for (const event of [
    { type: "RETURN_DESIGN", title: "设计师退回销售" },
    { type: "REJECT_PRE_REVIEW", title: "前置审单退回" },
    { type: "REJECT_TECH_REVIEW", title: "拆单审核退回" },
    { type: "REJECT_SUPPLIER_QUOTE", title: "财务退回采购报价" },
    { type: "COMPLETE_PURCHASE_RETURN", title: "不合格品已退回供应商" },
    { type: "LEGACY_REVIEW", title: "历史审单驳回" },
  ]) assert.equal(orderTimelineColor(event), "red", event.type);
});

test("voided records use a red dot", () => {
  for (const event of [
    { type: "OUTSOURCE_ARRIVAL_VOIDED", title: "外购到货记录已作废" },
    { type: "AFTERSALES_COST_VOIDED", title: "售后费用已作废" },
    { type: "CANCEL_PRODUCTION_AREA", title: "生产区域已作废" },
    { type: "LEGACY_EVENT", title: "历史记录已作废" },
  ]) assert.equal(orderTimelineColor(event), "red", event.type);
});

test("all non-return records use a green dot", () => {
  for (const event of [
    { type: "SUBMIT_DESIGN", title: "设计师正式提交" },
    { type: "APPROVE_PRE_REVIEW", title: "前置审单通过" },
    { type: "COMPLETE_PRODUCTION_ROUTE", title: "生产路线已完工" },
    { type: "ASSIGN_DESIGNER", title: "销售重新分配设计师" },
    { type: "TRANSFER_DESIGN", title: "设计任务已转交" },
    { type: "PRODUCTION_ISSUE", title: "车间工序异常" },
    { type: "CONTRACT_AMOUNT_UPDATED", title: "合同金额已调整" },
    { type: "UNCLASSIFIED_EVENT", title: "其他记录" },
  ]) assert.equal(orderTimelineColor(event), "green", event.type);
});
