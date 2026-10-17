const OUTSOURCE_ARRIVAL_ROLES = new Set(["ORDER_ADMIN", "CHAIRMAN"]);

export function canManageOutsourceArrivals(role: string) {
  return OUTSOURCE_ARRIVAL_ROLES.has(role);
}
