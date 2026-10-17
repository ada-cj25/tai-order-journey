import assert from "node:assert/strict";
import test from "node:test";
import { allowedCreationModes, canCreateLinkedSupplement, canReadPaymentAmounts, canReadPaymentReceipt, canReportPayment, effectiveCreationMode, isCommerciallyConfirmedFree, tailPaymentSatisfied } from "./commercial-policy.js";

test("creation modes are role-scoped", () => {
  assert.deepEqual(allowedCreationModes("SALES"), ["SALES_STANDARD"]);
  assert.deepEqual(allowedCreationModes("DESIGNER"), ["INTERNAL_EXCEPTION"]);
  assert.deepEqual(allowedCreationModes("TECHNICAL"), ["INTERNAL_EXCEPTION"]);
  assert.deepEqual(allowedCreationModes("ORDER_ADMIN"), ["INTERNAL_EXCEPTION"]);
  assert.deepEqual(allowedCreationModes("CHAIRMAN"), ["SALES_STANDARD", "INTERNAL_EXCEPTION"]);
  assert.deepEqual(allowedCreationModes("FINANCE"), []);
});

test("可查看正单的活跃业务岗位都可从该正单创建补单", () => {
  for (const role of ["SALES", "DESIGNER", "TECHNICAL", "ORDER_ADMIN", "CHAIRMAN", "FINANCE", "PROCUREMENT", "WORKSHOP", "INSTALLER", "AFTERSALES"]) {
    assert.equal(canCreateLinkedSupplement(role), true, role);
  }
  assert.equal(canCreateLinkedSupplement("WAREHOUSE"), false);
});

test("关联补单始终继承正单建单模式，不接受当前岗位默认值覆盖", () => {
  assert.equal(effectiveCreationMode("INTERNAL_EXCEPTION", "SALES_STANDARD"), "SALES_STANDARD");
  assert.equal(effectiveCreationMode("SALES_STANDARD", "INTERNAL_EXCEPTION"), "INTERNAL_EXCEPTION");
  assert.equal(effectiveCreationMode(undefined, null, "INSTALLER"), "INTERNAL_EXCEPTION");
});

test("free exceptional order satisfies shipment payment gate only after approval", () => {
  const draft = { creationMode: "INTERNAL_EXCEPTION" as const, chargeMode: "FREE" as const, commercialConfirmedAt: null, tailPaymentConfirmed: false };
  assert.equal(isCommerciallyConfirmedFree(draft), false);
  assert.equal(tailPaymentSatisfied(draft), false);
  assert.equal(tailPaymentSatisfied({ ...draft, commercialConfirmedAt: new Date() }), true);
});

test("internal charged payment belongs to order admin while finance owns receipt review", () => {
  const order = { creationMode: "INTERNAL_EXCEPTION" as const, chargeMode: "CHARGED" as const, commercialConfirmedAt: new Date(), salesId: null };
  assert.equal(canReportPayment({ id: "admin", role: "ORDER_ADMIN" }, order), true);
  assert.equal(canReportPayment({ id: "sales", role: "SALES" }, order), false);
  assert.equal(canReadPaymentAmounts({ id: "chair", role: "CHAIRMAN" }, order), true);
  assert.equal(canReadPaymentReceipt({ id: "chair", role: "CHAIRMAN" }, order), false);
  assert.equal(canReadPaymentReceipt({ id: "admin", role: "ORDER_ADMIN" }, order), true);
});

test("sales supervisor may view brand orders but cannot report for another salesperson", () => {
  const order = { creationMode: "SALES_STANDARD" as const, chargeMode: "CHARGED" as const, salesId: "sales-owner" };
  assert.equal(canReportPayment({ id: "sales-owner", role: "SALES" }, order), true);
  assert.equal(canReportPayment({ id: "brand-supervisor", role: "SALES" }, order), false);
  assert.equal(canReadPaymentAmounts({ id: "brand-supervisor", role: "SALES" }, order), false);
  assert.equal(canReadPaymentReceipt({ id: "brand-supervisor", role: "SALES" }, order), false);
});
