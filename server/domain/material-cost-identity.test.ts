import assert from "node:assert/strict";
import test from "node:test";
import { materialCostIdentity, railSizeMillimetres } from "./material-cost-identity.js";

test("所有铰链型号归并为同一个支价成本键", () => {
  assert.deepEqual(materialCostIdentity("悍玛系列-105°顶级固定式一段力阻尼铰链", "大曲", "支"), {
    normalizedName: "铰链", specification: null, specificationKey: "", unit: "支",
  });
});

test("三节阻尼轨同时识别毫米和寸别名", () => {
  assert.equal(railSizeMillimetres("G2.0双弹簧阻尼钢珠三节轨", "250mm"), "250");
  assert.equal(railSizeMillimetres("三节阻尼轨 14寸", null), "350");
  assert.deepEqual(materialCostIdentity("G2.0双弹簧阻尼钢珠三节轨", "350", "套"), {
    normalizedName: "三节阻尼轨", specification: "350mm / 14寸", specificationKey: "350mm", unit: "套",
  });
});
