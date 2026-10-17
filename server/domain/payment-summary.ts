type PaymentSubmission = { command: string; status: string; payload: unknown };

function reportedAmount(submissions: PaymentSubmission[], command: string) {
  const report = submissions.find((submission) => submission.command === command && submission.status !== "DRAFT");
  const raw = report?.payload && typeof report.payload === "object" ? (report.payload as Record<string, unknown>).receivedAmount : null;
  const amount = raw == null || raw === "" ? null : Number(raw);
  return amount != null && Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function paymentSummary(input: {
  contractAmount: unknown;
  depositReported: boolean;
  depositConfirmed: boolean;
  prepaymentRequired?: boolean;
  prepaymentReported?: boolean;
  prepaymentConfirmed?: boolean;
  submissions: PaymentSubmission[];
}) {
  const depositAmount = reportedAmount(input.submissions, "REPORT_DEPOSIT");
  const prepaymentAmount = reportedAmount(input.submissions, "REPORT_PREPAYMENT");
  const depositReceived = input.depositConfirmed ? depositAmount : null;
  const prepaymentReceived = input.prepaymentRequired ? (input.prepaymentConfirmed ? prepaymentAmount : null) : 0;
  const contractAmount = Number(input.contractAmount);
  const initialPaymentTotal = depositReceived != null && prepaymentReceived != null ? depositReceived + prepaymentReceived : null;
  const exceedsContract = initialPaymentTotal != null && Number.isFinite(contractAmount) && initialPaymentTotal > contractAmount;
  const tailReceivable = initialPaymentTotal != null && Number.isFinite(contractAmount) && !exceedsContract ? Math.round((contractAmount - initialPaymentTotal) * 100) / 100 : null;
  return {
    depositStatus: input.depositConfirmed ? "CONFIRMED" : input.depositReported ? "REPORTED" : "NOT_REPORTED",
    depositReceived,
    prepaymentRequired: Boolean(input.prepaymentRequired),
    prepaymentStatus: input.prepaymentRequired ? (input.prepaymentConfirmed ? "CONFIRMED" : input.prepaymentReported ? "REPORTED" : "NOT_REPORTED") : "NOT_REQUIRED",
    prepaymentReceived,
    initialPaymentTotal,
    tailReceivable,
    exception: exceedsContract ? (input.prepaymentRequired ? "INITIAL_PAYMENTS_EXCEED_CONTRACT" : "DEPOSIT_EXCEEDS_CONTRACT") : null,
  };
}
