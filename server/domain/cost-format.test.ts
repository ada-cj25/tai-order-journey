import assert from "node:assert/strict";
import test from "node:test";
import { formatUnitCost } from "../../src/cost-format.js";

test("单位成本显示保留千分位和万分位，总额格式不参与单价格式化", () => {
  assert.equal(formatUnitCost(0.512), "¥0.512");
  assert.equal(formatUnitCost("0.2570"), "¥0.257");
  assert.equal(formatUnitCost(0.0001), "¥0.0001");
  assert.equal(formatUnitCost(29), "¥29.00");
  assert.equal(formatUnitCost(null), "—");
});
