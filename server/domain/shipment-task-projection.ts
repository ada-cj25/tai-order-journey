export type ShipmentTaskActor = {
  id: string;
  role: string;
  department: string;
};

export type ShipmentTaskOrder = {
  id: string;
  salesId: string | null;
  creationMode?: "SALES_STANDARD" | "INTERNAL_EXCEPTION";
  chargeMode?: "CHARGED" | "FREE";
  commercialConfirmedAt?: Date | null;
  trackingSerial: string;
  salesNumber: string | null;
  productionNumber: string | null;
  customerName: string;
  stage: string;
  rush: boolean;
  internalDueAt: Date;
  tailPaymentReported: boolean;
  tailPaymentConfirmed: boolean;
  shipmentReady?: boolean;
  tasks: Array<{ dueAt: Date }>;
};

export function projectActionableShipmentTasks(employee: ShipmentTaskActor, orders: ShipmentTaskOrder[], now = new Date()) {
  if (!["SALES", "FINANCE", "ORDER_ADMIN"].includes(employee.role)) return [];
  return orders.flatMap((order) => {
    const internal = order.creationMode === "INTERNAL_EXCEPTION";
    if (internal && order.chargeMode === "FREE" && order.commercialConfirmedAt) return [];
    if (!(order.shipmentReady || ["INSTALLATION_APPLICATION", "DELIVERY"].includes(order.stage)) || order.tailPaymentConfirmed) return [];
    const isSalesReport = !internal && employee.role === "SALES" && order.salesId === employee.id && !order.tailPaymentReported;
    const isAdminReport = internal && employee.role === "ORDER_ADMIN" && !order.tailPaymentReported;
    const isFinanceReview = employee.role === "FINANCE" && order.tailPaymentReported;
    if (!isSalesReport && !isAdminReport && !isFinanceReview) return [];
    const dueAt = order.tasks[0]?.dueAt ?? order.internalDueAt;
    const status = dueAt < now ? "OVERDUE" : "PENDING";
    return [{
      id: `shipment-tail-payment:${order.id}:${isSalesReport ? "report" : "confirm"}`,
      orderId: order.id,
      ownerId: employee.id,
      department: employee.department,
      title: isSalesReport || isAdminReport ? "报备尾款收款" : "核验尾款到账",
      stage: order.stage,
      workshop: null,
      dueAt,
      plannedStartAt: null,
      workloadDays: null,
      status,
      delayDays: 0,
      uniqueKey: `${order.id}:${order.stage}:TAIL_PAYMENT:${isSalesReport || isAdminReport ? "REPORT" : "CONFIRM"}`,
      order: {
        id: order.id,
        trackingSerial: order.trackingSerial,
        salesNumber: order.salesNumber,
        productionNumber: order.productionNumber,
        customerName: order.customerName,
        stage: order.stage,
        rush: order.rush,
      },
    }];
  });
}
