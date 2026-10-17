export type PaymentAccountTaskActor = {
  id: string;
  role: string;
  department: string;
};

export type PendingPaymentAccount = {
  id: string;
  name: string;
  status: string;
  requestedAt: Date;
};

export function projectPendingPaymentAccountTasks(employee: PaymentAccountTaskActor, accounts: PendingPaymentAccount[]) {
  if (employee.role !== "CHAIRMAN") return [];
  return accounts.flatMap((account) => account.status !== "PENDING" ? [] : [{
    id: `payment-account-review:${account.id}`,
    orderId: null,
    ownerId: employee.id,
    department: employee.department,
    title: `审批收款账户：${account.name}`,
    stage: null,
    workshop: null,
    dueAt: null,
    plannedStartAt: null,
    workloadDays: null,
    status: "PENDING",
    delayDays: 0,
    uniqueKey: `payment-account-review:${account.id}:${employee.id}`,
    action: "REVIEW_PAYMENT_ACCOUNT" as const,
    paymentAccountId: account.id,
    requestedAt: account.requestedAt,
    order: null,
  }]);
}
