import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateDelayDays,
  calculateProductionWindow,
  calculateSchedule,
  calculateTechnicalCapacitySlot,
  categoryDigit,
  assertTransition,
  validateManufacturedShipmentLines,
  productionNumber,
  salesNumber,
  salesPrefix,
  resolveWarranty,
  shipmentAllowed,
  workingDaysForTechnicalAmount,
} from "./rules.js";

test("production numbers use the confirmed category digits and monthly sequence", () => {
  const date = new Date(2026, 8, 1, 9);
  assert.equal(productionNumber("NOERLI_FORMAL", date, 1), "26091001");
  assert.equal(productionNumber("NOERLI_SUPPLEMENT", date, 1), "补单-B26090001");
  assert.equal(productionNumber("AIKEJU_FORMAL", date, 1), "26099001");
  assert.equal(productionNumber("AIKEJU_SUPPLEMENT", date, 1), "补单-B26098001");
  assert.equal(productionNumber("CHANNEL_SUPPLEMENT", date, 1), "补单-B26095001");
  assert.equal(productionNumber("ENGINEERING_SUPPLEMENT", date, 1), "补单-B26097001");
  assert.equal(productionNumber("WORKWEAR_SUPPLEMENT", date, 1), "补单-B26097001");
  assert.equal(productionNumber("WORKWEAR_FORMAL", date, 1), "26097001");
  assert.equal(categoryDigit("CHANNEL_FORMAL"), categoryDigit("CHANNEL_SUPPLEMENT"));
  assert.throws(() => productionNumber("NOERLI_FORMAL", date, 1000));
});

test("sales numbers use brand prefixes and an independent four-digit monthly sequence", () => {
  const date = new Date("2026-09-01T08:00:00+08:00");
  assert.equal(salesNumber("NOERLI_FORMAL", date, 1), "N26090001");
  assert.equal(salesNumber("NOERLI_SUPPLEMENT", date, 2), "N26090002");
  assert.equal(salesNumber("AIKEJU_FORMAL", date, 9), "A26090009");
  assert.equal(salesPrefix("CHANNEL_SUPPLEMENT"), "C");
  assert.equal(salesPrefix("ENGINEERING_FORMAL"), "E");
  assert.equal(salesPrefix("WORKWEAR_FORMAL"), "W");
  assert.throws(() => salesNumber("NOERLI_FORMAL", date, 10000));
});

test("standard lead time is calendar based while internal Sundays move to Monday", () => {
  const signed = new Date(2026, 7, 1, 10);
  const finished = calculateSchedule(signed, "FINISHED");
  const rough = calculateSchedule(signed, "ROUGH");
  assert.equal(finished.standardDueAt.getDate(), 3);
  assert.equal(finished.standardDueAt.getMonth(), 8);
  assert.equal(rough.standardDueAt.getDate(), 7);
  assert.equal(rough.sundayRisk, false);

  const sundayDue = calculateSchedule(new Date(2026, 6, 7, 10), "FINISHED");
  assert.equal(sundayDue.effectiveDueAt.getDay(), 0);
  assert.equal(sundayDue.internalDueAt.getDay(), 1);
  assert.equal(sundayDue.reminderAt.getDay(), 6);
  assert.equal(sundayDue.internalDueAt.getHours(), 17);
});

test("production maximum starts at design submission and paint adds five calendar days", () => {
  const submitted = new Date(2026, 7, 28, 10);
  assert.equal(calculateProductionWindow(submitted, "FINISHED", "MELAMINE").calendarDays, 33);
  assert.equal(calculateProductionWindow(submitted, "ROUGH", "MELAMINE").calendarDays, 37);
  assert.equal(calculateProductionWindow(submitted, "FINISHED", "PAINT").calendarDays, 38);
  assert.equal(calculateProductionWindow(submitted, "ROUGH", "PAINT").calendarDays, 42);
  assert.equal(calculateProductionWindow(submitted, "ROUGH", "PAINT", 2).calendarDays, 62);
});

test("technical capacity, delay and tail-payment shipment gate follow business rules", () => {
  assert.equal(workingDaysForTechnicalAmount(286_000), 5);
  assert.equal(calculateDelayDays(new Date("2026-08-01T17:00:00+08:00"), new Date("2026-08-03T10:00:00+08:00")), 2);
  assert.equal(shipmentAllowed(false, true), false);
  assert.equal(shipmentAllowed(true, false), false);
  assert.equal(shipmentAllowed(true, true), true);
});

test("new contracts stay at contract signing until finance verifies both initial payments", () => {
  assert.equal(assertTransition("DEPOSIT_PENDING", "REPORT_DEPOSIT").to, "DEPOSIT_PENDING");
  assert.equal(assertTransition("DEPOSIT_PENDING", "REPORT_PREPAYMENT").to, "DEPOSIT_PENDING");
  assert.equal(assertTransition("DEPOSIT_PENDING", "CONFIRM_INITIAL_PAYMENTS").to, "DESIGN_PENDING");
});

test("shipment accepts multiple areas and repeated non-final batches but closes an area at its final batch", () => {
  const areas = [{ id: "living", complete: true, finalShipmentRecorded: false }, { id: "bedroom", complete: true, finalShipmentRecorded: false }];
  assert.equal(validateManufacturedShipmentLines(areas, [{ productionAreaId: "living", isFinalBatch: false }, { productionAreaId: "bedroom", isFinalBatch: true }]).length, 2);
  assert.throws(() => validateManufacturedShipmentLines([{ ...areas[0], complete: false }], [{ productionAreaId: "living", isFinalBatch: false }]), /已完成全部车间工序/);
  assert.throws(() => validateManufacturedShipmentLines([{ ...areas[0], finalShipmentRecorded: true }], [{ productionAreaId: "living", isFinalBatch: false }]), /已登记末批/);
});

test("technical capacity blocks include the entry day, skip Sundays and never overlap", () => {
  const first = calculateTechnicalCapacitySlot(new Date(2026, 7, 28, 10), 120_000);
  assert.equal(first.workloadDays, 2);
  assert.equal(first.plannedStartAt.getDate(), 28);
  assert.equal(first.dueAt.getDate(), 29);
  assert.equal(first.dueAt.getHours(), 17);

  const second = calculateTechnicalCapacitySlot(new Date(2026, 7, 28, 11), 60_000, first.dueAt);
  assert.equal(second.plannedStartAt.getDay(), 1);
  assert.equal(second.plannedStartAt.getDate(), 31);
  assert.equal(second.dueAt.getDate(), 31);
  assert.ok(second.plannedStartAt > first.dueAt);
});

test("warranty is brand-based and starts at final acceptance", () => {
  const accepted = new Date(2026, 8, 1, 12);
  assert.equal(resolveWarranty("NOERLI_FORMAL", accepted).expiresAt?.getFullYear(), 2046);
  assert.equal(resolveWarranty("AIKEJU_SUPPLEMENT", accepted).expiresAt?.getFullYear(), 2036);
  assert.equal(resolveWarranty("CHANNEL_FORMAL", accepted).automatic, false);
});
