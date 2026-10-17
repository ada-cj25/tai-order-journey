import assert from "node:assert/strict";
import test from "node:test";
import { MiniWorkspaceService } from "./mini-workspace.service.js";

test("sales sees own newly reported order while finance verification is pending", async () => {
  const employee = { id: "sales-1", role: "SALES", level: "STAFF", department: "诺尔丽销售部", businessUnit: "NOERLI", name: "测试销售" };
  const order = { id: "order-1", trackingSerial: "TEST-GD-001", salesNumber: null, customerName: "测试客户", rush: false, updatedAt: new Date("2026-10-12T04:00:00Z") };
  let followupWhere: Record<string, unknown> | undefined;
  const prisma = {
    notification: { count: async () => 0 },
    task: { findMany: async () => [] },
    order: {
      count: async () => 1,
      findMany: async ({ where }: { where: Record<string, unknown> }) => { followupWhere = where; return [order]; },
    },
  };
  const workspace = await new MiniWorkspaceService(prisma as never).workspace(employee as never);
  assert.equal(followupWhere?.salesId, employee.id);
  assert.equal(followupWhere?.stage, "DEPOSIT_PENDING");
  assert.equal(followupWhere?.depositReported, true);
  const followup = workspace.tasks.find((item) => item.orderId === order.id);
  assert.ok(followup);
  assert.equal(followup.title, "等待财务核验首付款");
  assert.equal(followup.actionRoute, `/pages/order-detail/index?id=${order.id}`);
});

test("accepted design task opens the mobile submission form for the assigned designer", async () => {
  const employee = { id: "designer-2", role: "DESIGNER", level: "STAFF", department: "设计部", name: "测试设计师" };
  const order = { id: "order-design-1", trackingSerial: "GD-TEST-1", salesNumber: null, customerName: "小冉酱", rush: false, updatedAt: new Date("2026-10-12T04:00:00Z"), events: [] };
  const prisma = { notification: { count: async () => 0 }, task: { findMany: async () => [{ id: "task-design-1", stage: "DESIGN_ACCEPTED", status: "PENDING", department: "设计部", title: "设计提交", dueAt: new Date("2026-10-15T09:00:00Z"), uniqueKey: "design-1", order }] }, order: { count: async () => 1 } };
  const workspace = await new MiniWorkspaceService(prisma as never).workspace(employee as never);
  const designTask = workspace.tasks.find((item) => item.orderId === order.id);
  assert.equal(designTask?.actionCode, "SUBMIT_DESIGN");
  assert.equal(designTask?.actionRoute, `/pages/design-submit/index?orderId=${order.id}`);
  assert.equal(designTask?.desktopOnly, false);
});

test("outsourced arrival task opens the order admin arrival form during production", async () => {
  const employee = { id: "admin-2", role: "ORDER_ADMIN", level: "STAFF", department: "订单管理部", name: "测试订单管理员" };
  const order = { id: "order-arrival-1", trackingSerial: "GD-ARRIVAL-1", salesNumber: "N26100001", productionNumber: null, customerName: "测试客户", stage: "PRODUCTION", rush: false, internalDueAt: new Date("2026-10-20T09:00:00Z"), updatedAt: new Date("2026-10-12T04:00:00Z"), outsourceRequirementMode: "REQUIRED",
    outsourceRequirementVersions: [{ lines: [{ plannedQty: 2, arrivals: [{ quantity: 1, voidedAt: null }] }] }] };
  const prisma = { notification: { count: async () => 0 }, task: { findMany: async () => [{ uniqueKey: `${order.id}:OUTSOURCE_ARRIVAL` }] }, order: { count: async () => 1, findMany: async () => [order] } };
  const workspace = await new MiniWorkspaceService(prisma as never).workspace(employee as never);
  const arrivalTasks = workspace.tasks.filter((item) => item.orderId === order.id && item.type === "OUTSOURCE_ARRIVAL");
  assert.equal(arrivalTasks.length, 1);
  const arrivalTask = arrivalTasks[0];
  assert.equal(arrivalTask?.type, "OUTSOURCE_ARRIVAL");
  assert.equal(arrivalTask?.actionRoute, `/pages/supply/index?orderId=${order.id}`);
  assert.equal(arrivalTask?.actionLabel, "登记到货");
  assert.equal(workspace.stats.find((item) => item.key === "arrival")?.value, 1);

  order.outsourceRequirementVersions[0]!.lines[0]!.arrivals.push({ quantity: 1, voidedAt: null });
  const completed = await new MiniWorkspaceService(prisma as never).workspace(employee as never);
  assert.equal(completed.tasks.some((item) => item.type === "OUTSOURCE_ARRIVAL"), false);
  assert.equal(completed.stats.find((item) => item.key === "arrival")?.value, 0);
});

test("order list exposes the same whole-journey step as order detail", async () => {
  const employee = { id: "admin-1", role: "CHAIRMAN", level: "SUPERVISOR", department: "管理部", name: "管理员" };
  const row = {
    id: "order-technical", trackingSerial: "TEST-GD-2", salesNumber: "TEST-SALES-2", customerName: "测试客户",
    businessType: "NORLI_STANDARD", stage: "TECHNICAL", rush: false, internalDueAt: null, currentOwnerLabel: "技术部",
    nextAction: "技术拆单", updatedAt: new Date("2026-10-12T04:00:00Z"), sales: null, designer: null, productionAreas: [],
  };
  const prisma = { order: { findMany: async () => [row] } };
  const [order] = await new MiniWorkspaceService(prisma as never).orders(employee as never);
  assert.equal(order.stageLabel, "技术拆单");
  assert.equal(order.stageIndex, 5);
  assert.equal(order.stageTotal, 12);
  assert.equal(order.areaSummary.percent, 0);
});

test("order list and detail show the current task deadline rather than the customer deadline", async () => {
  const employee = { id: "sales-1", role: "SALES", level: "STAFF", department: "诺尔丽销售部", businessUnit: "NOERLI", name: "测试销售" };
  const row = {
    id: "order-design", trackingSerial: "TEST-GD-DESIGN", salesNumber: null, customerName: "本地联调客户",
    businessType: "NOERLI_FORMAL", stage: "DESIGN_PENDING", rush: false,
    internalDueAt: new Date("2026-10-14T09:00:00Z"), currentOwnerLabel: "设计师", nextAction: "设计师下单",
    updatedAt: new Date("2026-10-13T04:00:00Z"), sales: { id: "sales-1", name: "测试销售" }, designer: null,
    tasks: [{ stage: "DESIGN_PENDING", dueAt: new Date("2026-10-20T09:00:00Z") }],
    productionAreas: [], shipments: [], attachments: [], stageSubmissions: [], aftersales: [],
  };
  const prisma = { order: { findMany: async () => [row], findFirst: async () => row } };
  const service = new MiniWorkspaceService(prisma as never);
  const [listed] = await service.orders(employee as never);
  const detail = await service.order(row.id, employee as never);
  assert.equal(listed.currentTaskDueLabel, "10月20日前");
  assert.equal(detail.currentTaskDueLabel, "10月20日前");
  assert.equal(detail.dueLabel, "10月14日前");
});

test("historical installation application stays in the delivery part of the journey", async () => {
  const employee = { id: "admin-1", role: "CHAIRMAN", level: "SUPERVISOR", department: "管理部", name: "管理员" };
  const row = {
    id: "order-shipment", trackingSerial: "TEST-GD-3", salesNumber: "TEST-SALES-3", customerName: "测试客户",
    businessType: "NORLI_STANDARD", stage: "INSTALLATION_APPLICATION", rush: false, internalDueAt: null, currentOwnerLabel: "订单管理部",
    nextAction: "发货安排", updatedAt: new Date("2026-10-12T04:00:00Z"), sales: null, designer: null, productionAreas: [],
  };
  const prisma = { order: { findMany: async () => [row] } };
  const [order] = await new MiniWorkspaceService(prisma as never).orders(employee as never);
  assert.equal(order.stageIndex, 9);
  assert.equal(order.stageTotal, 12);
});

test("completed order gains a derived thirteenth aftersales step without reopening its persisted stage", async () => {
  const employee = { id: "after-1", role: "AFTERSALES", level: "STAFF", department: "售后部", name: "售后人员" };
  const row = {
    id: "order-complete", trackingSerial: "GD-COMPLETE", salesNumber: "N26100002", customerName: "已验收客户",
    businessType: "NOERLI_FORMAL", stage: "BUSINESS_COMPLETE", rush: false, internalDueAt: null, currentOwnerLabel: "已履约",
    nextAction: "客户验收已归档", updatedAt: new Date("2026-10-13T04:00:00Z"), sales: null, designer: null,
    productionAreas: [], shipments: [], attachments: [], stageSubmissions: [],
    aftersales: [{ id: "case-1", status: "OPEN" }],
  };
  const prisma = { order: { findFirst: async () => row } };
  const projected = await new MiniWorkspaceService(prisma as never).order(row.id, employee as never);
  assert.equal(projected.stageLabel, "履约完成");
  assert.equal(projected.afterSalesActive, true);
  assert.equal(projected.afterSalesCount, 1);
  assert.equal(projected.stageIndex, 13);
  assert.equal(projected.stageTotal, 13);
  assert.equal(projected.journey.at(-1)?.label, "售后");
  assert.equal(projected.journey.at(-1)?.state, "current");
});

test("order admin shipment task opens its own order and shipment queue keeps route-level readiness", async () => {
  const employee = { id: "admin-ship", role: "ORDER_ADMIN", level: "STAFF", department: "订单管理部", name: "测试订单管理员" };
  const order = { id: "order-xr", trackingSerial: "GD-XR-001", salesNumber: "N26100001", customerName: "小冉酱", rush: false,
    updatedAt: new Date("2026-10-13T04:00:00Z"), tailPaymentConfirmed: true, chargeMode: "CHARGED", amount: 100,
    productionRoutes: [
      { shippedAt: null, kind: "PANEL", productionArea: { name: "主卧" }, productionProcesses: [{ status: "COMPLETE", metricMode: "AREA" }], shipmentLines: [] },
      { shippedAt: null, kind: "WOOD_PAINT", productionArea: { name: "厨房" }, productionProcesses: [{ status: "PENDING", metricMode: "AREA" }], shipmentLines: [] },
    ], outsourceRequirementVersions: [], shipments: [], events: [],
  };
  const prisma = { notification: { count: async () => 0 }, task: { findMany: async () => [{ id: "ship-task", stage: "PRODUCTION", status: "PENDING", department: "订单管理部", title: "生产完成", dueAt: null, uniqueKey: "ship-task", order }] },
    order: { count: async () => 1, findMany: async () => [order] } };
  const service = new MiniWorkspaceService(prisma as never);
  const workspace = await service.workspace(employee as never);
  const shipmentTask = workspace.tasks.find((task) => task.orderId === order.id && task.type === "SHIPMENT");
  assert.equal(shipmentTask?.title, "登记发货车次");
  assert.equal(shipmentTask?.actionRoute, `/pages/shipment/index?orderId=${order.id}`);

  const [queued] = await service.shipmentQueue(employee as never);
  assert.equal(queued?.orderId, order.id);
  assert.equal(queued?.readyRoutes, 1);
  assert.deepEqual(queued?.readyLabels, ["主卧·板式路线"]);
});
