export type InitialPaymentTaskActor = {
  id: string;
  role: string;
  department: string;
};

export type InitialPaymentTaskOrder = {
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
  prepaymentRequired: boolean;
  depositReported: boolean;
  depositConfirmed: boolean;
  prepaymentReported: boolean;
  prepaymentConfirmed: boolean;
};

export function projectActionableInitialPaymentTasks(employee: InitialPaymentTaskActor, orders: InitialPaymentTaskOrder[], now = new Date()) {
  if (!["SALES", "FINANCE", "ORDER_ADMIN"].includes(employee.role)) return [];
  return orders.flatMap((order) => {
    if (order.stage !== "DEPOSIT_PENDING") return [];
    const internal = order.creationMode === "INTERNAL_EXCEPTION";
    const needsCommercialReview = internal && !order.commercialConfirmedAt;
    const depositNeedsReport = !order.depositReported;
    const prepaymentNeedsReport = order.prepaymentRequired && !order.prepaymentReported;
    const reportsComplete = !depositNeedsReport && !prepaymentNeedsReport;
    const confirmationPending = !order.depositConfirmed || (order.prepaymentRequired && !order.prepaymentConfirmed);
    const isCommercialReview = employee.role === "ORDER_ADMIN" && needsCommercialReview;
    const isSalesReport = !internal && employee.role === "SALES" && order.salesId === employee.id && !reportsComplete;
    const isFinanceReview = employee.role === "FINANCE" && reportsComplete && confirmationPending;
    if (!isCommercialReview && !isSalesReport && !isFinanceReview) return [];

    const title = isCommercialReview ? "确认非常规订单商务方式" : isFinanceReview
      ? order.prepaymentRequired ? "同时核验定金与预付款" : "核验定金到账"
      : depositNeedsReport ? "报备定金收款" : "报备预付款收款";
    const dueAt = order.internalDueAt;
    return [{
      id: `initial-payment:${order.id}:${isCommercialReview ? "commercial-review" : isFinanceReview ? "confirm" : depositNeedsReport ? "deposit" : "prepayment"}`,
      orderId: order.id,
      ownerId: employee.id,
      department: employee.department,
      title,
      stage: order.stage,
      workshop: null,
      dueAt,
      plannedStartAt: null,
      workloadDays: null,
      status: dueAt < now ? "OVERDUE" : "PENDING",
      delayDays: 0,
      uniqueKey: `${order.id}:DEPOSIT_PENDING:INITIAL_PAYMENT:${isCommercialReview ? "EXCEPTION_COMMERCIAL_REVIEW" : isFinanceReview ? "CONFIRM" : depositNeedsReport ? "REPORT_DEPOSIT" : "REPORT_PREPAYMENT"}`,
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
