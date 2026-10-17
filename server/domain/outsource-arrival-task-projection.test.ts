import assert from "node:assert/strict";
import test from "node:test";
import { projectActionableOutsourceArrivalTasks } from "./outsource-arrival-task-projection.js";

const order = {
  id: "order-outsource-arrival",
  trackingSerial: "GD-260910-OUTSOURCE",
  salesNumber: "N26090001",
  productionNumber: null,
  customerName: "外购测试客户",
  stage: "PRODUCTION",
  rush: false,
  internalDueAt: new Date("2026-10-10T17:00:00+08:00"),
  outsourceRequirementMode: "REQUIRED",
  outsourceLines: [
    { plannedQty: 2, arrivals: [{ quantity: 1, voidedAt: null }] },
    { plannedQty: 1, arrivals: [{ quantity: 1, voidedAt: null }] },
  ],
};

test("任一外购产品尚未齐套时进入订单管理员个人待办", () => {
  const tasks = projectActionableOutsourceArrivalTasks(
    { id: "order-admin-1", role: "ORDER_ADMIN", department: "订单中心" },
    [order],
    new Date("2026-09-10T12:00:00+08:00"),
  );
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.title, "确认外购成品到货");
});

test("全部外购产品齐套后待办自动消失，作废到货不计入齐套", () => {
  const complete = { ...order, outsourceLines: order.outsourceLines.map((line) => ({ ...line, arrivals: [{ quantity: line.plannedQty, voidedAt: null }] })) };
  assert.equal(projectActionableOutsourceArrivalTasks({ id: "order-admin-1", role: "ORDER_ADMIN", department: "订单中心" }, [complete]).length, 0);
  const voided = { ...order, outsourceLines: [{ plannedQty: 1, arrivals: [{ quantity: 1, voidedAt: new Date() }] }] };
  assert.equal(projectActionableOutsourceArrivalTasks({ id: "order-admin-1", role: "ORDER_ADMIN", department: "订单中心" }, [voided]).length, 1);
});

test("无外购、未发布外购及其他岗位不显示该待办", () => {
  assert.equal(projectActionableOutsourceArrivalTasks({ id: "order-admin-1", role: "ORDER_ADMIN", department: "订单中心" }, [{ ...order, outsourceRequirementMode: "NONE" }]).length, 0);
  assert.equal(projectActionableOutsourceArrivalTasks({ id: "finance-1", role: "FINANCE", department: "财务部" }, [order]).length, 0);
});
