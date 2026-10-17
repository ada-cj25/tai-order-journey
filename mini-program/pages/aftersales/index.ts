import { runtime } from "../../config/runtime";
import { addMockAfterSalesCostBatch, createMockAfterSalesCase, transitionMockAfterSalesCase, voidMockAfterSalesCostBatch } from "../../domain/mock-aftersales";
import { newIdempotencyKey } from "../../domain/projections";
import { requireRole } from "../../domain/roles";
import { getStoredSession } from "../../domain/store";
import type { MiniAfterSalesCase, MiniOrder } from "../../domain/types";
import { addMiniAfterSalesCostBatch, createMiniAfterSales, loadMiniAfterSalesCases, loadRoleOrders, previewMiniAttachment, transitionMiniAfterSales, uploadMiniAttachment, voidMiniAfterSalesCostBatch } from "../../services/mobile";
import { loadRoleWorkspace } from "../../services/workspace";

const statusFilters = ["全部", "新问题", "处理中", "已解决"];
const today = () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
const showError = (error: unknown, fallback: string) => wx.showToast({ title: error instanceof Error ? error.message : fallback, icon: "none" });
type PickedEvidence = { path: string; name: string };
const evidenceMime = (name: string) => /\.pdf$/i.test(name) ? "application/pdf" : /\.heic$/i.test(name) ? "image/heic" : /\.png$/i.test(name) ? "image/png" : "image/jpeg";

Page({
  data: {
    cases: [] as MiniAfterSalesCase[], allCases: [] as MiniAfterSalesCase[], selectedCase: null as MiniAfterSalesCase | null,
    completedOrders: [] as MiniOrder[], orderLabels: [] as string[], createOrderIndex: 0, query: "", statusFilters, filterIndex: 0,
    costModuleEnabled: false, canRecordCosts: false, mockMode: runtime.mode === "mock", resolvingCase: null as MiniAfterSalesCase | null, resolution: "",
    creating: false, createIssueType: "", createDescription: "", createDate: today(), createAmount: "", createAttachments: [] as PickedEvidence[],
    addingCost: false, costDate: today(), costAmount: "", costDescription: "", costAttachments: [] as PickedEvidence[],
    voidingBatchId: "", voidReason: "", submitting: false,
  },
  initialCaseId: "",
  initialOrderId: "",
  onLoad(options: { caseId?: string; orderId?: string }) {
    requireRole(["AFTERSALES"]);
    this.initialCaseId = options.caseId ?? "";
    this.initialOrderId = options.orderId ?? "";
  },
  async onShow() { await this.refresh(); },
  async refresh() {
    try {
      const [allCases, workspace, orders] = await Promise.all([loadMiniAfterSalesCases(), loadRoleWorkspace(), loadRoleOrders()]);
      const completedOrders = orders.filter((item) => item.stageLabel === "验收完成" || item.stageLabel === "履约完成" || item.stageIndex === item.stageTotal && item.nextAction.includes("验收已归档"));
      const selectedCase = allCases.find((item) => item.id === (this.initialCaseId || this.data.selectedCase?.id)) ?? null;
      const createOrderIndex = Math.max(0, completedOrders.findIndex((item) => item.id === this.initialOrderId));
      const canRecordCosts = runtime.mode === "mock" || workspace.costModuleEnabled;
      this.setData({ allCases, selectedCase, completedOrders, createOrderIndex,
        orderLabels: completedOrders.map((item) => `${item.salesNumber ?? item.trackingSerial} · ${item.customerName}`),
        costModuleEnabled: workspace.costModuleEnabled, canRecordCosts });
      this.applyFilter(this.data.query, this.data.filterIndex);
      if (this.initialOrderId && completedOrders.length && canRecordCosts) this.setData({ creating: true });
      this.initialOrderId = ""; this.initialCaseId = "";
    } catch (error) { showError(error, "售后列表加载失败"); }
  },
  changeQuery(event: { detail: { value: string } }) { this.setData({ query: event.detail.value }); this.applyFilter(event.detail.value, this.data.filterIndex); },
  changeFilter(event: { detail: { value: string } }) { const filterIndex = Number(event.detail.value); this.setData({ filterIndex }); this.applyFilter(this.data.query, filterIndex); },
  applyFilter(query: string, filterIndex: number) {
    const text = query.trim().toLowerCase();
    const states = [null, "OPEN", "IN_PROGRESS", "RESOLVED"];
    const state = states[filterIndex];
    this.setData({ cases: this.data.allCases.filter((item: MiniAfterSalesCase) => (!state || item.status === state) && [item.customerName, item.salesNumber, item.caseNumber, item.issueType].some((value) => value.toLowerCase().includes(text))) });
  },
  openCase(event: { currentTarget: { dataset: { id: string } } }) {
    const current = this.data.allCases.find((item: MiniAfterSalesCase) => item.id === event.currentTarget.dataset.id);
    this.setData({ selectedCase: this.data.selectedCase?.id === current?.id ? null : current ?? null });
  },
  noop() {},
  openOrder() { if (this.data.selectedCase) wx.navigateTo({ url: `/pages/order-detail/index?id=${encodeURIComponent(this.data.selectedCase.orderId)}` }); },
  changeField(event: { currentTarget: { dataset: { field: string } }; detail: { value: string } }) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }); },
  changeCreateOrder(event: { detail: { value: string } }) { this.setData({ createOrderIndex: Number(event.detail.value) }); },
  changeCreateDate(event: { detail: { value: string } }) { this.setData({ createDate: event.detail.value }); },
  changeCostDate(event: { detail: { value: string } }) { this.setData({ costDate: event.detail.value }); },
  chooseEvidence(event: { currentTarget: { dataset: { target: "create" | "cost" } } }) {
    const target = event.currentTarget.dataset.target;
    const field = target === "create" ? "createAttachments" : "costAttachments";
    if (this.data[field].length >= 6) { wx.showToast({ title: "最多添加 6 份", icon: "none" }); return; }
    wx.showActionSheet({ itemList: ["拍照或选相册", "从微信选文件"], success: (result) => {
      if (result.tapIndex === 0) this.choosePhoto(event);
      if (result.tapIndex === 1) this.chooseDocument(event);
    } });
  },
  choosePhoto(event: { currentTarget: { dataset: { target: "create" | "cost" } } }) {
    const field = event.currentTarget.dataset.target === "create" ? "createAttachments" : "costAttachments";
    wx.chooseMedia({ count: Math.max(1, 6 - this.data[field].length), mediaType: ["image"], sourceType: ["camera", "album"], success: (result) => this.setData({ [field]: [...this.data[field], ...result.tempFiles.map((item, index) => ({ path: item.tempFilePath, name: `售后照片-${Date.now()}-${index}.${/\.heic$/i.test(item.tempFilePath) ? "heic" : "jpg"}` }))].slice(0, 6) }) });
  },
  chooseDocument(event: { currentTarget: { dataset: { target: "create" | "cost" } } }) {
    const field = event.currentTarget.dataset.target === "create" ? "createAttachments" : "costAttachments";
    wx.chooseMessageFile({ count: Math.max(1, 6 - this.data[field].length), type: "file", success: (result) => {
      const picked = result.tempFiles.filter((item) => /\.(pdf|png|jpe?g|heic)$/i.test(item.name)).map((item) => ({ path: item.path, name: item.name }));
      if (!picked.length) { wx.showToast({ title: "请选择 PDF 或图片", icon: "none" }); return; }
      this.setData({ [field]: [...this.data[field], ...picked].slice(0, 6) });
    } });
  },
  openResolution() { if (this.data.selectedCase?.status === "IN_PROGRESS") this.setData({ resolvingCase: this.data.selectedCase, resolution: "" }); },
  closeResolution() { if (!this.data.submitting) this.setData({ resolvingCase: null, resolution: "" }); },
  async startCase() { const current = this.data.selectedCase; if (current?.status === "OPEN") await this.advance(current, "START"); },
  async submitResolution() {
    const current = this.data.resolvingCase;
    if (!current) return;
    if (!this.data.resolution.trim()) { wx.showToast({ title: "请填写处理结果", icon: "none" }); return; }
    await this.advance(current, "RESOLVE", this.data.resolution.trim());
  },
  async advance(current: MiniAfterSalesCase, action: "START" | "RESOLVE", resolution?: string) {
    this.setData({ submitting: true });
    try {
      if (runtime.mode === "api") await transitionMiniAfterSales(current.id, action, resolution, current.updatedAt, newIdempotencyKey("aftersales"));
      else transitionMockAfterSalesCase(current.id, getStoredSession(), action, resolution);
      this.setData({ resolvingCase: null, resolution: "" });
      await this.refresh(); wx.showToast({ title: "售后状态已更新", icon: "success" });
    } catch (error) { showError(error, "状态更新失败"); }
    finally { this.setData({ submitting: false }); }
  },
  createCase() { if (this.data.canRecordCosts && this.data.completedOrders.length) this.setData({ creating: true }); },
  closeCreate() { if (!this.data.submitting) this.setData({ creating: false }); },
  async uploadPhotos(orderId: string, files: PickedEvidence[]): Promise<string[]> {
    if (runtime.mode === "api") return (await Promise.all(files.map((item) => uploadMiniAttachment(orderId, item.path, "AFTERSALES_COST", undefined, item.name)))).map((item) => item.id);
    return Promise.all(files.map((item) => new Promise<string>((resolve, reject) => wx.saveFile({ tempFilePath: item.path, success: (result) => resolve(result.savedFilePath), fail: () => reject(new Error("凭证保存在本机失败，请重新选择")) }))));
  },
  async submitCreate() {
    const order = this.data.completedOrders[this.data.createOrderIndex];
    if (!order || !this.data.createIssueType.trim() || !this.data.createDescription.trim() || !this.data.createDate || !(Number(this.data.createAmount) > 0)) { wx.showToast({ title: "请填写问题和本次费用", icon: "none" }); return; }
    this.setData({ submitting: true });
    try {
      const attachmentIds = await this.uploadPhotos(order.id, this.data.createAttachments);
      const input = { orderId: order.id, issueType: this.data.createIssueType.trim(), description: this.data.createDescription.trim(), incurredOn: this.data.createDate, amount: Number(this.data.createAmount), attachmentIds };
      const created = runtime.mode === "api" ? await createMiniAfterSales(input, order.updatedAt, newIdempotencyKey("aftersales-create")) : createMockAfterSalesCase(order, getStoredSession(), { ...input, attachments: attachmentIds.map((id, index) => ({ id, originalName: this.data.createAttachments[index]!.name, mimeType: evidenceMime(this.data.createAttachments[index]!.name) })) });
      this.setData({ creating: false, createIssueType: "", createDescription: "", createDate: today(), createAmount: "", createAttachments: [], selectedCase: created as MiniAfterSalesCase, query: "", filterIndex: 0 });
      await this.refresh(); wx.showToast({ title: "售后问题已登记", icon: "success" });
    } catch (error) { showError(error, "售后登记失败"); }
    finally { this.setData({ submitting: false }); }
  },
  openCost() { if (this.data.selectedCase && this.data.canRecordCosts) this.setData({ addingCost: true, costDate: today(), costAmount: "", costDescription: "", costAttachments: [] }); },
  closeCost() { if (!this.data.submitting) this.setData({ addingCost: false }); },
  async submitCost() {
    const current = this.data.selectedCase; if (!current) return;
    if (!this.data.costDate || !this.data.costDescription.trim() || !(Number(this.data.costAmount) > 0)) { wx.showToast({ title: "请填写日期、金额和说明", icon: "none" }); return; }
    this.setData({ submitting: true });
    try {
      const attachmentIds = await this.uploadPhotos(current.orderId, this.data.costAttachments);
      const input = { incurredOn: this.data.costDate, amount: Number(this.data.costAmount), description: this.data.costDescription.trim(), attachmentIds };
      if (runtime.mode === "api") await addMiniAfterSalesCostBatch(current.id, input, current.updatedAt, newIdempotencyKey("aftersales-cost"));
      else addMockAfterSalesCostBatch(current.id, getStoredSession(), { ...input, attachments: attachmentIds.map((id, index) => ({ id, originalName: this.data.costAttachments[index]!.name, mimeType: evidenceMime(this.data.costAttachments[index]!.name) })) });
      this.setData({ addingCost: false }); await this.refresh(); wx.showToast({ title: "费用已累计", icon: "success" });
    } catch (error) { showError(error, "费用登记失败"); }
    finally { this.setData({ submitting: false }); }
  },
  openVoid(event: { currentTarget: { dataset: { id: string } } }) { if (this.data.canRecordCosts) this.setData({ voidingBatchId: event.currentTarget.dataset.id, voidReason: "" }); },
  previewEvidence(event: { currentTarget: { dataset: { id: string; mime: string } } }) {
    const { id, mime } = event.currentTarget.dataset;
    if (runtime.mode === "api") { void previewMiniAttachment(id, mime).catch((error) => showError(error, "附件打开失败")); return; }
    if (mime.startsWith("image/")) wx.previewImage({ urls: [id], current: id });
    else wx.openDocument({ filePath: id, showMenu: false, fail: () => wx.showToast({ title: "文件打开失败", icon: "none" }) });
  },
  closeVoid() { if (!this.data.submitting) this.setData({ voidingBatchId: "", voidReason: "" }); },
  async submitVoid() {
    const current = this.data.selectedCase; if (!current || !this.data.voidingBatchId) return;
    if (!this.data.voidReason.trim()) { wx.showToast({ title: "请填写作废原因", icon: "none" }); return; }
    this.setData({ submitting: true });
    try {
      if (runtime.mode === "api") await voidMiniAfterSalesCostBatch(current.id, this.data.voidingBatchId, this.data.voidReason.trim(), current.updatedAt, newIdempotencyKey("aftersales-void"));
      else voidMockAfterSalesCostBatch(current.id, this.data.voidingBatchId, getStoredSession(), this.data.voidReason.trim());
      this.setData({ voidingBatchId: "", voidReason: "" }); await this.refresh(); wx.showToast({ title: "费用已作废", icon: "success" });
    } catch (error) { showError(error, "费用作废失败"); }
    finally { this.setData({ submitting: false }); }
  },
  openNotifications() { wx.navigateTo({ url: "/pages/notifications/index" }); },
});
