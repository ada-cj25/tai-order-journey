export type ProductionRouteKind = "PANEL" | "WOOD_PAINT";
export type WorkflowStepStatus = "PENDING" | "BLOCKED" | "ACTIVE" | "COMPLETE";

export const PRODUCTION_ROUTE_LABELS: Record<ProductionRouteKind, string> = {
  PANEL: "板式路线",
  WOOD_PAINT: "实木油漆路线",
};

export type RouteProcessFact = {
  workshop: string;
  processCode: string;
  plannedQty: number;
  completedQty: number;
  status: string;
  metricMode?: string | null;
};

export type ProductionRouteFact = {
  id: string;
  productionAreaId: string;
  kind: ProductionRouteKind;
  assemblyPlanQty: number;
  releasedAt?: Date | string | null;
  productionCompletedAt?: Date | string | null;
  shippedAt?: Date | string | null;
  processes: RouteProcessFact[];
};

export type ProductionAreaRouteFact = {
  id: string;
  name?: string;
  productionNumber?: string;
  routes: ProductionRouteFact[];
};

export type WorkflowStepProjection = {
  key: "MATERIALS" | "PRODUCTION" | "DELIVERY";
  status: WorkflowStepStatus;
  percent: number;
  reason: string | null;
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export function processCountsTowardProduction(process: RouteProcessFact) {
  return !["REFERENCE_CONFIRMATION", "PACKAGE_COUNT"].includes(process.metricMode ?? "");
}

export function projectProductionRoute(route: ProductionRouteFact) {
  const counted = route.processes.filter(processCountsTowardProduction);
  const ratios = counted.map((process) => {
    if (process.status === "COMPLETE") return 100;
    const planned = Number(process.plannedQty);
    const completed = Number(process.completedQty);
    return planned > 0 ? clampPercent(completed / planned * 100) : 0;
  });
  const percent = ratios.length ? clampPercent(ratios.reduce((sum, value) => sum + value, 0) / ratios.length) : 0;
  const complete = counted.length > 0 && counted.every((process) => process.status === "COMPLETE");
  return {
    ...route,
    label: PRODUCTION_ROUTE_LABELS[route.kind],
    percent,
    complete,
    shipped: Boolean(route.shippedAt),
    released: Boolean(route.releasedAt),
  };
}

export function projectRouteExecution(input: {
  areas: ProductionAreaRouteFact[];
  tailPaymentConfirmed: boolean;
}) {
  const areas = input.areas.map((area) => {
    const routes = area.routes.map(projectProductionRoute);
    const totalWeight = routes.reduce((sum, route) => sum + Math.max(0, Number(route.assemblyPlanQty)), 0);
    const percent = routes.length
      ? clampPercent(totalWeight > 0
        ? routes.reduce((sum, route) => sum + route.percent * Math.max(0, Number(route.assemblyPlanQty)), 0) / totalWeight
        : routes.reduce((sum, route) => sum + route.percent, 0) / routes.length)
      : 0;
    return {
      ...area,
      routes,
      percent,
      complete: routes.length > 0 && routes.every((route) => route.complete),
      shipped: routes.length > 0 && routes.every((route) => route.shipped),
    };
  });
  const routes = areas.flatMap((area) => area.routes);
  const procurementTotal = routes.length;
  const procurementCompleted = routes.filter((route) => route.released).length;
  const procurementPercent = procurementTotal ? clampPercent(procurementCompleted / procurementTotal * 100) : 0;
  const productionPercent = areas.length ? clampPercent(areas.reduce((sum, area) => sum + area.percent, 0) / areas.length) : 0;
  const shippedCount = routes.filter((route) => route.shipped).length;
  const shipmentPercent = routes.length ? clampPercent(shippedCount / routes.length * 100) : 0;
  const completeUnshippedRoutes = routes.filter((route) => route.complete && !route.shipped);
  const anyRouteReleased = routes.some((route) => route.released);
  const allProcurementComplete = procurementTotal > 0 && procurementCompleted === procurementTotal;
  const allProductionComplete = routes.length > 0 && routes.every((route) => route.complete);
  const allProductionShipped = routes.length > 0 && routes.every((route) => route.shipped);

  const steps: WorkflowStepProjection[] = [
    {
      key: "MATERIALS",
      status: allProcurementComplete ? "COMPLETE" : procurementCompleted > 0 ? "ACTIVE" : "PENDING",
      percent: procurementPercent,
      reason: allProcurementComplete ? null : `已确认 ${procurementCompleted}/${procurementTotal} 条区域采购路线`,
    },
    {
      key: "PRODUCTION",
      status: allProductionComplete ? "COMPLETE" : anyRouteReleased ? "ACTIVE" : "PENDING",
      percent: productionPercent,
      reason: anyRouteReleased ? null : "待确认至少一条采购路线",
    },
    {
      key: "DELIVERY",
      status: allProductionShipped
        ? "COMPLETE"
        : completeUnshippedRoutes.length && !input.tailPaymentConfirmed
          ? "BLOCKED"
          : shippedCount > 0 || (completeUnshippedRoutes.length > 0 && input.tailPaymentConfirmed)
            ? "ACTIVE"
            : "PENDING",
      percent: shipmentPercent,
      reason: completeUnshippedRoutes.length && !input.tailPaymentConfirmed ? "待财务确认尾款" : null,
    },
  ];

  return {
    areas,
    routes,
    procurementPercent,
    productionPercent,
    shipmentPercent,
    anyRouteReleased,
    allProcurementComplete,
    allProductionComplete,
    allProductionShipped,
    allowedProductionRouteIds: input.tailPaymentConfirmed ? completeUnshippedRoutes.map((route) => route.id) : [],
    completeUnshippedRouteIds: completeUnshippedRoutes.map((route) => route.id),
    steps,
  };
}
