export type PackageCountKind = "HARDWARE_AREA" | "MANUFACTURED_AREA" | "MANUFACTURED_ROUTE" | "OUTSOURCED_PRODUCT";
export type PackageCountStatus = "OPEN" | "FINALIZED";

export type PackageCountAvailability = {
  canAdd: boolean;
  canFinalize: boolean;
  detail: string;
};

export function projectPackageCountAvailability(input: {
  kind: PackageCountKind;
  prerequisiteComplete?: boolean;
  arrivedQty?: number;
  plannedQty?: number;
  total: number;
}): PackageCountAvailability {
  if (input.kind === "HARDWARE_AREA") return {
    canAdd: true,
    canFinalize: true,
    detail: "由采购登记并确认本区域五金包数",
  };
  if (input.kind === "OUTSOURCED_PRODUCT") {
    const arrivedQty = Number(input.arrivedQty ?? 0);
    const plannedQty = Number(input.plannedQty ?? 0);
    if (arrivedQty <= 0) return {
      canAdd: false,
      canFinalize: false,
      detail: "待订单管理员登记外购到货；到货后由组装登记包件",
    };
    if (arrivedQty < plannedQty) return {
      canAdd: true,
      canFinalize: false,
      detail: "已部分到货，组装可继续登记包件；全部到货后可统计完成",
    };
    return {
      canAdd: true,
      canFinalize: true,
      detail: input.total > 0 ? "已全部到货，组装可继续登记包件或统计完成" : "已全部到货，请组装登记实际包件数",
    };
  }
  if (!input.prerequisiteComplete) return {
    canAdd: false,
    canFinalize: false,
    detail: input.kind === "MANUFACTURED_ROUTE" ? "待对应路线完成组装打包" : "待组装车间完成打包",
  };
  return {
    canAdd: true,
    canFinalize: true,
    detail: input.total > 0 ? "可继续登记包件或统计完成" : "组装打包已完成，请登记实际包件数",
  };
}

export type PackageCountSourceProjection = {
  sourceKey: string;
  kind: PackageCountKind;
  label: string;
  productionAreaId?: string;
  productionRouteId?: string;
  outsourceProductLineId?: string;
  status: PackageCountStatus;
  total: number;
  handoffConfirmed: boolean;
  canAdd: boolean;
  canFinalize: boolean;
  detail: string;
  canConfirmHandoff?: boolean;
  entries: Array<{ id: string; quantity: number; recordedAt: Date | string; voidedAt?: Date | string | null }>;
};

export function projectPackageSummary(input: {
  sources: PackageCountSourceProjection[];
  legacyClosed?: boolean;
  legacyApplicationEstimate?: number | null;
  legacyShipmentPieceTotal?: number | null;
}) {
  const totalFor = (kind: PackageCountKind) => input.sources.filter((source) => source.kind === kind).reduce((sum, source) => sum + source.total, 0);
  const currentTotal = input.sources.reduce((sum, source) => sum + source.total, 0);
  const complete = input.sources.length > 0 && input.sources.every((source) => source.status === "FINALIZED");
  const status = input.legacyClosed
    ? "LEGACY_UNVERIFIED"
    : complete
      ? "COMPLETE"
      : currentTotal === 0 && input.sources.every((source) => source.status === "OPEN")
        ? "NOT_STARTED"
        : "PARTIAL";
  return {
    currentTotal,
    status,
    hardwareTotal: totalFor("HARDWARE_AREA"),
    manufacturedTotal: totalFor("MANUFACTURED_AREA") + totalFor("MANUFACTURED_ROUTE"),
    outsourcedTotal: totalFor("OUTSOURCED_PRODUCT"),
    sources: input.sources,
    pendingSources: input.sources.filter((source) => source.status !== "FINALIZED"),
    legacyApplicationEstimate: input.legacyApplicationEstimate ?? null,
    legacyShipmentPieceTotal: input.legacyShipmentPieceTotal ?? null,
  };
}
