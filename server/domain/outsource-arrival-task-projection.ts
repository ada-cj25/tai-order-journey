export type OutsourceArrivalTaskActor = {
  id: string;
  role: string;
  department: string;
};

export type OutsourceArrivalTaskOrder = {
  id: string;
  trackingSerial: string;
  salesNumber: string | null;
  productionNumber: string | null;
  customerName: string;
  stage: string;
  rush: boolean;
  internalDueAt: Date;
  outsourceRequirementMode: string;
  outsourceLines: Array<{
    plannedQty: number;
    arrivals: Array<{ quantity: number; voidedAt: Date | null }>;
  }>;
};

const ARRIVAL_STAGES = new Set(["MATERIALS", "PRODUCTION", "INSTALLATION_APPLICATION", "DELIVERY", "INSTALLATION"]);

export function projectActionableOutsourceArrivalTasks(employee: OutsourceArrivalTaskActor, orders: OutsourceArrivalTaskOrder[], now = new Date()) {
  if (employee.role !== "ORDER_ADMIN") return [];
  return orders.flatMap((order) => {
    if (order.outsourceRequirementMode !== "REQUIRED" || !ARRIVAL_STAGES.has(order.stage) || !order.outsourceLines.length) return [];
    const pendingLines = order.outsourceLines.filter((line) => {
      const arrivedQty = line.arrivals.filter((arrival) => !arrival.voidedAt).reduce((sum, arrival) => sum + arrival.quantity, 0);
      return arrivedQty < line.plannedQty;
    });
    if (!pendingLines.length) return [];

    const dueAt = order.internalDueAt;
    return [{
      id: `outsource-arrival:${order.id}`,
      orderId: order.id,
      ownerId: employee.id,
      department: employee.department,
      title: "确认外购成品到货",
      stage: order.stage,
      workshop: null,
      dueAt,
      plannedStartAt: null,
      workloadDays: null,
      status: dueAt < now ? "OVERDUE" : "PENDING",
      delayDays: 0,
      uniqueKey: `${order.id}:OUTSOURCE_ARRIVAL`,
      pendingCount: pendingLines.length,
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
