import { getMockOutsourceLines } from "./mock-outsource";
import { getMockPaymentState, getOrder, getStoredSession } from "./store";
import { mockRouteComplete } from "./mock-production";
import { getMockShipmentState, saveMockShipmentState } from "./mock-shipment-state";
import type { MiniOrder } from "./types";
import type { MiniShipmentQueueItem } from "./shipment-queue";

export function mockShipmentRoutes(order: MiniOrder) {
  const state = getMockShipmentState(order.id);
  const base = order.id === "TEST-DEMO-ZHOU-ORDER-001" ? [
    { id: "route-child-panel", areaId: "area-zhou-child", areaName: "儿童房", productionNumber: "TEST-DEMO-AREA-01", routeLabel: "板式路线", completed: true, batchCount: 0, finalBatchRecorded: false, selected: false, isFinalBatch: true, installationFee: "" },
    { id: "route-wardrobe-panel", areaId: "area-zhou-wardrobe", areaName: "衣帽间", productionNumber: "TEST-DEMO-AREA-02", routeLabel: "板式路线", completed: true, batchCount: 1, finalBatchRecorded: false, selected: false, isFinalBatch: false, installationFee: "" },
    { id: "route-bath-wood", areaId: "area-zhou-bathroom", areaName: "卫生间", productionNumber: "TEST-DEMO-AREA-03", routeLabel: "实木油漆路线", completed: false, batchCount: 0, finalBatchRecorded: false, selected: false, isFinalBatch: false, installationFee: "" },
  ] : order.trackingSerial.startsWith("TEST-DEMO-GD-") ? order.productionAreas.flatMap((area) =>
    ([
      { kind: "PANEL", label: "板式路线", keys: ["PANEL", "ASSEMBLY_PANEL"] },
      { kind: "WOOD_PAINT", label: "实木油漆路线", keys: ["WOOD", "PAINT", "ASSEMBLY_WOOD_PAINT"] },
    ] as const).flatMap((route) => {
      const flows = area.workshopFlows.filter((flow) => (route.keys as readonly string[]).includes(flow.key));
      if (!flows.length) return [];
      return [{ id: `${area.id}:${route.kind}`, areaId: area.id, areaName: area.name, productionNumber: area.productionNumber,
        routeLabel: route.label, completed: mockRouteComplete(area, route.kind),
        batchCount: 0, finalBatchRecorded: false, selected: false, isFinalBatch: true, installationFee: "" }];
    })) : [];
  return base.map((route) => ({ ...route, batchCount: route.batchCount + (state.routeBatches[route.id]?.count ?? 0), finalBatchRecorded: state.routeBatches[route.id]?.final ?? false }));
}

export function mockShipmentQueueItem(order: MiniOrder): MiniShipmentQueueItem | null {
  const routes = mockShipmentRoutes(order).filter((route) => route.completed && !route.finalBatchRecorded);
  const state = getMockShipmentState(order.id);
  const outsource = getMockOutsourceLines(order.id).filter((line) => !line.shipped && !state.shippedOutsourceIds.includes(line.id) && line.arrivedQty >= line.plannedQty);
  const shipmentCount = order.shipments?.length ?? 0;
  if (!routes.length && !outsource.length && !shipmentCount) return null;
  return {
    orderId: order.id, customerName: order.customerName, salesNumber: order.salesNumber, trackingSerial: order.trackingSerial,
    tailPaymentConfirmed: order.trackingSerial.startsWith("TEST-DEMO-GD-") ? Boolean(getMockPaymentState(order.id)?.tailConfirmedAt) : order.id === "TEST-DEMO-ZHOU-ORDER-001",
    readyRoutes: routes.length, readyOutsource: outsource.length,
    readyLabels: [...routes.map((route) => `${route.areaName}·${route.routeLabel}`), ...outsource.map((line) => line.name)].slice(0, 3),
    shipmentCount, lastShipmentAt: order.shipments?.[0]?.deliveredAt ?? null,
    records: (order.shipments ?? []).map((shipment) => ({ id: shipment.id, vehicle: shipment.vehicle, deliveredAt: shipment.deliveredAt, summary: shipment.areas.map((area) => area.areaName).join("、") || "外购产品" })),
  };
}

export function recordMockShipment(order: MiniOrder, input: {
  routes: Array<{ id: string; areaName: string; productionNumber: string; isFinalBatch: boolean }>;
  outsourceIds: string[];
  vehicle: string;
  installerId: string;
  installationTeamLabel: string;
  contact: string;
  plannedAt: string;
  siteConditions: string;
}): void {
  const state = getMockShipmentState(order.id);
  const available = new Map(mockShipmentRoutes(order).filter((route) => route.completed && !route.finalBatchRecorded).map((route) => [route.id, route]));
  const availableOutsource = getMockOutsourceLines(order.id).filter((line) => !line.shipped && !state.shippedOutsourceIds.includes(line.id) && line.arrivedQty >= line.plannedQty);
  if (order.trackingSerial.startsWith("TEST-DEMO-GD-") && !getMockPaymentState(order.id)?.tailConfirmedAt) throw new Error("尾款未核验，不能发货");
  if (!input.routes.length && !input.outsourceIds.length) throw new Error("请选择本次发货内容");
  if (input.routes.some((route) => !available.has(route.id)) || input.outsourceIds.some((id) => !availableOutsource.some((line) => line.id === id))) throw new Error("发货内容已变化，请重新选择");
  const routeBatches = { ...state.routeBatches };
  input.routes.forEach((route) => { const previous = routeBatches[route.id] ?? { count: 0, final: false }; routeBatches[route.id] = { count: previous.count + 1, final: route.isFinalBatch }; });
  const shipment = {
    id: `mock-shipment-${Date.now()}`, vehicle: input.vehicle, deliveredAt: new Date().toISOString(), assignedInstallerId: input.installerId || null,
    installationTeamLabel: input.installationTeamLabel || null, siteContact: input.contact || null, plannedInstallationAt: input.plannedAt || null,
    siteConditions: input.siteConditions || null, installedAt: null,
    areas: input.routes.map((route, index) => ({ areaName: route.areaName, productionNumber: route.productionNumber, sequence: index + 1, isFinalBatch: route.isFinalBatch })),
  };
  saveMockShipmentState(order.id, { ...state, routeBatches, shippedOutsourceIds: [...state.shippedOutsourceIds, ...input.outsourceIds], shipments: [shipment, ...state.shipments] });
}

export function recordMockInstallation(orderId: string, shipmentId: string, input: {
  type: "COMPLETE" | "PARTIAL" | "ISSUE"; reportedOn: string; note: string; photoPaths: string[]; transportCost: number | null;
}): void {
  const employee = getStoredSession();
  const state = getMockShipmentState(orderId);
  const shipment = state.shipments.find((item) => item.id === shipmentId);
  if (employee?.role !== "INSTALLER" || !shipment || shipment.assignedInstallerId !== employee.id || !shipment.areas.length) throw new Error("当前账号没有该车次的安装任务");
  if (shipment.installedAt) throw new Error("该车次安装已经完成");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.reportedOn) || !input.photoPaths.length) throw new Error("请填写安装日期并上传现场照片");
  if (input.type === "COMPLETE" && (input.transportCost === null || !Number.isFinite(input.transportCost) || input.transportCost < 0)) throw new Error("安装完成时请填写运输费");
  if (input.type !== "COMPLETE" && !input.note.trim()) throw new Error("部分完成或发现问题时必须填写说明");
  const recordedAt = new Date().toISOString();
  saveMockShipmentState(orderId, {
    ...state,
    shipments: state.shipments.map((item) => item.id === shipmentId ? { ...item, installedAt: input.type === "COMPLETE" ? input.reportedOn : null } : item),
    installationReports: [...state.installationReports, { shipmentId, ...input, recordedAt }],
  });
}

export function recordMockCustomerAcceptance(orderId: string, input: { acceptedAt: string; conclusion: string; signaturePath: string }): void {
  const employee = getStoredSession();
  const order = getOrder(orderId);
  const state = getMockShipmentState(orderId);
  if (!employee || !["INSTALLER", "ORDER_ADMIN"].includes(employee.role) || !order || order.stageLabel !== "待客户验收") throw new Error("当前订单尚未进入客户验收");
  if (employee.role === "INSTALLER" && !state.shipments.some((shipment) => shipment.assignedInstallerId === employee.id)) throw new Error("当前账号没有该订单的验收任务");
  if (state.acceptance) throw new Error("该订单已完成客户验收");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.acceptedAt) || !input.signaturePath) throw new Error("请选择验收日期并上传客户签字");
  saveMockShipmentState(orderId, { ...state, acceptance: { ...input, recordedAt: new Date().toISOString() } });
}
