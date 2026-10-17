import assert from "node:assert/strict";
import test from "node:test";
import { orderTimelineDisplay } from "../src/order-timeline-display";

const sources = [{ sourceKey: "MANUFACTURED_ROUTE:8e738918-16d0-4b79-bd66-9ab6d14b16e7", label: "客厅·板式路线·自产成品入库" }];

test("historical package events show the route and action without an internal ID", () => {
  const added = orderTimelineDisplay({ type: "PACKAGE_COUNT_ADD_COUNT", title: "发货包件统计已更新", description: "MANUFACTURED_ROUTE:8e738918-16d0-4b79-bd66-9ab6d14b16e7·ADD_COUNT", metadata: { sourceKey: sources[0]!.sourceKey, command: "ADD_COUNT", quantity: 5 } }, sources);
  assert.equal(added.title, "客厅·板式路线 · 追加 5 包件");
  assert.equal(added.description, "");

  const finalized = orderTimelineDisplay({ type: "PACKAGE_COUNT_FINALIZE_SOURCE", title: "发货包件统计已更新", description: "MANUFACTURED_ROUTE:8e738918-16d0-4b79-bd66-9ab6d14b16e7·FINALIZE_SOURCE", metadata: { sourceKey: sources[0]!.sourceKey } }, sources);
  assert.equal(finalized.title, "客厅·板式路线 · 统计完成");
  assert.doesNotMatch(`${finalized.title}${finalized.description}`, /8e738918|FINALIZE_SOURCE/);
});

test("package event without a current source still hides the internal ID", () => {
  const result = orderTimelineDisplay({ type: "PACKAGE_COUNT_ADD_COUNT", title: "发货包件统计已更新", description: "MANUFACTURED_ROUTE:8e738918-16d0-4b79-bd66-9ab6d14b16e7·ADD_COUNT", metadata: { sourceKey: sources[0]!.sourceKey, quantity: 2 } }, []);
  assert.equal(result.title, "自产路线包件 · 追加 2 包件");
  assert.doesNotMatch(`${result.title}${result.description}`, /8e738918|MANUFACTURED_ROUTE|ADD_COUNT/);
});

test("new package events retain their business label and void reason", () => {
  const result = orderTimelineDisplay({ type: "PACKAGE_COUNT_VOID_ENTRY", title: "发货包件统计已更新", description: "", metadata: { sourceKey: sources[0]!.sourceKey, sourceLabel: "主卧·板式路线", reason: "重复录入" } }, []);
  assert.deepEqual(result, { title: "主卧·板式路线 · 包件记录已作废", description: "原因：重复录入" });
});

test("other timeline records remain unchanged", () => {
  const event = { type: "SUBMIT_DESIGN", title: "设计师正式提交", description: "客户确认图已提交" };
  assert.deepEqual(orderTimelineDisplay(event, sources), { title: event.title, description: event.description });
});
