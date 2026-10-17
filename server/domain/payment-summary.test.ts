import assert from "node:assert/strict";
import test from "node:test";
import { paymentSummary } from "./payment-summary.js";

test("confirmed deposit and tail receivable come from the submitted receipt fact", () => {
  assert.deepEqual(paymentSummary({ contractAmount: "100000", depositReported: true, depositConfirmed: true, submissions: [{ command: "REPORT_DEPOSIT", status: "SUBMITTED", payload: { receivedAmount: 20000 } }] }), {
    depositStatus: "CONFIRMED", depositReceived: 20000, prepaymentRequired: false, prepaymentStatus: "NOT_REQUIRED", prepaymentReceived: 0, initialPaymentTotal: 20000, tailReceivable: 80000, exception: null,
  });
});

test("a reported but unverified deposit is not shown as received money", () => {
  assert.deepEqual(paymentSummary({ contractAmount: 100000, depositReported: true, depositConfirmed: false, submissions: [{ command: "REPORT_DEPOSIT", status: "SUBMITTED", payload: { receivedAmount: 20000 } }] }), {
    depositStatus: "REPORTED", depositReceived: null, prepaymentRequired: false, prepaymentStatus: "NOT_REQUIRED", prepaymentReceived: 0, initialPaymentTotal: null, tailReceivable: null, exception: null,
  });
});

test("a deposit above the contract amount is exposed as a blocking financial exception", () => {
  assert.deepEqual(paymentSummary({ contractAmount: 100000, depositReported: true, depositConfirmed: true, submissions: [{ command: "REPORT_DEPOSIT", status: "SUBMITTED", payload: { receivedAmount: 200000 } }] }), {
    depositStatus: "CONFIRMED", depositReceived: 200000, prepaymentRequired: false, prepaymentStatus: "NOT_REQUIRED", prepaymentReceived: 0, initialPaymentTotal: 200000, tailReceivable: null, exception: "DEPOSIT_EXCEEDS_CONTRACT",
  });
});

test("new contracts subtract both confirmed deposit and prepayment from the tail", () => {
  assert.deepEqual(paymentSummary({ contractAmount: 100000, depositReported: true, depositConfirmed: true, prepaymentRequired: true, prepaymentReported: true, prepaymentConfirmed: true, submissions: [
    { command: "REPORT_DEPOSIT", status: "SUBMITTED", payload: { receivedAmount: 10000 } },
    { command: "REPORT_PREPAYMENT", status: "SUBMITTED", payload: { receivedAmount: 30000 } },
  ] }), {
    depositStatus: "CONFIRMED", depositReceived: 10000, prepaymentRequired: true, prepaymentStatus: "CONFIRMED", prepaymentReceived: 30000, initialPaymentTotal: 40000, tailReceivable: 60000, exception: null,
  });
});

test("new contracts wait for both initial payments before calculating the tail", () => {
  assert.equal(paymentSummary({ contractAmount: 100000, depositReported: true, depositConfirmed: true, prepaymentRequired: true, prepaymentReported: true, prepaymentConfirmed: false, submissions: [
    { command: "REPORT_DEPOSIT", status: "SUBMITTED", payload: { receivedAmount: 10000 } },
    { command: "REPORT_PREPAYMENT", status: "SUBMITTED", payload: { receivedAmount: 30000 } },
  ] }).tailReceivable, null);
});

test("draft or malformed payment payloads never create a financial total", () => {
  assert.equal(paymentSummary({ contractAmount: 100000, depositReported: true, depositConfirmed: true, submissions: [{ command: "REPORT_DEPOSIT", status: "DRAFT", payload: { receivedAmount: 20000 } }] }).depositReceived, null);
  assert.equal(paymentSummary({ contractAmount: 100000, depositReported: true, depositConfirmed: true, submissions: [{ command: "REPORT_DEPOSIT", status: "SUBMITTED", payload: { receivedAmount: "无效" } }] }).tailReceivable, null);
});
