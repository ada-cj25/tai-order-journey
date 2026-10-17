import { requireRole } from "../../domain/roles";
import { loadMiniSupplySummary, recordMiniOutsourceArrival, type MiniSupplySummary } from "../../services/mobile";

function todayInShanghai(): string { return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10); }

Page({
  data: {
    orderId: "", role: "", summary: null as MiniSupplySummary | null, loading: true, busy: false,
    editingLineId: "", quantity: "", arrivedOn: todayInShanghai(),
  },
  onLoad(query: { orderId?: string }) {
    const employee = requireRole(["PROCUREMENT", "ORDER_ADMIN", "CHAIRMAN"]);
    if (!employee) return;
    this.setData({ orderId: query.orderId ?? "", role: employee.role });
  },
  onShow() { if (this.data.orderId) void this.loadData(); },
  onPullDownRefresh() { void this.loadData().finally(() => wx.stopPullDownRefresh()); },
  async loadData() {
    this.setData({ loading: true });
    try { this.setData({ summary: await loadMiniSupplySummary(this.data.orderId), loading: false }); }
    catch (error) { this.setData({ loading: false }); wx.showToast({ title: error instanceof Error ? error.message : "统计加载失败", icon: "none" }); }
  },
  openProcurement() { wx.navigateTo({ url: `/pages/role-center/index?section=procurement&orderId=${encodeURIComponent(this.data.orderId)}` }); },
  beginArrival(event: { currentTarget: { dataset: { id: string } } }) {
    const line = this.data.summary?.outsourceLines.find((item) => item.id === event.currentTarget.dataset.id);
    if (!line || !line.remainingQty || line.shipped || this.data.role !== "ORDER_ADMIN") return;
    this.setData({ editingLineId: line.id, quantity: String(line.remainingQty), arrivedOn: todayInShanghai() });
  },
  cancelArrival() { this.setData({ editingLineId: "", quantity: "" }); },
  changeQuantity(event: { detail: { value: string } }) { this.setData({ quantity: event.detail.value }); },
  changeDate(event: { detail: { value: string } }) { this.setData({ arrivedOn: event.detail.value }); },
  submitArrival() {
    const summary = this.data.summary;
    const line = summary?.outsourceLines.find((item) => item.id === this.data.editingLineId);
    const quantity = Number(this.data.quantity);
    if (!line || this.data.busy) return;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > line.remainingQty) { wx.showToast({ title: `请填写1到${line.remainingQty}的整数`, icon: "none" }); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(this.data.arrivedOn)) { wx.showToast({ title: "请选择实际到货日期", icon: "none" }); return; }
    wx.showModal({ title: "确认外购到货", content: `${line.name}本次到货 ${quantity} ${line.unit}，实际到货日期 ${this.data.arrivedOn}。记录将累计保留。`, confirmText: "确认登记", success: async (result) => {
      if (!result.confirm || !summary || this.data.busy) return;
      this.setData({ busy: true });
      try {
        const updated = await recordMiniOutsourceArrival(this.data.orderId, line.id, quantity, this.data.arrivedOn, summary.order.updatedAt);
        this.setData({ summary: updated, editingLineId: "", quantity: "" });
        wx.showToast({ title: "到货已登记", icon: "success" });
      } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "到货登记失败", icon: "none", duration: 3000 }); }
      finally { this.setData({ busy: false }); }
    } });
  },
  back() { wx.navigateBack(); },
});
