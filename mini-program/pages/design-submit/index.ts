import { runtime } from "../../config/runtime";
import { requireRole } from "../../domain/roles";
import type { MiniOrder } from "../../domain/types";
import { loadMiniDesignDraft, loadRoleOrder, previewMiniAttachment, runMiniOrderCommand, saveMiniDesignDraft, saveMockDesignFile, uploadMiniAttachment, type MiniDesignFile } from "../../services/mobile";

type DesignField = "designVersion" | "surveyedAt" | "customerConfirmedAt" | "spaces" | "materials" | "sampleBlockRemark";
type DesignCategory = "DESIGN_CAD" | "DESIGN_CONFIRMATION" | "CUSTOMER_SAMPLE_BLOCK";
type DesignForm = Record<DesignField, string> & { cadAttachmentIds: string[]; confirmationAttachmentIds: string[]; sampleBlockAttachmentIds: string[] };
const blankForm = (): DesignForm => ({ designVersion: "V1", surveyedAt: "", customerConfirmedAt: "", spaces: "", materials: "", sampleBlockRemark: "", cadAttachmentIds: [], confirmationAttachmentIds: [], sampleBlockAttachmentIds: [] });
const fields: Record<DesignCategory, keyof Pick<DesignForm, "cadAttachmentIds" | "confirmationAttachmentIds" | "sampleBlockAttachmentIds">> = {
  DESIGN_CAD: "cadAttachmentIds", DESIGN_CONFIRMATION: "confirmationAttachmentIds", CUSTOMER_SAMPLE_BLOCK: "sampleBlockAttachmentIds",
};
const allowed: Record<DesignCategory, string[]> = {
  DESIGN_CAD: ["dwg", "dxf", "pdf", "xls", "xlsx"],
  DESIGN_CONFIRMATION: ["pdf", "png", "jpg", "jpeg"],
  CUSTOMER_SAMPLE_BLOCK: ["pdf", "png", "jpg", "jpeg", "heic"],
};
function extension(name: string) { return name.split(".").pop()?.toLowerCase() ?? ""; }
function mime(name: string) { const ext = extension(name); return ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : ext === "heic" ? "image/heic" : ["jpg", "jpeg"].includes(ext) ? "image/jpeg" : "application/octet-stream"; }
function label(error: unknown) { return error instanceof Error ? error.message : "操作失败，请重试"; }
function date(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value); }

Page({
  data: {
    orderId: "", order: null as MiniOrder | null, mockMode: runtime.mode === "mock", loading: true, busy: false,
    form: blankForm(), files: [] as MiniDesignFile[], cadFiles: [] as MiniDesignFile[], confirmationFiles: [] as MiniDesignFile[], sampleFiles: [] as MiniDesignFile[],
  },
  onLoad(query: { orderId?: string }) {
    if (!requireRole(["DESIGNER"])) return;
    if (!query.orderId) { wx.showToast({ title: "缺少订单编号", icon: "none" }); wx.navigateBack(); return; }
    this.setData({ orderId: query.orderId });
    void this.load();
  },
  async load() {
    try {
      const [order, draft] = await Promise.all([loadRoleOrder(this.data.orderId), loadMiniDesignDraft(this.data.orderId)]);
      const employee = requireRole(["DESIGNER"]);
      if (!order || !employee || order.designerOwnerId !== employee.id || order.stageLabel !== "设计交付") throw new Error("当前设计任务不属于你或已提交");
      const stored = draft.payload ?? {};
      const initial = blankForm();
      const form = Object.fromEntries(Object.entries(initial).map(([key, fallback]) => [key, typeof fallback === "string" ? String(stored[key] ?? fallback) : Array.isArray(stored[key]) ? stored[key] : fallback])) as DesignForm;
      this.setData({ order, form, loading: false });
      this.showFiles(draft.files);
    } catch (error) { this.setData({ loading: false }); wx.showToast({ title: label(error), icon: "none", duration: 3000 }); }
  },
  showFiles(files: MiniDesignFile[]) {
    this.setData({ files, cadFiles: files.filter((file) => file.category === "DESIGN_CAD"), confirmationFiles: files.filter((file) => file.category === "DESIGN_CONFIRMATION"), sampleFiles: files.filter((file) => file.category === "CUSTOMER_SAMPLE_BLOCK") });
  },
  changeField(event: { currentTarget: { dataset: { field: DesignField } }; detail: { value: string } }) {
    this.setData({ form: { ...this.data.form, [event.currentTarget.dataset.field]: event.detail.value } });
  },
  changeDate(event: { currentTarget: { dataset: { field: DesignField } }; detail: { value: string } }) {
    this.setData({ form: { ...this.data.form, [event.currentTarget.dataset.field]: event.detail.value } });
  },
  chooseFile(event: { currentTarget: { dataset: { category: DesignCategory } } }) {
    const category = event.currentTarget.dataset.category;
    wx.chooseMessageFile({ count: 9, type: "file", success: (result) => {
      void this.addFiles(category, result.tempFiles.map((file) => ({ path: file.path, name: file.name, size: file.size })));
    }, fail: () => wx.showToast({ title: "选择文件失败，请从微信会话选择", icon: "none" }) });
  },
  choosePhoto(event: { currentTarget: { dataset: { category: DesignCategory } } }) {
    const category = event.currentTarget.dataset.category;
    wx.chooseMedia({ count: 9, mediaType: ["image"], sourceType: ["camera", "album"], success: (result) => {
      void this.addFiles(category, result.tempFiles.map((file, index) => ({ path: file.tempFilePath, name: `设计照片-${Date.now()}-${index}.${["png", "jpg", "jpeg", "heic"].includes(extension(file.tempFilePath)) ? extension(file.tempFilePath) : "jpg"}`, size: file.size })));
    } });
  },
  async addFiles(category: DesignCategory, picked: Array<{ path: string; name: string; size: number }>) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const files = [...this.data.files];
      for (const item of picked) {
        if (!allowed[category].includes(extension(item.name))) throw new Error(`此栏只支持 ${allowed[category].join("、").toUpperCase()} 文件`);
        if (item.size < 1 || item.size > 40 * 1024 * 1024) throw new Error("单个文件须在40MB以内");
        if (runtime.mode === "mock") {
          files.push(await saveMockDesignFile({ id: `mock-design-${Date.now()}-${Math.random().toString(36).slice(2)}`, category, originalName: item.name, mimeType: mime(item.name), size: item.size, savedFilePath: item.path }));
        } else {
          const uploaded = await uploadMiniAttachment(this.data.orderId, item.path, category, undefined, item.name);
          files.push({ id: uploaded.id, category, originalName: item.name, mimeType: mime(item.name), size: item.size });
        }
      }
      this.updateFiles(files);
      wx.showToast({ title: "文件已添加，请保存草稿", icon: "none" });
    } catch (error) { wx.showToast({ title: label(error), icon: "none", duration: 3000 }); }
    finally { this.setData({ busy: false }); }
  },
  updateFiles(files: MiniDesignFile[]) {
    const form = { ...this.data.form };
    for (const [category, field] of Object.entries(fields) as Array<[DesignCategory, keyof DesignForm]>) (form[field] as string[]) = files.filter((file) => file.category === category).map((file) => file.id);
    this.setData({ form });
    this.showFiles(files);
  },
  removeFile(event: { currentTarget: { dataset: { id: string } } }) { this.updateFiles(this.data.files.filter((file) => file.id !== event.currentTarget.dataset.id)); },
  previewFile(event: { currentTarget: { dataset: { id: string } } }) {
    const file = this.data.files.find((item) => item.id === event.currentTarget.dataset.id);
    if (!file) return;
    if (["dwg", "dxf"].includes(extension(file.originalName))) { wx.showToast({ title: "CAD 原文件已保存，请在电脑端打开", icon: "none" }); return; }
    if (runtime.mode === "mock") {
      if (!file.savedFilePath) return;
      if (file.mimeType.startsWith("image/")) wx.previewImage({ urls: [file.savedFilePath], current: file.savedFilePath });
      else wx.openDocument({ filePath: file.savedFilePath, showMenu: false, fail: () => wx.showToast({ title: "手机无法打开此格式，文件已保存", icon: "none" }) });
      return;
    }
    void previewMiniAttachment(file.id, file.mimeType).catch((error) => wx.showToast({ title: label(error), icon: "none" }));
  },
  async saveDraft() {
    if (!this.data.order || this.data.busy) return;
    this.setData({ busy: true });
    try {
      const order = await saveMiniDesignDraft(this.data.orderId, this.data.form, this.data.files, this.data.order.updatedAt, `mini-design-draft-${this.data.orderId}-${Date.now()}`);
      this.setData({ order });
      wx.showToast({ title: "草稿已保存", icon: "success" });
    } catch (error) { wx.showToast({ title: label(error), icon: "none", duration: 3000 }); }
    finally { this.setData({ busy: false }); }
  },
  submit() {
    const form = this.data.form;
    if (!form.designVersion.trim() || !date(form.surveyedAt) || !date(form.customerConfirmedAt) || !form.cadAttachmentIds.length || !form.confirmationAttachmentIds.length || form.sampleBlockAttachmentIds.length > 0 && !form.sampleBlockRemark.trim()) {
      wx.showToast({ title: "请补齐版本、两个日期、CAD、客户确认图及样块备注", icon: "none", duration: 3000 }); return;
    }
    if (!this.data.order || this.data.busy) return;
    wx.showModal({ title: "确认正式提交设计资料", content: runtime.mode === "mock" ? "仅推进本机演示订单，不会同步到网页版。" : "提交后将生成销售编号并交给订单管理员前置审单。", confirmText: "正式提交", success: (result) => { if (result.confirm) void this.commit(); } });
  },
  async commit() {
    if (!this.data.order) return;
    this.setData({ busy: true });
    try {
      const draftOrder = await saveMiniDesignDraft(this.data.orderId, this.data.form, this.data.files, this.data.order.updatedAt, `mini-design-before-submit-${this.data.orderId}-${Date.now()}`);
      this.setData({ order: draftOrder });
      await runMiniOrderCommand(this.data.orderId, "SUBMIT_DESIGN", this.data.form, draftOrder.updatedAt, `mini-design-submit-${this.data.orderId}-${Date.now()}`);
      wx.showToast({ title: "设计资料已提交", icon: "success" });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (error) { wx.showToast({ title: label(error), icon: "none", duration: 3000 }); }
    finally { this.setData({ busy: false }); }
  },
  back() { wx.navigateBack(); },
});
