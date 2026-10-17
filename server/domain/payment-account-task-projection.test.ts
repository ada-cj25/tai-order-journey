import assert from "node:assert/strict";
import test from "node:test";
import { projectPendingPaymentAccountTasks } from "./payment-account-task-projection.js";

const chairman = { id: "chairman-1", role: "CHAIRMAN", department: "管理层" };

test("pending payment-account requests appear in the chairman's personal queue until reviewed", () => {
  const pending = { id: "account-1", name: "测试收款账户", status: "PENDING", requestedAt: new Date("2026-09-10T08:00:00.000Z") };
  const task = projectPendingPaymentAccountTasks(chairman, [pending])[0];

  assert.equal(task?.title, "审批收款账户：测试收款账户");
  assert.equal(task?.dueAt, null);
  assert.equal(task?.action, "REVIEW_PAYMENT_ACCOUNT");
  assert.equal(task?.paymentAccountId, pending.id);
  assert.deepEqual(projectPendingPaymentAccountTasks(chairman, [{ ...pending, status: "APPROVED" }]), []);
  assert.deepEqual(projectPendingPaymentAccountTasks({ ...chairman, role: "FINANCE" }, [pending]), []);
});
