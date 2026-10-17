import assert from "node:assert/strict";
import test from "node:test";
import { projectActionableInitialPaymentTasks } from "./initial-payment-task-projection.js";

const order = {
  id: "order-contract-payment",
  salesId: "sales-1",
  trackingSerial: "GD-260910-179980310",
  salesNumber: null,
  productionNumber: null,
  customerName: "一只大白马",
  stage: "DEPOSIT_PENDING",
  rush: false,
  internalDueAt: new Date("2026-11-02T17:00:00+08:00"),
  prepaymentRequired: true,
  depositReported: true,
  depositConfirmed: false,
  prepaymentReported: true,
  prepaymentConfirmed: false,
};

test("两笔签约首付款报备完成后进入财务个人待办", () => {
  const tasks = projectActionableInitialPaymentTasks(
    { id: "finance-1", role: "FINANCE", department: "财务部" },
    [order],
    new Date("2026-09-10T12:00:00+08:00"),
  );
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.title, "同时核验定金与预付款");
  assert.equal(tasks[0]?.order.trackingSerial, "GD-260910-179980310");
});

test("两笔签约首付款未报备完整时只进入所属销售待办", () => {
  const incomplete = { ...order, prepaymentReported: false };
  assert.equal(projectActionableInitialPaymentTasks({ id: "finance-1", role: "FINANCE", department: "财务部" }, [incomplete]).length, 0);
  const salesTasks = projectActionableInitialPaymentTasks({ id: "sales-1", role: "SALES", department: "诺尔丽销售部" }, [incomplete]);
  assert.equal(salesTasks[0]?.title, "报备预付款收款");
  assert.equal(projectActionableInitialPaymentTasks({ id: "sales-2", role: "SALES", department: "诺尔丽销售部" }, [incomplete]).length, 0);
});

test("首付款全部核验后不再显示待办", () => {
  const confirmed = { ...order, depositConfirmed: true, prepaymentConfirmed: true };
  assert.equal(projectActionableInitialPaymentTasks({ id: "finance-1", role: "FINANCE", department: "财务部" }, [confirmed]).length, 0);
});

test("非常规订单先进入订单管理员商务确认待办，收费确认后转给财务", () => {
  const pending = { ...order, salesId: null, creationMode: "INTERNAL_EXCEPTION" as const, chargeMode: "FREE" as const, commercialConfirmedAt: null, prepaymentRequired: false, depositReported: false, prepaymentReported: false };
  const adminTasks = projectActionableInitialPaymentTasks({ id: "admin", role: "ORDER_ADMIN", department: "订单中心" }, [pending]);
  assert.equal(adminTasks[0]?.title, "确认非常规订单商务方式");
  assert.equal(projectActionableInitialPaymentTasks({ id: "finance", role: "FINANCE", department: "财务部" }, [pending]).length, 0);

  const charged = { ...pending, chargeMode: "CHARGED" as const, commercialConfirmedAt: new Date(), depositReported: true };
  assert.equal(projectActionableInitialPaymentTasks({ id: "admin", role: "ORDER_ADMIN", department: "订单中心" }, [charged]).length, 0);
  assert.equal(projectActionableInitialPaymentTasks({ id: "finance", role: "FINANCE", department: "财务部" }, [charged])[0]?.title, "核验定金到账");
});
