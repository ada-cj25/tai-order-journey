import assert from "node:assert/strict";
import test from "node:test";
import { projectActionableDesignIntakeTasks } from "./design-intake-task-projection.js";

const order = {
  id: "order-design-intake",
  designerId: "designer-1",
  trackingSerial: "GD-260910-179980310",
  salesNumber: null,
  productionNumber: null,
  customerName: "一只大白马",
  stage: "DESIGN_PENDING",
  rush: false,
  internalDueAt: new Date("2026-11-02T17:00:00+08:00"),
  designIntakeDueAt: new Date("2026-09-17T12:00:00+08:00"),
  designAssignmentVersion: 2,
};

test("财务核验首付款后进入指定设计师的个人待办", () => {
  const tasks = projectActionableDesignIntakeTasks(
    { id: "designer-1", role: "DESIGNER", department: "设计部" },
    [order],
    new Date("2026-09-10T12:00:00+08:00"),
  );
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.title, "设计下单");
  assert.equal(tasks[0]?.order.trackingSerial, "GD-260910-179980310");
  assert.equal(tasks[0]?.dueAt.toISOString(), order.designIntakeDueAt.toISOString());
  assert.match(tasks[0]?.uniqueKey ?? "", /v2/);
});

test("未指定的设计师和已经接单的订单不显示", () => {
  assert.equal(projectActionableDesignIntakeTasks({ id: "designer-2", role: "DESIGNER", department: "设计部" }, [order]).length, 0);
  assert.equal(projectActionableDesignIntakeTasks({ id: "designer-1", role: "DESIGNER", department: "设计部" }, [{ ...order, stage: "DESIGN_ACCEPTED" }]).length, 0);
  assert.equal(projectActionableDesignIntakeTasks({ id: "designer-1", role: "DESIGNER", department: "设计部" }, [{ ...order, hasPersistedTask: true }]).length, 0);
});

test("设计师退回后进入订单所属销售的个人待办", () => {
  const returnedOrder = {
    ...order,
    designerId: null,
    salesEmployeeId: "sales-1",
    designIntakeDueAt: null,
  };
  const tasks = projectActionableDesignIntakeTasks(
    { id: "sales-1", role: "SALES", department: "艾可居销售部" },
    [returnedOrder],
    new Date("2026-09-10T12:00:00+08:00"),
  );

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.title, "重新分配设计师");
  assert.equal(tasks[0]?.ownerId, "sales-1");
  assert.equal(tasks[0]?.order.trackingSerial, "GD-260910-179980310");
  assert.equal(projectActionableDesignIntakeTasks({ id: "sales-2", role: "SALES", department: "艾可居销售部" }, [returnedOrder]).length, 0);
  assert.equal(projectActionableDesignIntakeTasks({ id: "sales-1", role: "SALES", department: "艾可居销售部" }, [{ ...returnedOrder, designerId: "designer-2" }]).length, 0);
});

test("非常规订单不向订单管理员或销售派生设计退回待办", () => {
  const exceptionalOrder = { ...order, designerId: null, salesEmployeeId: null, designIntakeDueAt: null };
  assert.equal(projectActionableDesignIntakeTasks({ id: "admin", role: "ORDER_ADMIN", department: "订单中心" }, [exceptionalOrder]).length, 0);
  assert.equal(projectActionableDesignIntakeTasks({ id: "sales-1", role: "SALES", department: "销售部" }, [exceptionalOrder]).length, 0);
});
