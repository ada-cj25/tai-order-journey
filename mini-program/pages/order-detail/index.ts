import { requireSession } from "../../domain/roles";
import { runtime } from "../../config/runtime";
import { getMockPaymentState, getMockTechnicalState, mockTailPaymentReady } from "../../domain/store";
import type { MiniOrder } from "../../domain/types";
import { advanceMockPreReview, advanceMockProcurementRoute, advanceMockTechnicalReview, advanceMockTechnicalSplit, loadRoleOrder } from "../../services/mobile";

type Area = MiniOrder["productionAreas"][number];

let refreshTimer: ReturnType<typeof setInterval> | undefined;

Page({
  data: { order: undefined as MiniOrder | undefined, id: "", selectedAreaId: "", selectedArea: undefined as Area | undefined, showSalesOwner: false, canOpenAfterSales: false, canOpenPackageCounts: false, canOpenSupply: false, canReturnDesign: false, canTransferDesign: false, canSubmitDesign: false, canReportMockPayment: false, canReportMockTail: false, mockTailStatus: "", canAdvanceMockPreReview: false, canAdvanceMockTechnicalSplit: false, canAdvanceMockTechnicalReview: false, canReleaseMockPanel: false, canReleaseMockWoodPaint: false },
  onLoad(query: { id?: string; areaId?: string }) { const employee = requireSession(); if (!employee) return; this.setData({ id: query.id ?? "", selectedAreaId: query.areaId ?? "", showSalesOwner: employee.role === "SALES" && employee.level === "SUPERVISOR" }); },
  onShow() {
    void this.loadData();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => void this.loadData(true), 30_000);
  },
  onHide() { if (refreshTimer) clearInterval(refreshTimer); refreshTimer = undefined; },
  onUnload() { if (refreshTimer) clearInterval(refreshTimer); refreshTimer = undefined; },
  async loadData(silent = false) {
    try {
      const order = await loadRoleOrder(this.data.id);
      const selectedAreaId = order?.productionAreas.some((area) => area.id === this.data.selectedAreaId) ? this.data.selectedAreaId : order?.productionAreas[0]?.id ?? "";
      const employee = requireSession();
      const ownDesign = employee?.role === "DESIGNER" && order?.designerOwnerId === employee.id;
      const technical = runtime.mode === "mock" && order ? getMockTechnicalState(order.id) : null;
      const payment = runtime.mode === "mock" && order ? getMockPaymentState(order.id) : null;
      const tailReady = runtime.mode === "mock" && order ? mockTailPaymentReady(order) : false;
      this.setData({ order, selectedAreaId, selectedArea: order?.productionAreas.find((area) => area.id === selectedAreaId), canOpenAfterSales: employee?.role === "AFTERSALES" && Boolean(order && ["验收完成", "履约完成"].includes(order.stageLabel)), canOpenPackageCounts: employee?.role === "WORKSHOP" && employee.workshop === "ASSEMBLY" && Boolean(order?.productionAreas.length), canOpenSupply: Boolean(employee && ["PROCUREMENT", "ORDER_ADMIN", "CHAIRMAN"].includes(employee.role)), canReturnDesign: ownDesign && order?.stageLabel === "设计待接单", canTransferDesign: ownDesign && order?.stageLabel === "设计交付", canSubmitDesign: ownDesign && order?.stageLabel === "设计交付",
        canReportMockTail: Boolean(tailReady && payment && !payment.tail && employee?.role === "SALES" && order?.salesOwnerId === employee.id),
        mockTailStatus: tailReady ? payment?.tailConfirmedAt ? "尾款已核验，可以安排发货" : payment?.tail ? "尾款已报备，等待财务核验；暂不能发货" : "尾款尚未报备；暂不能发货" : "",
        canAdvanceMockPreReview: runtime.mode === "mock" && employee?.role === "ORDER_ADMIN" && Boolean(order?.trackingSerial.startsWith("TEST-DEMO-GD-") && order?.salesNumber && order?.stageLabel === "审单拆单"),
        canAdvanceMockTechnicalSplit: runtime.mode === "mock" && employee?.role === "TECHNICAL" && Boolean(order?.trackingSerial.startsWith("TEST-DEMO-GD-") && order?.stageLabel === "技术拆单" && !technical),
        canAdvanceMockTechnicalReview: runtime.mode === "mock" && employee?.role === "ORDER_ADMIN" && technical?.phase === "TECH_REVIEW",
        canReleaseMockPanel: runtime.mode === "mock" && employee?.role === "PROCUREMENT" && Boolean(technical && ["PROCUREMENT", "PRODUCTION"].includes(technical.phase) && !technical.panelReleasedAt),
        canReleaseMockWoodPaint: runtime.mode === "mock" && employee?.role === "PROCUREMENT" && Boolean(technical && ["PROCUREMENT", "PRODUCTION"].includes(technical.phase) && !technical.woodPaintReleasedAt),
        canReportMockPayment: runtime.mode === "mock" && Boolean(order?.trackingSerial.startsWith("TEST-DEMO-GD-") && !order.businessType?.endsWith("_SUPPLEMENT") && !getMockPaymentState(order.id) && employee?.role === "SALES" && order.salesOwnerId === employee.id) });
    } catch (error) { if (!silent) wx.showToast({ title: error instanceof Error ? error.message : "订单加载失败", icon: "none" }); }
  },
  selectArea(event: { currentTarget: { dataset: { id: string } } }) {
    const selectedAreaId = event.currentTarget.dataset.id;
    this.setData({ selectedAreaId, selectedArea: this.data.order?.productionAreas.find((area) => area.id === selectedAreaId) });
  },
  openProcess(event: { currentTarget: { dataset: { task: string } } }) {
    const taskId = event.currentTarget.dataset.task;
    if (!taskId) { wx.showToast({ title: "当前账号不可报此工序", icon: "none" }); return; }
    wx.navigateTo({ url: `/pages/report/index?taskId=${taskId}` });
  },
  openPackageCounts() { wx.navigateTo({ url: `/pages/package-count/index?orderId=${encodeURIComponent(this.data.id)}&areaId=${encodeURIComponent(this.data.selectedAreaId)}` }); },
  openSupply() { wx.navigateTo({ url: `/pages/supply/index?orderId=${encodeURIComponent(this.data.id)}` }); },
  openAfterSales() { if (this.data.canOpenAfterSales) wx.navigateTo({ url: `/pages/aftersales/index?orderId=${encodeURIComponent(this.data.id)}` }); },
  openDesignAction(event: { currentTarget: { dataset: { command: string } } }) { wx.navigateTo({ url: `/pages/role-action/index?orderId=${this.data.id}&command=${event.currentTarget.dataset.command}` }); },
  openDesignSubmit() { wx.navigateTo({ url: `/pages/design-submit/index?orderId=${encodeURIComponent(this.data.id)}` }); },
  openMockPaymentReport() { wx.navigateTo({ url: `/pages/sales-create/index?orderId=${this.data.id}` }); },
  openMockTailReport() { wx.navigateTo({ url: `/pages/tail-payment/index?orderId=${encodeURIComponent(this.data.id)}` }); },
  advanceMockReview() {
    wx.showModal({ title: "模拟前置审单通过", content: "仅推进这部手机上的 TEST 演示订单，用于测试技术岗位待办。此操作不核验设计文件，不写入网页版或 PostgreSQL；正式审单仍需在电脑端完成。", confirmText: "模拟通过", success: (result) => {
      if (!result.confirm) return;
      void advanceMockPreReview(this.data.id).then(() => this.loadData()).then(() => wx.showToast({ title: "已移交技术岗位", icon: "success" })).catch((error) => wx.showToast({ title: error instanceof Error ? error.message : "模拟推进失败", icon: "none" }));
    } });
  },
  advanceMockSplit() {
    wx.showModal({ title: "模拟技术拆单", content: "将在本机为这张 TEST 订单生成厨房（木工＋油漆）、阳台（板式）、主卧（两条路线）三区域，并交给订单管理员模拟技术审单。不会解析物料 Excel，也不会写入网页版。", confirmText: "生成区域", success: (result) => {
      if (!result.confirm) return;
      void advanceMockTechnicalSplit(this.data.id).then(() => this.loadData()).then(() => wx.showToast({ title: "三区域已生成", icon: "success" })).catch((error) => wx.showToast({ title: error instanceof Error ? error.message : "模拟拆单失败", icon: "none" }));
    } });
  },
  advanceMockTechReview() {
    wx.showModal({ title: "模拟技术审单通过", content: "本机测试将继续交给采购确认路线。此操作不代替正式技术审单和材料核验。", confirmText: "模拟通过", success: (result) => {
      if (!result.confirm) return;
      void advanceMockTechnicalReview(this.data.id).then(() => this.loadData()).then(() => wx.showToast({ title: "已交给采购", icon: "success" })).catch((error) => wx.showToast({ title: error instanceof Error ? error.message : "模拟审单失败", icon: "none" }));
    } });
  },
  releaseMockRoute(event: { currentTarget: { dataset: { kind: "PANEL" | "WOOD_PAINT" } } }) {
    const kind = event.currentTarget.dataset.kind;
    wx.showModal({ title: "模拟采购路线放行", content: `仅在本机放行${kind === "PANEL" ? "板式" : "实木油漆"}路线；对应车间的首道工序随后可报工。`, confirmText: "模拟放行", success: (result) => {
      if (!result.confirm) return;
      void advanceMockProcurementRoute(this.data.id, kind).then(() => this.loadData()).then(() => wx.showToast({ title: "路线已放行", icon: "success" })).catch((error) => wx.showToast({ title: error instanceof Error ? error.message : "模拟放行失败", icon: "none" }));
    } });
  },
  showDesktopEvidence() { wx.showModal({ title: "资料查看说明", content: "设计师可在手机提交页上传并预览 CAD、客户确认图和样块；此处仅显示附件摘要。海迅、物料解析和完整材料表请到电脑端订单详情查看。", confirmText: "复制编号", success: (result) => { if (result.confirm && this.data.order) wx.setClipboardData({ data: this.data.order.salesNumber || this.data.order.trackingSerial }); } }); },
  back() { wx.navigateBack(); }
});
