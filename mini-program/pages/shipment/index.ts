import { runtime } from "../../config/runtime";
import { getMockPaymentState, getOrder } from "../../domain/store";
import { mockShipmentRoutes, recordMockShipment } from "../../domain/mock-shipment";
import { getMockShipmentState } from "../../domain/mock-shipment-state";
import { newIdempotencyKey } from "../../domain/projections";
import { getMockOutsourceLines } from "../../domain/mock-outsource";
import { requireRole } from "../../domain/roles";
import type { MiniOrder } from "../../domain/types";
import { loadMiniReferenceData, loadMiniShipmentForm, runMiniOrderCommand } from "../../services/mobile";

type InputEvent = { currentTarget: { dataset: { field?: string; index?: number } }; detail: { value: string | boolean } };

type ShipmentRouteRow = ReturnType<typeof mockShipmentRoutes>[number];
type ShipmentOutsourceRow = { id: string; name: string; usageArea: string | null; plannedQty: number; arrivedQty: number; unit: string; shipped: boolean; selected: boolean };
type ShipmentDraft = { routes?: ShipmentRouteRow[]; outsourceLines?: ShipmentOutsourceRow[]; installerIndex?: number; vehicle?: string; installationTeamLabel?: string; contact?: string; plannedAt?: string; siteConditions?: string; transportNote?: string };
const shipmentDraftKey = (employeeId: string, orderId: string) => `tai-mini-shipment-draft:${employeeId}:${orderId}`;
const restoreRoutes = (routes: ShipmentRouteRow[], draft: ShipmentDraft) => routes.map((route) => {
  const saved = draft.routes?.find((item) => item.id === route.id);
  return saved && route.completed && !route.finalBatchRecorded ? { ...route, selected: Boolean(saved.selected), isFinalBatch: Boolean(saved.isFinalBatch), installationFee: String(saved.installationFee ?? "") } : route;
});
const restoreOutsource = (lines: ShipmentOutsourceRow[], draft: ShipmentDraft) => lines.map((line) => {
  const saved = draft.outsourceLines?.find((item) => item.id === line.id);
  return saved && !line.shipped && line.arrivedQty >= line.plannedQty ? { ...line, selected: Boolean(saved.selected) } : line;
});

const installers = [
  { id: "TEST-INSTALLER-01", label: "赵师傅 · 安装一组" },
  { id: "TEST-INSTALLER-02", label: "孙师傅 · 安装二组" },
];

Page({
  data: {
    mockMode: runtime.mode === "mock",
    order: null as MiniOrder | null, tailPaymentConfirmed: false,
    routes: [] as ShipmentRouteRow[], outsourceLines: [] as ShipmentOutsourceRow[], installers, installerIndex: 0,
    vehicle: "", installationTeamLabel: "安装一组", contact: "", plannedAt: "", siteConditions: "", transportNote: "", submitting: false,
  },
  async onLoad(query: { orderId?: string }) {
    const employee = requireRole(["ORDER_ADMIN"]);
    if (!employee) return;
    const orderId = query.orderId ? decodeURIComponent(query.orderId) : "";
    if (!orderId) { wx.redirectTo({ url: "/pages/shipment-list/index" }); return; }
    this.setData({ mockMode: runtime.mode === "mock" });
    const saved = wx.getStorageSync<ShipmentDraft>(shipmentDraftKey(employee.id, orderId));
    const draft = saved && typeof saved === "object" ? saved : {};
    this.setData({ installerIndex: draft.installerIndex ?? 0, vehicle: draft.vehicle ?? "", installationTeamLabel: draft.installationTeamLabel ?? "安装一组", contact: draft.contact ?? "", plannedAt: draft.plannedAt ?? "", siteConditions: draft.siteConditions ?? "", transportNote: draft.transportNote ?? "", submitting: false });
    if (runtime.mode === "mock") {
      const order = getOrder(orderId);
      if (!order) { wx.showToast({ title: "发货订单不存在", icon: "none" }); wx.redirectTo({ url: "/pages/shipment-list/index" }); return; }
      const localOrder = order.trackingSerial.startsWith("TEST-DEMO-GD-");
      const shippedOutsourceIds = getMockShipmentState(order.id).shippedOutsourceIds;
      this.setData({ order, routes: restoreRoutes(mockShipmentRoutes(order), draft), tailPaymentConfirmed: localOrder ? Boolean(getMockPaymentState(order.id)?.tailConfirmedAt) : order.id === "TEST-DEMO-ZHOU-ORDER-001",
        outsourceLines: restoreOutsource(getMockOutsourceLines(order.id).map((line) => ({
      id: line.id, name: line.name, usageArea: line.usageArea, plannedQty: line.plannedQty,
      arrivedQty: line.arrivedQty, unit: line.unit, shipped: line.shipped || shippedOutsourceIds.includes(line.id), selected: false,
      })), draft) });
    }
    if (runtime.mode === "api") {
      try {
        const [form, reference] = await Promise.all([loadMiniShipmentForm(orderId), loadMiniReferenceData()]);
        const installerOptions = reference.installers.map((item) => ({ id: item.id, label: `${item.name} · ${item.department}` }));
        this.setData({
          order: form.order as MiniOrder, tailPaymentConfirmed: form.tailPaymentConfirmed,
          routes: restoreRoutes(form.routes.map((item) => ({ ...item, selected: false, isFinalBatch: false, installationFee: "" })), draft),
          outsourceLines: restoreOutsource(form.outsourceLines.map((item) => ({ ...item, selected: false })), draft), installers: installerOptions,
          installerIndex: draft.installerIndex !== undefined && installerOptions[draft.installerIndex] ? draft.installerIndex : 0,
          installationTeamLabel: draft.installationTeamLabel ?? installerOptions[0]?.label.split(" · ")[1] ?? "", submitting: false,
        });
      } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "发货资料加载失败", icon: "none" }); wx.redirectTo({ url: "/pages/shipment-list/index" }); }
    }
  },
  toggleRoute(event: InputEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const current = this.data.routes[index];
    if (!current?.completed || current.finalBatchRecorded) { wx.showToast({ title: current?.finalBatchRecorded ? "该路线已确认末批" : "该路线尚未完工，不能发货", icon: "none" }); return; }
    this.setData({ routes: this.data.routes.map((item: ShipmentRouteRow, itemIndex: number) => itemIndex === index ? { ...item, selected: !item.selected } : item) });
  },
  changeFinal(event: InputEvent) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ routes: this.data.routes.map((item: ShipmentRouteRow, itemIndex: number) => itemIndex === index ? { ...item, isFinalBatch: Boolean(event.detail.value) } : item) });
  },
  changeFee(event: InputEvent) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ routes: this.data.routes.map((item: ShipmentRouteRow, itemIndex: number) => itemIndex === index ? { ...item, installationFee: String(event.detail.value) } : item) });
  },
  toggleOutsource(event: InputEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const current = this.data.outsourceLines[index];
    if (!current || current.shipped || current.arrivedQty < current.plannedQty) { wx.showToast({ title: current?.shipped ? "该外购产品已发货" : "该外购产品尚未齐套", icon: "none" }); return; }
    this.setData({ outsourceLines: this.data.outsourceLines.map((item: ShipmentOutsourceRow, itemIndex: number) => itemIndex === index ? { ...item, selected: !item.selected } : item) });
  },
  changeInstaller(event: { detail: { value: string } }) { const installerIndex = Number(event.detail.value); this.setData({ installerIndex, installationTeamLabel: this.data.installers[installerIndex]?.label.split(" · ")[1] ?? "" }); },
  changeDate(event: { detail: { value: string } }) { this.setData({ plannedAt: event.detail.value }); },
  changeField(event: InputEvent) { const field = event.currentTarget.dataset.field; if (field) this.setData({ [field]: String(event.detail.value) }); },
  saveDraft() { const { order, routes, outsourceLines, installerIndex, vehicle, installationTeamLabel, contact, plannedAt, siteConditions, transportNote } = this.data; const employee = requireRole(["ORDER_ADMIN"]); if (!order || !employee) return; wx.setStorageSync(shipmentDraftKey(employee.id, order.id), { routes, outsourceLines, installerIndex, vehicle, installationTeamLabel, contact, plannedAt, siteConditions, transportNote, savedAt: new Date().toISOString() }); wx.showToast({ title: "发货草稿已保存", icon: "success" }); },
  validationError() {
    if (!this.data.order) return "请先选择发货订单";
    if (!this.data.tailPaymentConfirmed) return "尾款尚未确认，不能发货";
    const selectedRoutes = this.data.routes.filter((item: ShipmentRouteRow) => item.selected);
    const selectedOutsource = this.data.outsourceLines.filter((item: ShipmentOutsourceRow) => item.selected);
    if (!selectedRoutes.length && !selectedOutsource.length) return "请选择至少一条路线或外购产品";
    if (!this.data.vehicle.trim()) return "请填写车辆信息";
    if (selectedRoutes.length) {
      if (!this.data.installers[this.data.installerIndex]) return "请选择安装负责人";
      if (!this.data.installationTeamLabel.trim() || !this.data.contact.trim() || !this.data.plannedAt || !this.data.siteConditions.trim()) return "请完整填写本车次安装安排";
      if (selectedRoutes.some((item: ShipmentRouteRow) => item.installationFee === "" || Number(item.installationFee) < 0)) return "请填写每个区域的安装费";
    }
    return "";
  },
  async submit() {
    const error = this.validationError();
    if (error) { wx.showToast({ title: error, icon: "none", duration: 2800 }); return; }
    const routeCount = this.data.routes.filter((item: ShipmentRouteRow) => item.selected).length;
    const outsourceCount = this.data.outsourceLines.filter((item: ShipmentOutsourceRow) => item.selected).length;
    this.setData({ submitting: true });
    if (runtime.mode === "api") {
      try {
        const selectedRoutes = this.data.routes.filter((item: ShipmentRouteRow) => item.selected);
        const selectedOutsource = this.data.outsourceLines.filter((item: ShipmentOutsourceRow) => item.selected);
        const installationFees = Object.fromEntries(selectedRoutes.map((item: ShipmentRouteRow) => [item.areaId, Number(item.installationFee)]));
        const installer = this.data.installers[this.data.installerIndex];
        const activeOrder = this.data.order;
        if (!installer || !activeOrder?.id) throw new Error("发货订单或安装负责人无效");
        const order = await runMiniOrderCommand(activeOrder.id, "RECORD_DELIVERY", {
          productionRouteBatches: selectedRoutes.map((item: ShipmentRouteRow) => ({ productionRouteId: item.id, isFinalBatch: item.isFinalBatch })),
          outsourceLineIds: selectedOutsource.map((item: ShipmentOutsourceRow) => item.id), vehicle: this.data.vehicle.trim(), installationFees,
          assignedInstallerId: installer.id, installationTeamLabel: this.data.installationTeamLabel.trim(), contact: this.data.contact.trim(), plannedAt: this.data.plannedAt, supplyChecks: this.data.siteConditions.trim(), transportNote: this.data.transportNote.trim(),
        }, activeOrder.updatedAt, newIdempotencyKey("shipment"));
        wx.removeStorageSync(shipmentDraftKey(requireRole(["ORDER_ADMIN"])?.id ?? "", activeOrder.id));
        wx.showModal({ title: "发货车次已登记", content: `发货日期已由服务端记录。\n安装任务已分配给：${installer.label}`, showCancel: false, success: () => wx.redirectTo({ url: `/pages/order-detail/index?id=${order.id}` }) });
      } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "发货提交失败", icon: "none", duration: 2800 }); }
      finally { this.setData({ submitting: false }); }
      return;
    }
    wx.showModal({ title: "确认登记发货", content: `订单：${this.data.order?.salesNumber || this.data.order?.trackingSerial}\n客户：${this.data.order?.customerName}\n生产路线：${routeCount} 条\n外购产品：${outsourceCount} 项\n车辆：${this.data.vehicle}\n当前为本机模拟记录`, confirmText: "确认提交", success: (result) => {
      if (!result.confirm || !this.data.order) { this.setData({ submitting: false }); return; }
      try {
        const order = this.data.order;
        recordMockShipment(order, {
          routes: this.data.routes.filter((item: ShipmentRouteRow) => item.selected).map((item: ShipmentRouteRow) => ({ id: item.id, areaName: item.areaName, productionNumber: item.productionNumber, isFinalBatch: item.isFinalBatch })),
          outsourceIds: this.data.outsourceLines.filter((item: ShipmentOutsourceRow) => item.selected).map((item: ShipmentOutsourceRow) => item.id),
          vehicle: this.data.vehicle.trim(), installerId: this.data.installers[this.data.installerIndex]?.id ?? "",
          installationTeamLabel: this.data.installationTeamLabel.trim(), contact: this.data.contact.trim(), plannedAt: this.data.plannedAt,
          siteConditions: this.data.siteConditions.trim(),
        });
        const employee = requireRole(["ORDER_ADMIN"]);
        if (employee) wx.removeStorageSync(shipmentDraftKey(employee.id, order.id));
        wx.showToast({ title: "本机发货记录已保存", icon: "success" });
        wx.redirectTo({ url: "/pages/shipment-list/index" });
      } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "发货登记失败", icon: "none" }); }
      finally { this.setData({ submitting: false }); }
    } });
  },
  back() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: "/pages/workspace/index" });
  },
});
