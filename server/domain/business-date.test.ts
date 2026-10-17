import assert from "node:assert/strict";
import test from "node:test";
import { parseShanghaiBusinessDate, shanghaiBusinessDate, shanghaiBusinessDeadline } from "./business-date.js";

test("server shipment date uses the current Shanghai calendar day", () => {
  assert.equal(shanghaiBusinessDate(new Date("2026-09-11T16:30:00.000Z")).toISOString(), "2026-09-11T16:00:00.000Z");
  assert.equal(shanghaiBusinessDate(new Date("2026-09-11T15:59:59.000Z")).toISOString(), "2026-09-10T16:00:00.000Z");
});

test("Shanghai business dates accept only real YYYY-MM-DD values", () => {
  assert.equal(parseShanghaiBusinessDate("2026-09-13").toISOString(), "2026-09-12T16:00:00.000Z");
  assert.equal(parseShanghaiBusinessDate("2028-02-29").toISOString(), "2028-02-28T16:00:00.000Z");
  assert.throws(() => parseShanghaiBusinessDate("2026-02-30"), /日期无效/);
  assert.throws(() => parseShanghaiBusinessDate("2026\/09\/13"), /YYYY-MM-DD/);
});

test("installation tasks are due at 17:00 on the planned Shanghai day", () => {
  const dueAt = shanghaiBusinessDeadline(parseShanghaiBusinessDate("2026-09-13"));
  assert.equal(dueAt.toISOString(), "2026-09-13T09:00:00.000Z");
});
