import { runtime } from "../../config/runtime";
import { newIdempotencyKey } from "../../domain/projections";
import { requireRole } from "../../domain/roles";
import { createMockSalesOrder, getOrder, getStoredSession, reportMockSalesPayments, type MockReceipt } from "../../domain/store";
import type { MiniOrder } from "../../domain/types";
import { clearMiniSalesDraft, createMiniOrder, loadMiniReferenceData, loadMiniSalesDraft, loadRoleOrder, loadRoleOrders, runMiniOrderCommand, saveMiniSalesDraft, uploadMiniAttachment } from "../../services/mobile";

const businessTypeLabels: Record<string, string> = { NOERLI_FORMAL: "诺尔丽正单", NOERLI_SUPPLEMENT: "诺尔丽补单", AIKEJU_FORMAL: "艾可居正单", AIKEJU_SUPPLEMENT: "艾可居补单", CHANNEL_FORMAL: "渠道正单", CHANNEL_SUPPLEMENT: "渠道补单", ENGINEERING_FORMAL: "工程正单", ENGINEERING_SUPPLEMENT: "工程补单", WORKWEAR_FORMAL: "工装正单", WORKWEAR_SUPPLEMENT: "工装补单" };
const orderTypes = ["诺尔丽正单"];
const siteTypes = ["精装修", "毛坯别墅", "毛坯平层"];
const finishTypes = ["免漆工艺", "油漆工艺"];
const leatherDoorOptions = ["无", "有（生产 +5 天）"];
const designers = ["林工 · 设计部", "周工 · 设计部"];
const scheduleTypes = ["标准工期", "加急订单"];
const paymentAccounts = ["测试批准账户 A", "测试批准账户 B"];
const supplementTypeOptions = ["安装现场问题", "生产责任问题", "设计责任问题", "客户增项", "售后补单"];
const supplementTypeCodes = ["INSTALLATION_ISSUE", "PRODUCTION_ISSUE", "DESIGN_ISSUE", "CUSTOMER_ADDITION", "AFTERSALES"];
const responsibilityOptions = ["客户付费", "公司责任·免收", "设计责任·免收", "生产责任·免收", "待定责"];
const responsibilityCodes = ["CUSTOMER_PAID", "COMPANY_RESPONSIBILITY", "DESIGN_RESPONSIBILITY", "PRODUCTION_RESPONSIBILITY", "PENDING"];

type InputEvent = { currentTarget: { dataset: { field: string } }; detail: { value: string } };
type PickerEvent = { detail: { value: string } };

function fileName(path: string) {
  const chunks = path.split("/");
  return chunks[chunks.length - 1] || "已选择图片";
}

function saveMockReceipt(path: string, label: string, size: number): Promise<MockReceipt> {
  return new Promise((resolve, reject) => wx.saveFile({
    tempFilePath: path,
    success: ({ savedFilePath }) => resolve({ id: newIdempotencyKey("mock-receipt"), originalName: `${label}.${fileName(path).split(".").pop() || "jpg"}`, mimeType: /\.png$/i.test(path) ? "image/png" : /\.heic$/i.test(path) ? "image/heic" : "image/jpeg", size, savedFilePath }),
    fail: () => reject(new Error(`${label}保存失败，请重新选择照片`)),
  }));
}

Page({
  data: {
    mockMode: runtime.mode === "mock", reReport: false, existingOrderId: "",
    orderTypes, orderTypeIndex: 0,
    businessTypeCodes: ["NOERLI_FORMAL"], isSupplement: false,
    parentOrders: [] as MiniOrder[], parentOrderOptions: [] as string[], parentOrderIndex: 0,
    supplementTypeOptions, supplementTypeIndex: 0, responsibilityOptions, responsibilityIndex: 0, supplementReason: "",
    siteTypes, siteIndex: 0, showVillaFloors: false,
    finishTypes, finishTypeIndex: 0,
    leatherDoorOptions, leatherDoorIndex: 0,
    designers, designerOptions: [{ id: "TEST-DESIGNER-01", name: "林工", department: "设计部" }, { id: "TEST-DESIGNER-02", name: "周工", department: "设计部" }], designerIndex: 0,
    scheduleTypes, scheduleIndex: 0, showRushFields: false,
    paymentAccounts, depositAccountIndex: 0, prepaymentAccountIndex: 0,
    customerName: "", customerPhone: "", address: "", contractAmount: "", signedDate: "",
    depositAmount: "", depositReceivedDate: "", depositReceiptPath: "", depositReceiptName: "", depositReceiptSize: 0,
    prepaymentAmount: "", prepaymentReceivedDate: "", prepaymentReceiptPath: "", prepaymentReceiptName: "", prepaymentReceiptSize: 0,
    promisedDate: "", villaFloors: "", rushReason: "", rushPromisedDate: "", submitting: false
  },
  async onLoad(query?: { orderId?: string }) {
    if (!requireRole(["SALES"])) return;
    this.setData({ mockMode: runtime.mode === "mock" });
    try {
      const existingOrder = runtime.mode === "mock" && query?.orderId ? getOrder(query.orderId) : undefined;
      if (query?.orderId && (!existingOrder || existingOrder.salesOwnerId !== getStoredSession()?.id || existingOrder.businessType?.endsWith("_SUPPLEMENT"))) throw new Error("只能补报本人正单的首付款");
      const [reference, serverDraft, visibleOrders] = await Promise.all([loadMiniReferenceData(), loadMiniSalesDraft(), loadRoleOrders()]);
      const businessTypeCodes = reference.businessTypes.filter((item) => item.endsWith("_FORMAL") || item.endsWith("_SUPPLEMENT"));
      const localDraft = wx.getStorageSync<Record<string, unknown>>("tai-mini-sales-draft");
      const parentOrders = visibleOrders.filter((item) => item.businessType?.endsWith("_FORMAL"));
      const restored = existingOrder ? {} : { ...(serverDraft ?? {}), ...(localDraft && typeof localDraft === "object" ? localDraft : {}) };
      const orderTypeIndex = Math.max(0, Math.min(Number(restored.orderTypeIndex ?? 0), businessTypeCodes.length - 1));
      this.setData({
        ...restored,
        businessTypeCodes: businessTypeCodes.length ? businessTypeCodes : this.data.businessTypeCodes,
        orderTypes: businessTypeCodes.length ? businessTypeCodes.map((item) => businessTypeLabels[item] ?? item) : this.data.orderTypes,
        orderTypeIndex, isSupplement: businessTypeCodes[orderTypeIndex]?.endsWith("_SUPPLEMENT") ?? false,
        parentOrders, parentOrderOptions: parentOrders.map((item) => `${item.salesNumber ?? item.trackingSerial} · ${item.customerName}`),
        designerOptions: reference.designers, designers: reference.designers.map((item) => `${item.name} · ${item.department}`),
        paymentAccounts: reference.paymentAccounts, submitting: false,
        ...(existingOrder ? { reReport: true, existingOrderId: existingOrder.id, customerName: existingOrder.customerName,
          customerPhone: existingOrder.customerPhone ?? "", address: existingOrder.address ?? "", promisedDate: existingOrder.dueLabel,
          orderTypeIndex: Math.max(0, businessTypeCodes.indexOf(existingOrder.businessType ?? "")),
          designerIndex: Math.max(0, reference.designers.findIndex((item) => item.id === existingOrder.designerOwnerId)) } : {}),
      });
    } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "建单选项加载失败", icon: "none" }); }
  },
  changeField(event: InputEvent) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }); },
  changeOrderType(event: PickerEvent) {
    const orderTypeIndex = Number(event.detail.value);
    const isSupplement = this.data.businessTypeCodes[orderTypeIndex]?.endsWith("_SUPPLEMENT") ?? false;
    this.setData({ orderTypeIndex, isSupplement, parentOrderIndex: 0 });
    if (isSupplement) void this.selectParent(0);
  },
  changeParent(event: PickerEvent) { void this.selectParent(Number(event.detail.value)); },
  async selectParent(parentOrderIndex: number) {
    const summary = this.data.parentOrders[parentOrderIndex];
    if (!summary) return;
    try {
      const parent = await loadRoleOrder(summary.id);
      if (!parent) return;
      const designerIndex = this.data.designerOptions.findIndex((item: { id: string }) => item.id === parent.designerOwnerId);
      this.setData({ parentOrderIndex, customerName: parent.customerName, customerPhone: parent.customerPhone ?? "", address: parent.address ?? "", ...(designerIndex >= 0 ? { designerIndex } : {}) });
    } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "正单加载失败", icon: "none" }); }
  },
  changeSupplementType(event: PickerEvent) { this.setData({ supplementTypeIndex: Number(event.detail.value) }); },
  changeResponsibility(event: PickerEvent) { this.setData({ responsibilityIndex: Number(event.detail.value) }); },
  changeSite(event: PickerEvent) {
    const siteIndex = Number(event.detail.value);
    this.setData({ siteIndex, showVillaFloors: siteIndex === 1, ...(siteIndex === 1 ? {} : { villaFloors: "" }) });
  },
  changeFinishType(event: PickerEvent) { this.setData({ finishTypeIndex: Number(event.detail.value) }); },
  changeLeatherDoor(event: PickerEvent) { this.setData({ leatherDoorIndex: Number(event.detail.value) }); },
  changeDesigner(event: PickerEvent) { this.setData({ designerIndex: Number(event.detail.value) }); },
  changeSchedule(event: PickerEvent) {
    const scheduleIndex = Number(event.detail.value);
    this.setData({ scheduleIndex, showRushFields: scheduleIndex === 1, ...(scheduleIndex === 1 ? {} : { rushReason: "", rushPromisedDate: "" }) });
  },
  changeDepositAccount(event: PickerEvent) { this.setData({ depositAccountIndex: Number(event.detail.value) }); },
  changePrepaymentAccount(event: PickerEvent) { this.setData({ prepaymentAccountIndex: Number(event.detail.value) }); },
  changeSignedDate(event: PickerEvent) { this.setData({ signedDate: event.detail.value }); },
  changeDepositDate(event: PickerEvent) { this.setData({ depositReceivedDate: event.detail.value }); },
  changePrepaymentDate(event: PickerEvent) { this.setData({ prepaymentReceivedDate: event.detail.value }); },
  changePromisedDate(event: PickerEvent) { this.setData({ promisedDate: event.detail.value }); },
  changeRushDate(event: PickerEvent) { this.setData({ rushPromisedDate: event.detail.value }); },
  chooseDepositReceipt() {
    wx.chooseMedia({ count: 1, mediaType: ["image"], sourceType: ["camera", "album"], success: (result) => {
      const path = result.tempFiles[0]?.tempFilePath ?? "";
      this.setData({ depositReceiptPath: path, depositReceiptName: fileName(path), depositReceiptSize: result.tempFiles[0]?.size ?? 0 });
    } });
  },
  choosePrepaymentReceipt() {
    wx.chooseMedia({ count: 1, mediaType: ["image"], sourceType: ["camera", "album"], success: (result) => {
      const path = result.tempFiles[0]?.tempFilePath ?? "";
      this.setData({ prepaymentReceiptPath: path, prepaymentReceiptName: fileName(path), prepaymentReceiptSize: result.tempFiles[0]?.size ?? 0 });
    } });
  },
  draftPayload() {
    const { submitting, ...draft } = this.data;
    return { ...draft, savedAt: new Date().toISOString() };
  },
  async saveDraft() {
    const draft = this.draftPayload();
    wx.setStorageSync("tai-mini-sales-draft", draft);
    const { depositReceiptPath: _depositReceiptPath, prepaymentReceiptPath: _prepaymentReceiptPath, ...serverSafeDraft } = draft;
    try { await saveMiniSalesDraft(serverSafeDraft); wx.showToast({ title: runtime.mode === "mock" ? "草稿已保存在本机" : "草稿已同步", icon: "success" }); }
    catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "草稿同步失败", icon: "none" }); }
  },
  validationError() {
    if (this.data.reReport) {
      const required = [[this.data.contractAmount, "请填写合同金额"], [this.data.depositAmount, "请填写定金金额"], [this.data.depositReceivedDate, "请选择定金到账日期"], [this.data.depositReceiptPath, "请选择定金凭证"],
        [this.data.prepaymentAmount, "请填写预付款金额"], [this.data.prepaymentReceivedDate, "请选择预付款到账日期"], [this.data.prepaymentReceiptPath, "请选择预付款凭证"]];
      for (const [value, message] of required) if (!String(value).trim()) return message;
      if (!(Number(this.data.contractAmount) > 0) || !(Number(this.data.depositAmount) > 0) || !(Number(this.data.prepaymentAmount) > 0) || Number(this.data.depositAmount) + Number(this.data.prepaymentAmount) > Number(this.data.contractAmount)) return "首付款金额不符合合同金额";
      return "";
    }
    const requiredText = [
      ...(this.data.isSupplement ? [] : [[this.data.customerName, "请填写客户姓名"], [this.data.customerPhone, "请填写客户电话"], [this.data.address, "请填写项目地址"]]),
      [this.data.contractAmount, "请填写合同金额"],
      [this.data.signedDate, "请选择签约日期"], [this.data.promisedDate, "请选择客户约定交期"],
      ...(this.data.isSupplement ? [[this.data.supplementReason, "请填写补单原因"]] : [
        [this.data.depositAmount, "请填写定金金额"], [this.data.depositReceivedDate, "请选择定金到账日期"], [this.data.depositReceiptPath, "请选择定金凭证"],
        [this.data.prepaymentAmount, "请填写预付款金额"], [this.data.prepaymentReceivedDate, "请选择预付款到账日期"], [this.data.prepaymentReceiptPath, "请选择预付款凭证"]]),
    ];
    for (const [value, message] of requiredText) if (!String(value).trim()) return message;
    const contract = Number(this.data.contractAmount);
    const deposit = Number(this.data.depositAmount);
    const prepayment = Number(this.data.prepaymentAmount);
    if (this.data.isSupplement && !this.data.parentOrders[this.data.parentOrderIndex]) return "请选择关联正单";
    if (this.data.isSupplement ? contract < 0 : !(contract > 0)) return this.data.isSupplement ? "补单金额不能小于 0" : "合同金额必须大于 0";
    if (!this.data.isSupplement && (!(deposit > 0) || !(prepayment > 0))) return "请填写有效的首付款金额";
    if (!this.data.isSupplement && deposit + prepayment > contract) return "首付款合计不能超过合同金额";
    if (this.data.showVillaFloors && Number(this.data.villaFloors) < 1) return "毛坯别墅至少填写 1 层";
    if (this.data.showRushFields && !this.data.rushReason.trim()) return "请填写加急原因";
    if (this.data.showRushFields && !this.data.rushPromisedDate) return "请选择客户承诺日期";
    return "";
  },
  async submit() {
    const error = this.validationError();
    if (error) { wx.showToast({ title: error, icon: "none", duration: 2400 }); return; }
    const idempotencyKey = newIdempotencyKey("sales-create");
    this.setData({ submitting: true });
    if (runtime.mode === "api") {
      try {
        const designer = this.data.designerOptions[this.data.designerIndex];
        if (!designer || !this.data.paymentAccounts.length) throw new Error("设计师或收款账户尚未就绪");
        let order = await createMiniOrder({
          businessType: this.data.businessTypeCodes[this.data.orderTypeIndex], siteType: this.data.siteIndex === 0 ? "FINISHED" : "ROUGH",
          customerName: this.data.customerName.trim(), customerPhone: this.data.customerPhone.trim(), address: this.data.address.trim(), amount: Number(this.data.contractAmount),
          signedAt: this.data.signedDate, promisedAt: this.data.promisedDate, designerId: designer.id,
          finishType: this.data.finishTypeIndex === 0 ? "MELAMINE" : "PAINT", leatherDoor: this.data.leatherDoorIndex === 1,
          villaFloors: this.data.siteIndex === 1 ? Number(this.data.villaFloors) : 0, rush: this.data.scheduleIndex === 1,
          rushReason: this.data.scheduleIndex === 1 ? this.data.rushReason.trim() : undefined, rushPromisedAt: this.data.scheduleIndex === 1 ? this.data.rushPromisedDate : undefined,
          ...(this.data.isSupplement ? { parentOrderId: this.data.parentOrders[this.data.parentOrderIndex].id, supplementType: supplementTypeCodes[this.data.supplementTypeIndex], responsibilityType: responsibilityCodes[this.data.responsibilityIndex], supplementReason: this.data.supplementReason.trim() } : {}),
        }, idempotencyKey);
        if (!this.data.isSupplement) {
          const depositAttachment = await uploadMiniAttachment(order.id, this.data.depositReceiptPath, "DEPOSIT_RECEIPT");
          order = await runMiniOrderCommand(order.id, "REPORT_DEPOSIT", { receivedAmount: Number(this.data.depositAmount), receivedAt: this.data.depositReceivedDate, account: this.data.paymentAccounts[this.data.depositAccountIndex], receiptAttachmentIds: [depositAttachment.id] }, order.updatedAt, newIdempotencyKey("deposit"));
          const prepaymentAttachment = await uploadMiniAttachment(order.id, this.data.prepaymentReceiptPath, "PREPAYMENT_RECEIPT");
          order = await runMiniOrderCommand(order.id, "REPORT_PREPAYMENT", { receivedAmount: Number(this.data.prepaymentAmount), receivedAt: this.data.prepaymentReceivedDate, account: this.data.paymentAccounts[this.data.prepaymentAccountIndex], receiptAttachmentIds: [prepaymentAttachment.id] }, order.updatedAt, newIdempotencyKey("prepayment"));
        }
        await clearMiniSalesDraft();
        wx.showModal({ title: "签约订单已提交", content: `跟单流水号：${order.trackingSerial}\n${this.data.isSupplement ? "关联补单已创建，后续按业务事实报备定金。" : "定金和预付款已报备，正在等待财务核验。"}`, showCancel: false, success: () => wx.redirectTo({ url: `/pages/order-detail/index?id=${order.id}` }) });
      } catch (error) {
        wx.showToast({ title: error instanceof Error ? error.message : "订单提交失败", icon: "none", duration: 3000 });
      } finally { this.setData({ submitting: false }); }
      return;
    }
    try {
      const employee = getStoredSession();
      if (!employee) throw new Error("请先选择销售测试账号");
      const initialPayments = this.data.isSupplement ? undefined : {
        contractAmount: Number(this.data.contractAmount),
        deposit: { amount: Number(this.data.depositAmount), receivedAt: this.data.depositReceivedDate, account: this.data.paymentAccounts[this.data.depositAccountIndex],
          receipt: await saveMockReceipt(this.data.depositReceiptPath, "定金付款凭证", this.data.depositReceiptSize) },
        prepayment: { amount: Number(this.data.prepaymentAmount), receivedAt: this.data.prepaymentReceivedDate, account: this.data.paymentAccounts[this.data.prepaymentAccountIndex],
          receipt: await saveMockReceipt(this.data.prepaymentReceiptPath, "预付款凭证", this.data.prepaymentReceiptSize) },
      };
      const order = this.data.reReport ? reportMockSalesPayments(this.data.existingOrderId, initialPayments!) : createMockSalesOrder({ businessType: this.data.businessTypeCodes[this.data.orderTypeIndex], parentOrderId: this.data.isSupplement ? this.data.parentOrders[this.data.parentOrderIndex]?.id : undefined,
        customerName: this.data.customerName.trim(), customerPhone: this.data.customerPhone.trim(), address: this.data.address.trim(), promisedDate: this.data.promisedDate,
        siteType: this.data.siteIndex === 0 ? "FINISHED" : "ROUGH", finishType: this.data.finishTypeIndex === 0 ? "MELAMINE" : "PAINT", villaFloors: this.data.siteIndex === 1 ? Number(this.data.villaFloors) : 0,
        designerId: this.data.designerOptions[this.data.designerIndex]?.id ?? "", rush: this.data.scheduleIndex === 1, initialPayments });
      await clearMiniSalesDraft();
      wx.showModal({ title: this.data.reReport ? "首付款已补报" : "本机演示订单已保存", content: `跟单流水号：${order.trackingSerial}\n${initialPayments ? "待财务核验定金与预付款。" : "补单已创建。"}仅保存在本机，不会出现在网页版。`, confirmText: "查看订单", showCancel: false,
        success: () => wx.redirectTo({ url: `/pages/order-detail/index?id=${order.id}` }) });
    } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "模拟建单失败", icon: "none" }); }
    finally { this.setData({ submitting: false }); }
  },
  back() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: "/pages/workspace/index" });
  }
});
