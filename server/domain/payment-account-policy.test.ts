import assert from "node:assert/strict";
import test from "node:test";
import { normalizePaymentAccountName } from "./payment-account-policy.js";

test("payment account names are normalized and bounded before approval", () => {
  assert.equal(normalizePaymentAccountName("  招商银行   上海基本户  "), "招商银行 上海基本户");
  assert.throws(() => normalizePaymentAccountName(" "), /请填写/);
  assert.throws(() => normalizePaymentAccountName("a"), /2至80/);
});
