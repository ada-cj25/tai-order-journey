import assert from "node:assert/strict";
import test from "node:test";
import { formatMockProductionNumber, mockProductionDeadline } from "../domain/mock-production-rules.ts";

test("test production numbers keep the desktop category digit without consuming its pool", () => {
  const assignedAt = "2026-10-12T08:00:00+08:00";
  assert.equal(formatMockProductionNumber({ businessType: "NOERLI_FORMAL" }, assignedAt, 1), "TEST-26101001");
  assert.equal(formatMockProductionNumber({ businessType: "NOERLI_SUPPLEMENT" }, assignedAt, 2), "TEST-补单-B26100002");
  assert.equal(formatMockProductionNumber({ businessType: "AIKEJU_FORMAL" }, assignedAt, 3), "TEST-26109003");
  assert.equal(formatMockProductionNumber({ businessType: "CHANNEL_SUPPLEMENT" }, assignedAt, 4), "TEST-补单-B26105004");
});

test("production deadline starts at design submission, uses site and finish duration, and moves Sunday to Monday", () => {
  const submittedAt = "2026-10-12T13:00:00+08:00";
  assert.equal(mockProductionDeadline({ siteType: "FINISHED", finishType: "MELAMINE" }, submittedAt), "2026-11-14T09:00:00.000Z");
  assert.equal(mockProductionDeadline({ siteType: "FINISHED", finishType: "PAINT" }, submittedAt), "2026-11-19T09:00:00.000Z");
  assert.equal(mockProductionDeadline({ siteType: "ROUGH", finishType: "MELAMINE" }, submittedAt), "2026-11-18T09:00:00.000Z");
  assert.equal(mockProductionDeadline({ siteType: "ROUGH", finishType: "PAINT" }, submittedAt), "2026-11-23T09:00:00.000Z");
  assert.equal(mockProductionDeadline({ siteType: "ROUGH", finishType: "MELAMINE", villaFloors: 1 }, submittedAt), "2026-11-28T09:00:00.000Z");
  assert.equal(mockProductionDeadline({ siteType: "FINISHED", finishType: "MELAMINE" }, "2026-10-13T13:00:00+08:00"), "2026-11-16T09:00:00.000Z");
});
