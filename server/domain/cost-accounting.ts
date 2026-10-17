export const WORKSHOP_COST_LABELS = {
  PANEL: "板式",
  ASSEMBLY: "组装",
  WOOD: "实木",
  PAINT: "油漆",
} as const;

export type WorkshopCostCode = keyof typeof WORKSHOP_COST_LABELS;

export type WorkshopPlan = {
  panelEnabled: boolean;
  woodPaintEnabled: boolean;
  panelPlanQty: number;
  woodPlanQty: number;
  paintPlanQty: number;
  assemblyPlanQty: number;
};

export type WorkshopRate = { id: string; workshop: string; version: number; unitPrice: number };

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function summarizeOutsourceCosts(lines: Array<{ plannedQty: unknown; unitPrice: unknown }>) {
  const missingPriceCount = lines.filter((line) => line.unitPrice == null).length;
  const subtotal = round2(lines.reduce((sum, line) => sum + (line.unitPrice == null ? 0 : round2(Number(line.plannedQty) * Number(line.unitPrice))), 0));
  return { subtotal, missingPriceCount, complete: missingPriceCount === 0 };
}

export function summarizeAfterSalesCosts(batches: Array<{ amount: unknown; voidedAt?: Date | string | null }>) {
  return {
    status: "CUMULATIVE" as const,
    subtotal: round2(batches.filter((batch) => !batch.voidedAt).reduce((sum, batch) => sum + Number(batch.amount), 0)),
  };
}

export function calculateWorkshopCostLines(plan: WorkshopPlan, rates: WorkshopRate[]) {
  const quantities: Record<WorkshopCostCode, number> = {
    PANEL: Number(plan.panelPlanQty),
    WOOD: Number(plan.woodPlanQty),
    PAINT: Number(plan.paintPlanQty),
    ASSEMBLY: Number(plan.assemblyPlanQty),
  };
  const enabled: WorkshopCostCode[] = [
    ...(plan.panelEnabled ? ["PANEL" as const] : []),
    ...(plan.woodPaintEnabled ? ["WOOD" as const, "PAINT" as const] : []),
    "ASSEMBLY",
  ];
  return enabled.map((workshop) => {
    const rate = rates.find((candidate) => candidate.workshop === workshop);
    if (!rate) throw new Error(`${WORKSHOP_COST_LABELS[workshop]}车间尚未配置综合单价`);
    const quantity = quantities[workshop];
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`${WORKSHOP_COST_LABELS[workshop]}车间计划面积必须大于0`);
    return {
      workshop,
      workshopLabel: WORKSHOP_COST_LABELS[workshop],
      quantity,
      unit: "㎡",
      unitPriceSnapshot: Number(rate.unitPrice),
      rateVersionId: rate.id,
      rateVersion: rate.version,
      lineTotal: round2(quantity * Number(rate.unitPrice)),
    };
  });
}

export function summarizeInstallationCosts(shipments: Array<{
  installedAt?: Date | string | null;
  transportCost?: unknown;
  areas: Array<{ productionAreaId: string; sequence: number; installationFee?: unknown; isFinalBatch: boolean }>;
}>, activeAreaIds: string[]) {
  const manufactured = shipments.filter((shipment) => shipment.areas.length > 0);
  const installationFees = manufactured.flatMap((shipment) => shipment.areas).reduce((sum, line) => sum + Number(line.installationFee ?? 0), 0);
  const transportFees = manufactured.reduce((sum, shipment) => sum + Number(shipment.transportCost ?? 0), 0);
  const activeAreas = new Set(activeAreaIds);
  const finalAreaCount = new Set(manufactured.flatMap((shipment) => shipment.areas.map((line) => line.isFinalBatch && activeAreas.has(line.productionAreaId) ? line.productionAreaId : null)).filter(Boolean)).size;
  const complete = activeAreas.size > 0
    && manufactured.length > 0
    && manufactured.every((shipment) => Boolean(shipment.installedAt) && shipment.transportCost != null && shipment.areas.every((line) => line.installationFee != null))
    && finalAreaCount === activeAreas.size;
  return { installationFees: round2(installationFees), transportFees: round2(transportFees), subtotal: round2(installationFees + transportFees), complete };
}
