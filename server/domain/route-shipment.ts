export type RouteShipmentRequest = {
  productionRouteId: string;
  isFinalBatch: boolean;
};

export type RouteShipmentState = {
  id: string;
  productionAreaId: string;
  areaName: string;
  routeLabel: string;
  complete: boolean;
  finalShipmentRecorded: boolean;
  batchCount: number;
};

export function validateRouteShipmentBatches(
  routes: RouteShipmentState[],
  requested: RouteShipmentRequest[],
) {
  if (!requested.length) throw new Error("请至少选择一条可发产品路线");
  const ids = requested.map((line) => line.productionRouteId);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) throw new Error("请选择不重复的有效生产路线");
  const byId = new Map(routes.map((route) => [route.id, route]));
  return requested.map((line) => {
    const route = byId.get(line.productionRouteId);
    if (!route) throw new Error("选中路线不属于当前订单或已取消");
    if (!route.complete) throw new Error(`${route.areaName}·${route.routeLabel}尚未完工，不能发货`);
    if (route.finalShipmentRecorded) throw new Error(`${route.areaName}·${route.routeLabel}已确认末批，不得再发货`);
    return { ...route, isFinalBatch: line.isFinalBatch === true, sequence: route.batchCount + 1 };
  });
}

export function isAreaFinalAfterRouteBatch(
  areaRouteIds: string[],
  existingFinalRouteIds: Iterable<string>,
  requested: RouteShipmentRequest[],
) {
  const finalized = new Set(existingFinalRouteIds);
  for (const line of requested) if (line.isFinalBatch) finalized.add(line.productionRouteId);
  return areaRouteIds.length > 0 && areaRouteIds.every((id) => finalized.has(id));
}
