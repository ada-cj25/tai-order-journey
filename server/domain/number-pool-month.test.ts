import test from "node:test";
import assert from "node:assert/strict";
import { numberPoolMonth } from "./number-pool-month.js";
import { yearMonth } from "./rules.js";

test("reviewed bootstrap pools and live allocation use the same month key", () => {
  const allocatedMonth = yearMonth(new Date(2026, 7, 31, 9));
  assert.equal(numberPoolMonth("2608"), allocatedMonth);
  assert.equal(numberPoolMonth("202608"), allocatedMonth);
  for (const value of ["YYMM", "202600", "202613", "2600", "26-08", 2608, null]) assert.throws(() => numberPoolMonth(value));
});
