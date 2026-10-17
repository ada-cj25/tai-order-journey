export type OrderRisk = {
  id: string;
  type: "OVERDUE_TASK" | "TAIL_PAYMENT" | "OUTSOURCE_NOT_READY" | "PRODUCTION_ISSUE";
  title: string;
  description: string;
  impact: string;
  responsible: string;
  resolutionLabel: string;
  resolutionCommand?: string;
};

type RiskTask = { id: string; title: string; status: string; department: string; dueAt: Date | string; uniqueKey?: string };
type RiskReport = {
  id: string;
  productionProcessId: string;
  action: string;
  note?: string | null;
  reportedAt: Date | string;
  process?: { workshopLabel: string; processName: string; productionArea?: { name: string } | null; productionRoute?: { kind: "PANEL" | "WOOD_PAINT" } | null } | null;
};

export function deriveOrderRisks(input: {
  stage: string;
  tailPaymentConfirmed: boolean;
  tailPaymentReported?: boolean;
  creationMode?: "SALES_STANDARD" | "INTERNAL_EXCEPTION";
  installationApplied: boolean;
  tasks?: RiskTask[];
  productionReports?: RiskReport[];
  fulfillmentTracks?: {
    manufactured?: { routes?: Array<{ productionAreaId: string; kind: "PANEL" | "WOOD_PAINT"; complete: boolean; shipped: boolean }> };
    outsourced: { applicable: boolean; allShipped: boolean; readyCount: number; lines: Array<{ status: string; name: string }> };
  };
}): OrderRisk[] {
  const risks: OrderRisk[] = [];
  for (const task of input.tasks ?? []) {
    if (task.uniqueKey?.includes(":MATERIALS:PROCUREMENT") || task.uniqueKey?.startsWith("PRICE_REVIEW:") || task.uniqueKey?.startsWith("CREATE_PO:")) continue;
    if (task.status !== "OVERDUE") continue;
    risks.push({
      id: `task-${task.id}`,
      type: "OVERDUE_TASK",
      title: `${task.title}已逾期`,
      description: `截止 ${new Date(task.dueAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}`,
      impact: "该节点已超出计划交期，完成业务动作后自动解除待处理状态，延期记录永久保留。",
      responsible: task.department,
      resolutionLabel: "完成当前节点业务动作",
    });
  }
  const readyManufacturedRoutes = input.fulfillmentTracks?.manufactured?.routes?.filter((route) => route.complete && !route.shipped) ?? [];
  if (["INSTALLATION_APPLICATION", "DELIVERY"].includes(input.stage) || readyManufacturedRoutes.length > 0) {
    if (!input.tailPaymentConfirmed) risks.push({ id: "shipment-tail-payment", type: "TAIL_PAYMENT", title: "尾款尚未确认到账", description: "定制产品与外购产品发货都必须先确认尾款。", impact: "将同时阻止两条发货线，不影响生产和到货登记。", responsible: input.tailPaymentReported ? "财务部" : input.creationMode === "INTERNAL_EXCEPTION" ? "订单管理员" : "所属销售", resolutionLabel: input.tailPaymentReported ? "核验尾款到账" : "报备尾款收款", resolutionCommand: input.tailPaymentReported ? "CONFIRM_TAIL_PAYMENT" : "REPORT_TAIL_PAYMENT" });
  }
  const outsourced = input.fulfillmentTracks?.outsourced;
  if (outsourced?.applicable && !outsourced.allShipped && ["INSTALLATION_APPLICATION", "DELIVERY", "INSTALLATION"].includes(input.stage)) {
    const pending = outsourced.lines.filter((line) => ["NOT_ARRIVED", "PARTIAL"].includes(line.status));
    if (pending.length) risks.push({ id: "outsource-not-ready", type: "OUTSOURCE_NOT_READY", title: "外购产品尚未全部齐套", description: pending.map((line) => line.name).join("、"), impact: input.stage === "INSTALLATION" ? "可继续现场施工，但会阻止提交安装完成。" : "不影响四车间生产；各产品齐套后可分别发货。", responsible: "订单管理员", resolutionLabel: "登记外购到货" });
  }
  const latestByProcess = new Map<string, RiskReport>();
  for (const report of input.productionReports ?? []) {
    const existing = latestByProcess.get(report.productionProcessId);
    if (!existing || new Date(report.reportedAt) > new Date(existing.reportedAt)) latestByProcess.set(report.productionProcessId, report);
  }
  for (const report of latestByProcess.values()) {
    if (report.action !== "ISSUE") continue;
    const process = report.process;
    const routeLabel = process?.productionRoute?.kind === "PANEL" ? "板式路线" : process?.productionRoute?.kind === "WOOD_PAINT" ? "实木油漆路线" : null;
    risks.push({ id: `production-${report.productionProcessId}`, type: "PRODUCTION_ISSUE", title: `${process?.productionArea?.name ? `${process.productionArea.name} · ` : ""}${routeLabel ? `${routeLabel} · ` : ""}${process?.workshopLabel ?? "车间"} · ${process?.processName ?? "工序"}存在异常`, description: report.note?.trim() || "报工时登记了异常，但尚无后续报工证明问题已解决。", impact: "该工序继续处于异常待处理状态。", responsible: process?.workshopLabel ?? "生产车间", resolutionLabel: "处理后在该工序继续报工" });
  }
  return risks;
}
