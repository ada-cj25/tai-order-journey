import assert from "node:assert/strict";
import test from "node:test";
import { projectActionableShipmentTasks } from "./shipment-task-projection.js";

const order = {
  id: "order-a26090003",
  salesId: "sales-aikeju-1",
  trackingSerial: "GD-260901-492667017",
  salesNumber: "A26090003",
  productionNumber: null,
  customerName: "山羊",
  stage: "DELIVERY",
  rush: false,
  internalDueAt: new Date("2026-10-04T17:00:00+08:00"),
  tailPaymentReported: false,
  tailPaymentConfirmed: false,
  tasks: [{ dueAt: new Date("2026-09-14T17:00:00+08:00") }],
};

test("发货阶段未报备尾款时进入所属销售的个人待办", () => {
  const tasks = projectActionableShipmentTasks(
    { id: "sales-aikeju-1", role: "SALES", department: "艾可居销售部" },
    [order],
  );
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.title, "报备尾款收款");
  assert.equal(tasks[0]?.ownerId, "sales-aikeju-1");
  assert.equal(tasks[0]?.order.salesNumber, "A26090003");
});

test("尾款报备后从销售待办消失并进入财务待办", () => {
  const reported = { ...order, tailPaymentReported: true };
  assert.equal(projectActionableShipmentTasks({ id: "sales-aikeju-1", role: "SALES", department: "艾可居销售部" }, [reported]).length, 0);
  const financeTasks = projectActionableShipmentTasks({ id: "finance-1", role: "FINANCE", department: "财务部" }, [reported]);
  assert.equal(financeTasks[0]?.title, "核验尾款到账");
  assert.equal(financeTasks[0]?.ownerId, "finance-1");
});

test("其他销售不能看到不属于自己的尾款报备待办", () => {
  const tasks = projectActionableShipmentTasks(
    { id: "sales-aikeju-2", role: "SALES", department: "艾可居销售部" },
    [order],
  );
  assert.deepEqual(tasks, []);
});

test("订单仍在生产阶段但已有完工路线时立即生成首批发货尾款待办", () => {
  const routeReadyOrder = { ...order, stage: "PRODUCTION", shipmentReady: true };
  const tasks = projectActionableShipmentTasks(
    { id: "sales-aikeju-1", role: "SALES", department: "艾可居销售部" },
    [routeReadyOrder],
  );
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.title, "报备尾款收款");
  assert.equal(tasks[0]?.stage, "PRODUCTION");
});

test("非常规收费单由订单管理员报备尾款，免费单不产生付款待办", () => {
  const charged = { ...order, salesId: null, creationMode: "INTERNAL_EXCEPTION" as const, chargeMode: "CHARGED" as const, commercialConfirmedAt: new Date() };
  const tasks = projectActionableShipmentTasks({ id: "admin", role: "ORDER_ADMIN", department: "订单中心" }, [charged]);
  assert.equal(tasks[0]?.title, "报备尾款收款");
  assert.equal(projectActionableShipmentTasks({ id: "sales-aikeju-1", role: "SALES", department: "艾可居销售部" }, [charged]).length, 0);
  assert.equal(projectActionableShipmentTasks({ id: "admin", role: "ORDER_ADMIN", department: "订单中心" }, [{ ...charged, chargeMode: "FREE" as const }]).length, 0);
});
