export type DesignIntakeTaskActor = {
  id: string;
  role: string;
  department: string;
};

export type DesignIntakeTaskOrder = {
  id: string;
  designerId: string | null;
  salesEmployeeId?: string | null;
  trackingSerial: string;
  salesNumber: string | null;
  productionNumber: string | null;
  customerName: string;
  stage: string;
  rush: boolean;
  internalDueAt: Date;
  designIntakeDueAt?: Date | null;
  designAssignmentVersion?: number;
  hasPersistedTask?: boolean;
};

export function projectActionableDesignIntakeTasks(employee: DesignIntakeTaskActor, orders: DesignIntakeTaskOrder[], now = new Date()) {
  if (!["DESIGNER", "SALES"].includes(employee.role)) return [];
  return orders.flatMap((order) => {
    if (order.stage !== "DESIGN_PENDING") return [];
    const returnedToSales = employee.role === "SALES" && !order.designerId && order.salesEmployeeId === employee.id;
    const assignedToDesigner = employee.role === "DESIGNER" && order.designerId === employee.id && !order.hasPersistedTask;
    if (!returnedToSales && !assignedToDesigner) return [];
    const dueAt = order.designIntakeDueAt ?? order.internalDueAt;
    return [{
      id: `design-intake:${order.id}`,
      orderId: order.id,
      ownerId: employee.id,
      department: employee.department,
      title: returnedToSales ? "重新分配设计师" : "设计下单",
      stage: order.stage,
      workshop: null,
      dueAt,
      plannedStartAt: null,
      workloadDays: null,
      status: dueAt < now ? "OVERDUE" : "PENDING",
      delayDays: 0,
      uniqueKey: returnedToSales
        ? `${order.id}:DESIGN_PENDING:RETURNED_TO_SALES:v${order.designAssignmentVersion ?? 0}`
        : `${order.id}:DESIGN_PENDING:v${order.designAssignmentVersion ?? 0}:FALLBACK`,
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
