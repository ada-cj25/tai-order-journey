import assert from "node:assert/strict";
import test from "node:test";
import { collectPreservedFormValues } from "../../src/workflow-form-values.js";

test("final workflow step submits values preserved from unmounted earlier steps", async () => {
  let requestedAllValues = false;
  const form = {
    validateFields: async () => ({}),
    getFieldsValue: (all: boolean) => {
      requestedAllValues = all;
      return all ? { receivedAmount: 5201314, receivedAt: "2026-08-28T20:30:00+08:00", account: "公司账户" } : {};
    },
  };

  const values = await collectPreservedFormValues(form);

  assert.equal(requestedAllValues, true);
  assert.deepEqual(values, { receivedAmount: 5201314, receivedAt: "2026-08-28T20:30:00+08:00", account: "公司账户" });
});
