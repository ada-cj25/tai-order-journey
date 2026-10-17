import { requireSession } from "../../domain/roles";
import type { MiniOrder, MiniPackageSource, MiniPackageSummary } from "../../domain/types";
import { loadRoleOrder } from "../../services/mobile";
import { loadPackageSummary, submitPackageCountCommand } from "../../services/package-count";

type SourceView = MiniPackageSource & { kindLabel: string; statusText: string; canConfirm: boolean; canFinish: boolean; visibleEntries: Array<{ id: string; quantity: number; timeLabel: string }> };

function sourceView(source: MiniPackageSource): SourceView {
  return { ...source,
    kindLabel: source.kind === "HARDWARE_AREA" ? "五金领用" : source.kind === "OUTSOURCED_PRODUCT" ? "外购入库" : "自产入库",
    statusText: source.kind === "HARDWARE_AREA" ? source.handoffConfirmed ? "已领用" : source.status === "FINALIZED" ? "待领用" : "待采购确认" : source.status === "FINALIZED" ? "已统计完成" : source.canAdd ? "可累计" : "等待打包",
    canConfirm: source.kind === "HARDWARE_AREA" && source.status === "FINALIZED" && !source.handoffConfirmed && Boolean(source.canConfirmHandoff),
    canFinish: source.kind !== "HARDWARE_AREA" && source.status === "OPEN" && source.canFinalize && source.total > 0,
    visibleEntries: source.entries.filter((entry) => !entry.voidedAt).map((entry) => ({ id: entry.id, quantity: entry.quantity, timeLabel: String(entry.recordedAt).replace("T", " ").slice(0, 16) })),
  };
}

function decodePageQueryValue(value?: string): string {
  if (!value) return "";
  try { return decodeURIComponent(value); }
  catch { return value; }
}

Page({
  data: { orderId: "", areaId: "", sourceKey: "", order: undefined as MiniOrder | undefined, summary: undefined as MiniPackageSummary | undefined, sources: [] as SourceView[], quantityBySource: {} as Record<string, string>, loading: true, saving: false },
  onLoad(query: { orderId?: string; areaId?: string; sourceKey?: string }) {
    const employee = requireSession();
    if (!employee) return;
    if (employee.role !== "WORKSHOP" || employee.workshop !== "ASSEMBLY") { wx.showToast({ title: "仅组装车间可办理包件", icon: "none" }); wx.navigateBack(); return; }
    this.setData({ orderId: decodePageQueryValue(query.orderId), areaId: decodePageQueryValue(query.areaId), sourceKey: decodePageQueryValue(query.sourceKey) });
  },
  onShow() { void this.loadData(); },
  onPullDownRefresh() { void this.loadData().finally(() => wx.stopPullDownRefresh()); },
  async loadData() {
    if (!this.data.orderId) return;
    this.setData({ loading: true });
    try {
      const [order, summary] = await Promise.all([loadRoleOrder(this.data.orderId), loadPackageSummary(this.data.orderId)]);
      const selectedSourceExists = summary.sources.some((source) => source.sourceKey === this.data.sourceKey);
      this.setData({ order, summary, sources: summary.sources.filter((source) => selectedSourceExists
        ? source.sourceKey === this.data.sourceKey
        : !this.data.areaId || source.productionAreaId === this.data.areaId || source.kind === "OUTSOURCED_PRODUCT").map(sourceView), loading: false });
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: error instanceof Error ? error.message : "包件台账加载失败", icon: "none", duration: 2800 });
    }
  },
  editQuantity(event: { currentTarget: { dataset: { key: string } }; detail: { value: string } }) {
    this.setData({ quantityBySource: { ...this.data.quantityBySource, [event.currentTarget.dataset.key]: event.detail.value } });
  },
  async send(sourceKey: string, command: "ADD_COUNT" | "FINALIZE_SOURCE" | "CONFIRM_HARDWARE_HANDOFF", quantity?: number) {
    if (this.data.saving || !this.data.order) return;
    this.setData({ saving: true });
    try {
      await submitPackageCountCommand(this.data.orderId, sourceKey, command, this.data.order.updatedAt, quantity);
      if (command === "ADD_COUNT") this.setData({ quantityBySource: { ...this.data.quantityBySource, [sourceKey]: "" } });
      await this.loadData();
      wx.showToast({ title: command === "ADD_COUNT" ? "本次包件已累计" : command === "FINALIZE_SOURCE" ? "统计已完成" : "五金已领用", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "提交失败，请刷新重试", icon: "none", duration: 3000 });
    } finally { this.setData({ saving: false }); }
  },
  addCount(event: { currentTarget: { dataset: { key: string } } }) {
    const key = event.currentTarget.dataset.key;
    const quantity = Number(this.data.quantityBySource[key]);
    if (!Number.isInteger(quantity) || quantity <= 0) { wx.showToast({ title: "请输入本次新增的整数包数", icon: "none" }); return; }
    void this.send(key, "ADD_COUNT", quantity);
  },
  finishSource(event: { currentTarget: { dataset: { key: string } } }) {
    const key = event.currentTarget.dataset.key;
    const source = this.data.sources.find((item) => item.sourceKey === key);
    if (!source?.canFinish) return;
    wx.showModal({ title: "确认包件统计完成", content: `确认 ${source.label} 共 ${source.total} 包件？确认后如需更正，请到电脑端按原因重新打开。`, confirmText: "确认", success: (result) => { if (result.confirm) void this.send(key, "FINALIZE_SOURCE"); } });
  },
  confirmHardware(event: { currentTarget: { dataset: { key: string } } }) {
    const key = event.currentTarget.dataset.key;
    const source = this.data.sources.find((item) => item.sourceKey === key);
    if (!source?.canConfirm) return;
    wx.showModal({ title: "确认领用五金", content: `确认已从采购领用 ${source.label} ${source.total} 包？此确认独立于生产面积报工。`, confirmText: "确认", success: (result) => { if (result.confirm) void this.send(key, "CONFIRM_HARDWARE_HANDOFF"); } });
  },
  back() { wx.navigateBack(); },
});
