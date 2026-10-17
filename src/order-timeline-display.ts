type TimelineDisplayEvent = {
  type: string;
  title: string;
  description: string;
  metadata?: Record<string, unknown> | null;
};

type PackageSource = { sourceKey: string; label: string };

const fallbackLabels: Record<string, string> = {
  HARDWARE_AREA: "区域五金包",
  MANUFACTURED_AREA: "自产区域包件",
  MANUFACTURED_ROUTE: "自产路线包件",
  OUTSOURCED_PRODUCT: "外购产品包件",
};

export function orderTimelineDisplay(event: TimelineDisplayEvent, sources: PackageSource[] = []) {
  if (!event.type.startsWith("PACKAGE_COUNT_") || event.type === "PACKAGE_COUNT_HARDWARE_BULK_FINALIZED") {
    return { title: event.title, description: event.description };
  }

  const rawKey = typeof event.metadata?.sourceKey === "string"
    ? event.metadata.sourceKey
    : event.description.split("·")[0] ?? "";
  const kind = rawKey.split(":")[0] ?? "";
  const sourceLabel = typeof event.metadata?.sourceLabel === "string" ? event.metadata.sourceLabel : sources.find((source) => source.sourceKey === rawKey)?.label;
  const label = (sourceLabel ?? fallbackLabels[kind] ?? "发货包件").replace(/·自产成品入库$/, "");
  const command = event.type.slice("PACKAGE_COUNT_".length);
  const quantity = Number(event.metadata?.quantity);
  const action: Record<string, string> = {
    ADD_COUNT: Number.isInteger(quantity) && quantity > 0 ? `追加 ${quantity} 包件` : "追加包件",
    FINALIZE_SOURCE: "统计完成",
    CONFIRM_HARDWARE_HANDOFF: "组装确认领用五金",
    REOPEN_SOURCE: "重新打开统计",
    VOID_ENTRY: "包件记录已作废",
  };
  const reason = typeof event.metadata?.reason === "string" ? event.metadata.reason.trim() : "";
  return { title: `${label} · ${action[command] ?? "统计已更新"}`, description: reason && ["REOPEN_SOURCE", "VOID_ENTRY"].includes(command) ? `原因：${reason}` : "" };
}
