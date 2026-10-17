import { runtime } from "../../config/runtime";
import { getMockPaymentState, getStoredSession, mockTailPaymentReady, reportMockTailPayment, type MockReceipt } from "../../domain/store";
import { newIdempotencyKey } from "../../domain/projections";
import { requireRole } from "../../domain/roles";
import type { MiniOrder } from "../../domain/types";
import { loadMiniReferenceData, loadRoleOrder, runMiniOrderCommand, uploadMiniAttachment } from "../../services/mobile";

const fileName = (path: string) => path.split("/").pop() || "尾款凭证";

Page({
  data: {
    orderId: "", order: undefined as MiniOrder | undefined, mockMode: runtime.mode === "mock", expectedAmount: null as number | null,
    accounts: [] as string[], accountIndex: 0, amount: "", receivedAt: "", receiptPath: "", receiptName: "", receiptSize: 0,
    submitting: false,
  },
  async onLoad(query: { orderId?: string }) {
    if (!requireRole(["SALES"])) return;
    const orderId = query.orderId ?? "";
    if (!orderId) { wx.showToast({ title: "缺少订单编号", icon: "none" }); return; }
    try {
      const [order, reference] = await Promise.all([loadRoleOrder(orderId), loadMiniReferenceData()]);
      const employee = getStoredSession();
      if (!order || employee?.id !== order.salesOwnerId) throw new Error("只有所属销售可以报备这张订单的尾款");
      const payment = runtime.mode === "mock" ? getMockPaymentState(orderId) : null;
      if (runtime.mode === "mock" && (!payment || !mockTailPaymentReady(order) || payment.tail)) throw new Error("这张订单当前没有待报备尾款");
      const expectedAmount = payment ? payment.contractAmount - payment.deposit.amount - payment.prepayment.amount : null;
      this.setData({ orderId, order, expectedAmount, amount: expectedAmount === null ? "" : String(expectedAmount), accounts: reference.paymentAccounts });
    } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "尾款资料加载失败", icon: "none", duration: 2800 }); }
  },
  changeAmount(event: { detail: { value: string } }) { this.setData({ amount: event.detail.value }); },
  changeDate(event: { detail: { value: string } }) { this.setData({ receivedAt: event.detail.value }); },
  changeAccount(event: { detail: { value: string } }) { this.setData({ accountIndex: Number(event.detail.value) }); },
  chooseReceipt() {
    wx.chooseMedia({ count: 1, mediaType: ["image"], sourceType: ["camera", "album"], success: (result) => {
      const file = result.tempFiles[0];
      if (file?.tempFilePath) this.setData({ receiptPath: file.tempFilePath, receiptName: fileName(file.tempFilePath), receiptSize: file.size ?? 0 });
    } });
  },
  validate() {
    if (!this.data.order) return "订单尚未加载";
    if (!(Number(this.data.amount) > 0)) return "请填写本次到账金额";
    if (this.data.expectedAmount !== null && Number(this.data.amount) !== this.data.expectedAmount) return "尾款金额与应收尾款不一致";
    if (!this.data.receivedAt) return "请选择实际到账日期";
    if (!this.data.accounts[this.data.accountIndex]) return "请选择已批准的收款账户";
    if (!this.data.receiptPath) return "请上传尾款收款凭证";
    return "";
  },
  submit() {
    const error = this.validate();
    if (error) { wx.showToast({ title: error, icon: "none" }); return; }
    wx.showModal({ title: "确认报备尾款", content: "这一步是销售收款报备。发货须等财务核验实际到账后才能解锁。", confirmText: "确认报备", success: async (result) => {
      if (!result.confirm || !this.data.order || this.data.submitting) return;
      this.setData({ submitting: true });
      try {
        const order = this.data.order;
        const account = this.data.accounts[this.data.accountIndex]!;
        if (runtime.mode === "mock") {
          const receipt = await new Promise<MockReceipt>((resolve, reject) => wx.saveFile({
            tempFilePath: this.data.receiptPath,
            success: ({ savedFilePath }) => resolve({ id: newIdempotencyKey("mock-tail-receipt"), originalName: this.data.receiptName, mimeType: /\.png$/i.test(this.data.receiptName) ? "image/png" : /\.heic$/i.test(this.data.receiptName) ? "image/heic" : "image/jpeg", size: this.data.receiptSize, savedFilePath }),
            fail: () => reject(new Error("尾款凭证保存失败，请重新选择")),
          }));
          reportMockTailPayment(order.id, { amount: Number(this.data.amount), receivedAt: this.data.receivedAt, account, receipt });
        } else {
          const receipt = await uploadMiniAttachment(order.id, this.data.receiptPath, "TAIL_PAYMENT_RECEIPT", undefined, this.data.receiptName);
          await runMiniOrderCommand(order.id, "REPORT_TAIL_PAYMENT", {
            receivedAmount: Number(this.data.amount), receivedAt: this.data.receivedAt, account, receiptAttachmentIds: [receipt.id],
          }, order.updatedAt, newIdempotencyKey("tail-payment"));
        }
        wx.showToast({ title: "已提交财务核验", icon: "success" });
        wx.redirectTo({ url: `/pages/order-detail/index?id=${encodeURIComponent(order.id)}` });
      } catch (failure) { wx.showToast({ title: failure instanceof Error ? failure.message : "尾款报备失败", icon: "none", duration: 2800 }); }
      finally { this.setData({ submitting: false }); }
    } });
  },
  back() { if (getCurrentPages().length > 1) wx.navigateBack(); else wx.reLaunch({ url: "/pages/workspace/index" }); },
});
