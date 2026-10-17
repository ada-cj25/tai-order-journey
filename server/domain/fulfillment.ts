export type FulfillmentArea = {
  id: string;
  complete: boolean;
  shipped: boolean;
  shipmentBatches?: Array<{ isFinalBatch: boolean; installed: boolean }>;
  routes?: Array<{
    id: string;
    kind: "PANEL" | "WOOD_PAINT";
    complete: boolean;
    shipped: boolean;
    shipmentInstalled?: boolean;
    shipmentBatches?: Array<{ isFinalBatch: boolean; installed: boolean }>;
  }>;
};

export type FulfillmentOutsourceLine = {
  id: string;
  name: string;
  plannedQty: number;
  unit: string;
  usageArea?: string | null;
  note?: string | null;
  arrivals: Array<{ id: string; quantity: number; arrivedOn: Date | string; voidedAt?: Date | string | null }>;
  shipmentLine?: { shipmentId: string } | null;
};

export type FulfillmentInput = {
  tailPaymentConfirmed: boolean;
  installationApplied: boolean;
  outsourceMode: "UNDECLARED" | "NONE" | "REQUIRED" | "LEGACY_EXEMPT";
  productionAreas: FulfillmentArea[];
  outsourceLines: FulfillmentOutsourceLine[];
};

export function projectFulfillment(input: FulfillmentInput) {
  const routeMode = input.productionAreas.some((area) => (area.routes?.length ?? 0) > 0);
  const routes = input.productionAreas.flatMap((area) => (area.routes ?? []).map((route) => {
    const batches = route.shipmentBatches;
    const shipped = batches ? batches.some((batch) => batch.isFinalBatch) : route.shipped;
    const shipmentInstalled = batches
      ? shipped && batches.length > 0 && batches.every((batch) => batch.installed)
      : Boolean(route.shipmentInstalled);
    return { ...route, shipped, shipmentInstalled, batchCount: batches?.length ?? (shipped ? 1 : 0), productionAreaId: area.id };
  }));
  const allProductionAreasComplete = input.productionAreas.length > 0 && input.productionAreas.every((area) => (
    area.routes?.length ? area.routes.every((route) => route.complete) : area.complete
  ));
  const areaStates = input.productionAreas.map((area) => {
    const batches = area.shipmentBatches;
    const finalShipmentRecorded = batches ? batches.some((batch) => batch.isFinalBatch) : area.shipped;
    const installationComplete = batches ? batches.length > 0 && batches.every((batch) => batch.installed) : area.shipped;
    return { ...area, batchCount: batches?.length ?? (area.shipped ? 1 : 0), finalShipmentRecorded, installationComplete };
  });
  const manufacturedShipped = routeMode
    ? routes.length > 0 && routes.every((route) => route.shipped)
    : areaStates.length > 0 && areaStates.every((area) => area.finalShipmentRecorded);
  const manufacturedInstalled = routeMode
    ? manufacturedShipped && routes.every((route) => route.shipmentInstalled)
    : manufacturedShipped && areaStates.every((area) => area.installationComplete);
  const outsourceApplicable = input.outsourceMode === "REQUIRED";
  const outsourcedLines = input.outsourceLines.map((line) => {
    const validArrivals = line.arrivals.filter((arrival) => !arrival.voidedAt);
    const arrivedQty = validArrivals.reduce((sum, arrival) => sum + Number(arrival.quantity), 0);
    const shipped = Boolean(line.shipmentLine);
    const arrivalStatus = arrivedQty <= 0 ? "NOT_ARRIVED" : arrivedQty < line.plannedQty ? "PARTIAL" : "READY";
    return {
      ...line,
      arrivedQty,
      remainingQty: Math.max(0, line.plannedQty - arrivedQty),
      arrivalStatus,
      status: shipped ? "SHIPPED" : arrivalStatus,
      latestArrivalOn: validArrivals.length
        ? validArrivals.map((arrival) => new Date(arrival.arrivedOn)).sort((a, b) => b.getTime() - a.getTime())[0]!.toISOString()
        : null,
      canShip: input.tailPaymentConfirmed && arrivalStatus === "READY" && !shipped,
    };
  });
  const outsourcedAllShipped = !outsourceApplicable || (outsourcedLines.length > 0 && outsourcedLines.every((line) => line.status === "SHIPPED"));
  return {
    manufactured: {
      allProductionAreasComplete,
      shipped: manufacturedShipped,
      installed: manufacturedInstalled,
      areas: areaStates,
      tailPaymentConfirmed: input.tailPaymentConfirmed,
      installationApplied: input.installationApplied,
      routeMode,
      routes,
      allowedAreaIds: areaStates.filter((area) => area.complete && !area.finalShipmentRecorded).map((area) => area.id),
      allowedProductionRouteIds: routes.filter((route) => route.complete && !route.shipped).map((route) => route.id),
      allowed: input.tailPaymentConfirmed && (routeMode
        ? routes.some((route) => route.complete && !route.shipped)
        : areaStates.some((area) => area.complete && !area.finalShipmentRecorded)),
    },
    outsourced: {
      mode: input.outsourceMode,
      applicable: outsourceApplicable,
      lines: outsourcedLines,
      readyCount: outsourcedLines.filter((line) => line.arrivalStatus === "READY" && line.status !== "SHIPPED").length,
      shippedCount: outsourcedLines.filter((line) => line.status === "SHIPPED").length,
      allShipped: outsourcedAllShipped,
      canShipAny: input.tailPaymentConfirmed && outsourcedLines.some((line) => line.arrivalStatus === "READY" && line.status !== "SHIPPED"),
    },
    installationCompletionAllowed: manufacturedInstalled && outsourcedAllShipped,
  };
}
