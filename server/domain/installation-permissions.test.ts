import assert from "node:assert/strict";
import test from "node:test";
import { canExecuteOrderCommand } from "./order-command-permissions.js";

test("only installation staff or the chairman can complete installation", () => {
  assert.equal(canExecuteOrderCommand("INSTALLER", "COMPLETE_INSTALLATION_BATCH"), true);
  assert.equal(canExecuteOrderCommand("CHAIRMAN", "COMPLETE_INSTALLATION_BATCH"), true);
  assert.equal(canExecuteOrderCommand("ORDER_ADMIN", "COMPLETE_INSTALLATION_BATCH"), false);
  assert.equal(canExecuteOrderCommand("INSTALLER", "COMPLETE_INSTALLATION"), false);
});

test("the historical order-level installation application command is inactive", () => {
  for (const role of ["ORDER_ADMIN", "INSTALLER", "CHAIRMAN"] as const) {
    assert.equal(canExecuteOrderCommand(role, "SUBMIT_INSTALLATION_APPLICATION"), false);
  }
});

test("removing installation completion does not remove the order administrator's customer acceptance authority", () => {
  assert.equal(canExecuteOrderCommand("ORDER_ADMIN", "ACCEPT_CUSTOMER"), true);
});

test("only the current design role can use the pre-intake return command", () => {
  assert.equal(canExecuteOrderCommand("DESIGNER", "RETURN_DESIGN"), true);
  assert.equal(canExecuteOrderCommand("ORDER_ADMIN", "RETURN_DESIGN"), false);
  assert.equal(canExecuteOrderCommand("CHAIRMAN", "RETURN_DESIGN"), false);
  assert.equal(canExecuteOrderCommand("SALES", "ASSIGN_DESIGNER"), true);
  assert.equal(canExecuteOrderCommand("DESIGNER", "TRANSFER_DESIGN"), true);
});

test("payment command roles allow sales standard reporting and internal order-admin reporting", () => {
  for (const command of ["REPORT_DEPOSIT", "REPORT_TAIL_PAYMENT"] as const) {
    assert.equal(canExecuteOrderCommand("SALES", command), true);
    assert.equal(canExecuteOrderCommand("ORDER_ADMIN", command), true);
    assert.equal(canExecuteOrderCommand("CHAIRMAN", command), false);
    assert.equal(canExecuteOrderCommand("FINANCE", command), false);
  }
  assert.equal(canExecuteOrderCommand("SALES", "REPORT_PREPAYMENT"), true);
  assert.equal(canExecuteOrderCommand("ORDER_ADMIN", "REPORT_PREPAYMENT"), false);
});
