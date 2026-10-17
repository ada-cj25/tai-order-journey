import { runtime } from "../../config/runtime";
import { getOrder } from "../../domain/store";
import { recordMockCustomerAcceptance, recordMockInstallation } from "../../domain/mock-shipment";
import { newIdempotencyKey } from "../../domain/projections";
import { requireRole } from "../../domain/roles";
import { completeMiniInstallation, loadRoleOrder, reportMiniInstallationProgress, runMiniOrderCommand, uploadMiniAttachment } from "../../services/mobile";

type InputEvent = { currentTarget: { dataset: { field: string } }; detail: { value: string } };

Page({
  data: {
    mockMode: runtime.mode === "mock", employee: null as ReturnType<typeof requireRole>, shipmentId: "",
    order: null as ReturnType<typeof getOrder> | null, mode: "installation" as "installation" | "acceptance",
    task: { vehicle: "", plannedAt: "", address: "", contact: "", areas: "", siteConditions: "" },
    completionDate: "", resultIndex: 0, results: ["安装完成", "部分完成", "发现问题"], note: "", transportCost: "", attachments: [] as string[],
    acceptanceDate: "", acceptanceIndex: 0, acceptanceResults: ["验收通过", "有保留项"], signaturePath: "", submitting: false,
  },
  async onLoad(query: { mode?: string; orderId?: string; shipmentId?: string }) {
    const employee = requireRole(["INSTALLER", "ORDER_ADMIN"]); if (!employee) return;
    this.setData({ mockMode: runtime.mode === "mock" });
    const mode = query.mode === "acceptance" ? "acceptance" : "installation";
    if (employee.role === "ORDER_ADMIN" && mode !== "acceptance") { wx.showToast({ title: "订单管理员不能完成安装", icon: "none" }); wx.navigateBack(); return; }
    if (!query.orderId) { wx.redirectTo({ url: employee.role === "ORDER_ADMIN" ? "/pages/workspace/index" : "/pages/installation-list/index" }); return; }
    const orderId = decodeURIComponent(query.orderId);
    const shipmentId = query.shipmentId ? decodeURIComponent(query.shipmentId) : "";
    const draft = wx.getStorageSync<Record<string, unknown>>(`tai-mini-${mode}-draft:${employee.id}:${orderId}:${shipmentId}`);
    this.setData({ ...(draft && typeof draft === "object" ? draft : {}), mode, employee, shipmentId, submitting: false });
    if (runtime.mode === "mock") {
      const order = getOrder(orderId);
      const shipment = order?.shipments?.find((item) => item.id === shipmentId);
      const canAccept = mode !== "acceptance" || Boolean(order?.stageLabel === "待客户验收" && (employee.role === "ORDER_ADMIN" || order.shipments?.some((item) => item.assignedInstallerId === employee.id)));
      const canInstall = mode !== "installation" || Boolean(shipment && shipment.assignedInstallerId === employee.id && !shipment.installedAt && shipment.areas.length);
      if (!order || !canAccept || !canInstall) {
        wx.showToast({ title: "未找到分配给当前账号的安装车次", icon: "none" });
        wx.redirectTo({ url: employee.role === "ORDER_ADMIN" ? "/pages/workspace/index" : "/pages/installation-list/index" }); return;
      }
      this.setData({ order, shipmentId, task: shipment ? { vehicle: shipment.vehicle, plannedAt: String(shipment.plannedInstallationAt ?? "").slice(0, 10), address: order.address ?? "", contact: shipment.siteContact ?? "", areas: shipment.areas.map((item) => `${item.areaName} · ${item.productionNumber}`).join("、"), siteConditions: shipment.siteConditions ?? "" } : this.data.task });
      return;
    }
    if (runtime.mode === "api") {
      try {
        const order = await loadRoleOrder(orderId);
        const shipment = order?.shipments?.find((item) => item.id === shipmentId);
        if (!order || (mode === "installation" && !shipment)) throw new Error("未找到分配给当前账号的安装车次");
        this.setData({ order, shipmentId: shipment?.id ?? "", task: shipment ? { vehicle: shipment.vehicle, plannedAt: String(shipment.plannedInstallationAt ?? "").slice(0, 10), address: order.address ?? "", contact: shipment.siteContact ?? "", areas: shipment.areas.map((item) => `${item.areaName} · ${item.productionNumber}`).join("、"), siteConditions: shipment.siteConditions ?? "" } : this.data.task });
      } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "安装任务加载失败", icon: "none" }); }
    }
  },
  changeDate(event: { detail: { value: string } }) { this.setData({ [this.data.mode === "acceptance" ? "acceptanceDate" : "completionDate"]: event.detail.value }); },
  changeResult(event: { detail: { value: string } }) { this.setData({ [this.data.mode === "acceptance" ? "acceptanceIndex" : "resultIndex"]: Number(event.detail.value) }); },
  changeField(event: InputEvent) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }); },
  choosePhoto() { wx.chooseMedia({ count: Math.max(1, 6 - this.data.attachments.length), mediaType: ["image"], sourceType: ["camera", "album"], success: (result) => this.setData({ attachments: [...this.data.attachments, ...result.tempFiles.map((file) => file.tempFilePath)].slice(0, 6) }) }); },
  chooseSignature() { wx.chooseMedia({ count: 1, mediaType: ["image"], sourceType: ["camera", "album"], success: (result) => this.setData({ signaturePath: result.tempFiles[0]?.tempFilePath ?? "" }) }); },
  draftKey() { return `tai-mini-${this.data.mode}-draft:${this.data.employee?.id ?? ""}:${this.data.order?.id ?? ""}:${this.data.shipmentId}`; },
  saveDraft() { const { submitting, ...draft } = this.data; wx.setStorageSync(this.draftKey(), { ...draft, savedAt: new Date().toISOString() }); wx.showToast({ title: "草稿已保存", icon: "success" }); },
  async submit() {
    if (this.data.mode === "acceptance") {
      if (!this.data.acceptanceDate || !this.data.signaturePath) { wx.showToast({ title: "请选择验收日期并上传签字", icon: "none" }); return; }
    } else {
      if (!this.data.completionDate) { wx.showToast({ title: "请填写安装日期", icon: "none" }); return; }
      if (this.data.resultIndex === 0 && (this.data.transportCost === "" || Number(this.data.transportCost) < 0)) { wx.showToast({ title: "安装完成时请填写运输费", icon: "none" }); return; }
      if (!this.data.attachments.length) { wx.showToast({ title: "请至少上传一张安装现场照片", icon: "none" }); return; }
      if (this.data.resultIndex > 0 && !this.data.note.trim()) { wx.showToast({ title: "部分完成或发现问题时必须填写说明", icon: "none" }); return; }
    }
    this.setData({ submitting: true });
    if (runtime.mode === "api") {
      try {
        const activeOrder = this.data.order;
        if (!activeOrder?.id) throw new Error("安装订单信息不完整");
        if (this.data.mode === "acceptance") {
          const signature = await uploadMiniAttachment(activeOrder.id, this.data.signaturePath, "CUSTOMER_ACCEPTANCE");
          const order = await runMiniOrderCommand(activeOrder.id, "ACCEPT_CUSTOMER", { acceptedAt: this.data.acceptanceDate, acceptanceAttachmentIds: [signature.id], customerConclusion: this.data.acceptanceResults[this.data.acceptanceIndex] + (this.data.note.trim() ? `：${this.data.note.trim()}` : "") }, activeOrder.updatedAt, newIdempotencyKey("acceptance"));
          wx.removeStorageSync(this.draftKey());
          wx.showModal({ title: "客户验收已归档", content: "签字材料、验收日期和结论已保存。", showCancel: false, success: () => wx.redirectTo({ url: `/pages/order-detail/index?id=${order.id}` }) });
        } else {
          if (!this.data.shipmentId) throw new Error("安装车次不存在");
          const uploaded = await Promise.all(this.data.attachments.map((path: string) => uploadMiniAttachment(activeOrder.id, path, "INSTALLATION_PHOTO")));
          const payload = { photoAttachmentIds: uploaded.map((item) => item.id), note: this.data.note.trim(), reportedOn: this.data.completionDate };
          const order = this.data.resultIndex === 0
            ? await completeMiniInstallation(activeOrder.id, this.data.shipmentId, { installedAt: this.data.completionDate, installer: this.data.employee?.name ?? "安装人员", issueConclusion: this.data.note.trim(), transportCost: Number(this.data.transportCost), photoAttachmentIds: payload.photoAttachmentIds }, activeOrder.updatedAt, newIdempotencyKey("installation-complete"))
            : await reportMiniInstallationProgress(activeOrder.id, this.data.shipmentId, { ...payload, reportType: this.data.resultIndex === 1 ? "PARTIAL" : "ISSUE" }, activeOrder.updatedAt, newIdempotencyKey("installation-progress"));
          wx.removeStorageSync(this.draftKey());
          wx.showModal({ title: this.data.resultIndex === 0 ? "本批安装已完成" : "现场记录已上报", content: this.data.resultIndex === 0 ? "本车次任务已从待办移除。" : "任务仍保留在安装待办中。", showCancel: false, success: () => wx.redirectTo({ url: `/pages/order-detail/index?id=${order.id}` }) });
        }
      } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "安装记录提交失败", icon: "none", duration: 2800 }); }
      finally { this.setData({ submitting: false }); }
      return;
    }
    wx.showModal({ title: this.data.mode === "acceptance" ? "确认客户验收" : "确认安装记录", content: `${this.data.order?.customerName ?? ""} · ${this.data.task.areas}\n${this.data.mode === "acceptance" ? this.data.acceptanceResults[this.data.acceptanceIndex] : this.data.results[this.data.resultIndex]}\n\n当前为本机模拟记录`, confirmText: "确认提交", success: (result) => {
      if (!result.confirm) { this.setData({ submitting: false }); return; }
      try {
        if (!this.data.order?.id) throw new Error("安装订单信息不完整");
        if (this.data.mode === "acceptance") recordMockCustomerAcceptance(this.data.order.id, {
          acceptedAt: this.data.acceptanceDate, conclusion: this.data.acceptanceResults[this.data.acceptanceIndex] + (this.data.note.trim() ? `：${this.data.note.trim()}` : ""),
          signaturePath: this.data.signaturePath,
        });
        else {
          if (!this.data.shipmentId) throw new Error("安装车次不存在");
          recordMockInstallation(this.data.order.id, this.data.shipmentId, {
            type: this.data.resultIndex === 0 ? "COMPLETE" : this.data.resultIndex === 1 ? "PARTIAL" : "ISSUE",
            reportedOn: this.data.completionDate, note: this.data.note.trim(), photoPaths: this.data.attachments,
            transportCost: this.data.resultIndex === 0 ? Number(this.data.transportCost) : null,
          });
        }
        wx.removeStorageSync(this.draftKey());
        wx.showToast({ title: this.data.mode === "acceptance" ? "客户验收已归档" : this.data.resultIndex === 0 ? "本批安装已完成" : "现场记录已保存", icon: "success" });
        wx.redirectTo({ url: this.data.mode === "acceptance" ? `/pages/order-detail/index?id=${this.data.order.id}` : "/pages/installation-list/index" });
      } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "安装记录提交失败", icon: "none" }); this.setData({ submitting: false }); }
    } });
  },
  back() { if (getCurrentPages().length > 1) wx.navigateBack(); else wx.reLaunch({ url: this.data.employee?.role === "ORDER_ADMIN" ? "/pages/workspace/index" : "/pages/installation-list/index" }); },
});
