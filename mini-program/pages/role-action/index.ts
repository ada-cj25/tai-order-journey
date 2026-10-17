import { runtime } from "../../config/runtime";
import { requireRole } from "../../domain/roles";
import type { MiniOrder, MiniReferenceData } from "../../domain/types";
import { loadMiniPaymentForm, loadMiniReferenceData, loadRoleOrder, previewMiniAttachment, runMiniOrderCommand, uploadMiniAttachment, type MiniPaymentForm } from "../../services/mobile";

const commandLabels: Record<string, [string, string]> = {
  CONFIRM_DEPOSIT: ["核验定金到账", "确认销售报备的定金已在对应账户实际到账"],
  CONFIRM_INITIAL_PAYMENTS: ["核验首付款", "定金与预付款必须分别核对，再一次性提交"],
  CONFIRM_TAIL_PAYMENT: ["核验尾款到账", "确认尾款实际到账后，订单才能通过发货门禁"],
  ACCEPT_DESIGN: ["接受设计任务", "确认合同范围并承诺1—7个工作日"],
  RETURN_DESIGN: ["退回销售", "说明原因后由所属销售重新分配设计师"],
  TRANSFER_DESIGN: ["转交设计任务", "转交后原正式设计截止时间不会改变"],
  ACCEPT_CUSTOMER: ["客户最终验收", "上传客户签字材料并登记验收日期与结论"],
};

function draftKey(orderId: string, command: string) { return `tai-mini-role-action:${orderId}:${command}`; }

Page({
  data: {
    employee: null as ReturnType<typeof requireRole>, order: undefined as MiniOrder | undefined, payment: null as MiniPaymentForm | null,
    references: null as MiniReferenceData | null, receipts: [] as Array<{ id: string; originalName: string; mimeType: string; sizeLabel: string }>,
    orderId: "", command: "", title: "业务办理", subtitle: "", loading: true, submitting: false, mockSampleWithoutReceipt: false,
    paymentAction: false, initialAction: false, acceptDesign: false, returnDesign: false, transferDesign: false, acceptance: false,
    form: { verified: false, depositVerified: false, prepaymentVerified: false, comment: "", designLeadDays: "", scopeConfirmed: false, reason: "", designerId: "", acceptedAt: "", customerConclusion: "", acceptanceAttachmentIds: [] as string[], attachmentPaths: [] as string[], overrideReason: "" },
    selectedDesignerIndex: -1,
  },
  onLoad(query: { orderId?: string; command?: string }) {
    const employee = requireRole(["CHAIRMAN", "FINANCE", "DESIGNER"]);
    if (!employee) return;
    const command = query.command ?? "";
    const labels = commandLabels[command];
    const allowed = employee.role === "FINANCE" ? ["CONFIRM_DEPOSIT", "CONFIRM_INITIAL_PAYMENTS", "CONFIRM_TAIL_PAYMENT"]
      : employee.role === "DESIGNER" ? ["ACCEPT_DESIGN", "RETURN_DESIGN", "TRANSFER_DESIGN"]
        : ["CONFIRM_DEPOSIT", "CONFIRM_INITIAL_PAYMENTS", "CONFIRM_TAIL_PAYMENT", "ACCEPT_CUSTOMER"];
    if (!labels || !allowed.includes(command) || !query.orderId) { wx.showToast({ title: "当前岗位不能办理该动作", icon: "none" }); wx.navigateBack(); return; }
    const stored = wx.getStorageSync<Record<string, unknown>>(draftKey(query.orderId, command));
    const form = { ...this.data.form, ...(stored ?? {}) };
    this.setData({ employee, orderId: query.orderId, command, title: labels[0], subtitle: labels[1], form,
      paymentAction: ["CONFIRM_DEPOSIT", "CONFIRM_INITIAL_PAYMENTS", "CONFIRM_TAIL_PAYMENT"].includes(command), initialAction: command === "CONFIRM_INITIAL_PAYMENTS",
      acceptDesign: command === "ACCEPT_DESIGN", returnDesign: command === "RETURN_DESIGN", transferDesign: command === "TRANSFER_DESIGN", acceptance: command === "ACCEPT_CUSTOMER" });
    this.loadData();
  },
  async loadData() {
    try {
      const [order, payment, references] = await Promise.all([
        loadRoleOrder(this.data.orderId),
        this.data.paymentAction ? loadMiniPaymentForm(this.data.orderId) : Promise.resolve(null),
        this.data.transferDesign ? loadMiniReferenceData() : Promise.resolve(null),
      ]);
      if (!order) throw new Error("订单不存在或无权访问");
      const receipts = (payment?.receipts ?? []).map((item) => ({ ...item, sizeLabel: item.size >= 1024 * 1024 ? `${(item.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(item.size / 1024))} KB` }));
      this.setData({ order, payment, references, receipts, loading: false,
        mockSampleWithoutReceipt: runtime.mode === "mock" && this.data.paymentAction && receipts.length === 0 });
    } catch (error) { this.setData({ loading: false }); wx.showToast({ title: error instanceof Error ? error.message : "表单加载失败", icon: "none" }); }
  },
  changeField(event: { currentTarget: { dataset: { field: string } }; detail: { value: string } }) {
    const field = event.currentTarget.dataset.field;
    const form = { ...this.data.form, [field]: event.detail.value };
    this.setData({ form });
    wx.setStorageSync(draftKey(this.data.orderId, this.data.command), form);
  },
  toggleField(event: { currentTarget: { dataset: { field: string } } }) {
    const field = event.currentTarget.dataset.field;
    const current = this.data.form as unknown as Record<string, unknown>;
    const form = { ...this.data.form, [field]: !current[field] };
    this.setData({ form });
    wx.setStorageSync(draftKey(this.data.orderId, this.data.command), form);
  },
  selectDesigner(event: { detail: { value: string } }) {
    const selectedDesignerIndex = Number(event.detail.value);
    const designerId = this.data.references?.designers[selectedDesignerIndex]?.id ?? "";
    const form = { ...this.data.form, designerId };
    this.setData({ selectedDesignerIndex, form });
    wx.setStorageSync(draftKey(this.data.orderId, this.data.command), form);
  },
  chooseAcceptancePhoto() {
    wx.chooseMedia({ count: 1, mediaType: ["image"], sourceType: ["camera", "album"], success: async (result) => {
      const path = result.tempFiles[0]?.tempFilePath;
      if (!path) return;
      this.setData({ "form.attachmentPaths": [path] });
      this.saveDraft();
      if (runtime.mode === "mock") { this.setData({ "form.acceptanceAttachmentIds": ["mock-customer-acceptance"] }); return; }
      try {
        const uploaded = await uploadMiniAttachment(this.data.orderId, path, "CUSTOMER_ACCEPTANCE");
        this.setData({ "form.acceptanceAttachmentIds": [uploaded.id] });
        this.saveDraft();
      } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "上传失败，照片已保留", icon: "none" }); }
    } });
  },
  previewReceipt(event: { currentTarget: { dataset: { id: string; mime: string } } }) {
    previewMiniAttachment(event.currentTarget.dataset.id, event.currentTarget.dataset.mime).catch((error) => wx.showToast({ title: error instanceof Error ? error.message : "附件读取失败", icon: "none" }));
  },
  saveDraft() { wx.setStorageSync(draftKey(this.data.orderId, this.data.command), this.data.form); },
  validate() {
    const form = this.data.form;
    if (this.data.mockSampleWithoutReceipt) return "演示样例没有真实凭证，不能核验";
    if (this.data.initialAction && (!form.depositVerified || !form.prepaymentVerified)) return "请分别确认定金和预付款";
    if (this.data.paymentAction && !this.data.initialAction && !form.verified) return "请确认该笔款项已实际到账";
    if (this.data.acceptDesign && (!Number.isInteger(Number(form.designLeadDays)) || Number(form.designLeadDays) < 1 || Number(form.designLeadDays) > 7 || !form.scopeConfirmed)) return "请填写1—7个工作日并确认合同范围";
    if (this.data.returnDesign && form.reason.trim().length < 2) return "请填写退回销售的具体原因";
    if (this.data.transferDesign && (!form.designerId || form.designerId === this.data.order?.designerOwnerId || form.reason.trim().length < 2)) return "请选择另一名设计师并填写转交原因";
    if (this.data.acceptance && (!form.acceptedAt || !form.customerConclusion.trim() || !form.acceptanceAttachmentIds.length)) return "请完整填写验收日期、结论并上传签字材料";
    if (this.data.employee?.role === "CHAIRMAN" && form.overrideReason.trim().length < 5) return "董事长关键覆盖必须填写至少5个字的原因";
    return "";
  },
  submit() {
    const message = this.validate();
    if (message) { wx.showToast({ title: message, icon: "none" }); return; }
    wx.showModal({ title: `确认${this.data.title}`, content: "提交后将由服务端重新校验岗位、订单范围、前置条件和数据版本。", confirmText: "确认提交", success: async (result) => {
      if (!result.confirm || !this.data.order) return;
      this.setData({ submitting: true });
      const payload: Record<string, unknown> = { ...this.data.form };
      delete payload.attachmentPaths;
      try {
        await runMiniOrderCommand(this.data.orderId, this.data.command, payload, this.data.order.updatedAt, `mini-${this.data.command}-${this.data.orderId}-${Date.now()}`);
        wx.removeStorageSync(draftKey(this.data.orderId, this.data.command));
        wx.showToast({ title: "提交成功", icon: "success" });
        setTimeout(() => wx.navigateBack(), 500);
      } catch (error) {
        const statusCode = (error as Error & { statusCode?: number }).statusCode;
        wx.showToast({ title: statusCode === 409 ? "数据已更新，请刷新后重新确认" : error instanceof Error ? error.message : "提交失败", icon: "none", duration: 3000 });
        if (statusCode === 409) this.loadData();
      } finally { this.setData({ submitting: false }); }
    } });
  },
  back() { wx.navigateBack(); },
});
