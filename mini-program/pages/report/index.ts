import { newIdempotencyKey, taskProgressPercent } from "../../domain/projections";
import type { MiniTask, ProductionReportDraft } from "../../domain/types";
import { loadWorkshopTask, reportWorkshopTask } from "../../services/workbench";
import { requireRole } from "../../domain/roles";

const draftKey = (taskId: string) => `tai-mini-report-draft:${taskId}`;
const attemptKey = (taskId: string, action: ProductionReportDraft["action"]) => `tai-mini-report-attempt:${taskId}:${action}`;
const isCheckInTask = (task: MiniTask) => task.processCode === "ASSEMBLY-04" || task.workshopLabel === "组装车间" && task.title === "订单生产完成";

Page({
  data: {
    taskId: "",
    task: undefined as MiniTask | undefined,
    isCheckIn: false,
    quantity: "",
    progress: 0,
    submitting: false,
    loading: true,
  },
  onLoad(query: { taskId?: string }) {
    if (!requireRole(["WORKSHOP"])) return;
    const taskId = query.taskId ?? "";
    this.setData({ taskId });
    this.loadTask();
  },
  async loadTask() {
    try {
      const task = await loadWorkshopTask(this.data.taskId);
      if (!task) throw new Error("该工序已完成、已锁定或不属于当前账号");
      const isCheckIn = isCheckInTask(task);
      const localQuantity = isCheckIn ? "" : wx.getStorageSync<string>(draftKey(task.id));
      const quantity = localQuantity && Number(localQuantity) > Number(task.completedQty) && Number(localQuantity) < Number(task.plannedQty) ? localQuantity : "";
      this.setData({ task, isCheckIn, quantity, progress: taskProgressPercent(task), loading: false });
    } catch (error) {
      this.setData({ loading: false });
      wx.showModal({ title: "无法打开报工", content: error instanceof Error ? error.message : "工序加载失败", showCancel: false, success: () => wx.navigateBack() });
    }
  },
  changeQuantity(event: { detail: { value: string } }) {
    this.setData({ quantity: event.detail.value });
    wx.setStorageSync(draftKey(this.data.taskId), event.detail.value);
    wx.setStorageSync(attemptKey(this.data.taskId, "PROGRESS"), "");
  },
  startWork() { return this.submitAction("START"); },
  openIssue() {
    if (this.data.task) wx.navigateTo({ url: `/pages/issue/index?taskId=${this.data.task.id}` });
  },
  submitProgress() {
    const task = this.data.task;
    if (!task) return;
    if (this.data.isCheckIn) return;
    const quantity = Number(this.data.quantity);
    if (!this.data.quantity.trim() || !Number.isFinite(quantity) || quantity <= Number(task.completedQty) || quantity >= Number(task.plannedQty)) {
      wx.showToast({ title: `部分完成请填大于 ${task.completedQty} 且小于 ${task.plannedQty} 的累计面积`, icon: "none", duration: 2600 });
      return;
    }
    return this.submitAction("PROGRESS", quantity);
  },
  confirmComplete() {
    const task = this.data.task;
    if (!task) return;
    wx.showModal({
      title: this.data.isCheckIn ? "确认完成打卡" : "确认全部完成",
      content: this.data.isCheckIn
        ? `${task.customerName} · ${task.productionAreaName} · ${task.title}\n确认当前路线生产已完成？提交后这项待办会移除。`
        : `${task.customerName} · ${task.productionAreaName} · ${task.title}\n将累计完成量记为 ${task.plannedQty}${task.unit}，提交后本工序会从待办移除。`,
      confirmText: "确认完成",
      cancelText: "取消",
      success: (result) => { if (result.confirm) this.submitAction("COMPLETE"); },
      fail: () => wx.showToast({ title: "确认框打开失败，请重试", icon: "none" }),
    });
  },
  async submitAction(action: ProductionReportDraft["action"], completedQty?: number) {
    const task = this.data.task;
    if (!task?.processId || this.data.submitting) return;
    if (this.data.isCheckIn && action !== "COMPLETE") return;
    this.setData({ submitting: true });
    const keyName = attemptKey(task.id, action);
    const existingKey = wx.getStorageSync<string>(keyName);
    const idempotencyKey = existingKey || newIdempotencyKey("production");
    if (!existingKey) wx.setStorageSync(keyName, idempotencyKey);
    const draft: ProductionReportDraft = {
      orderId: task.orderId,
      processId: task.processId,
      action,
      completedQty,
      idempotencyKey,
      expectedUpdatedAt: task.orderUpdatedAt,
    };
    try {
      await reportWorkshopTask(task, draft);
      wx.setStorageSync(draftKey(task.id), "");
      wx.setStorageSync(keyName, "");
      wx.showToast({ title: action === "START" ? "已开始加工" : action === "COMPLETE" ? "工序已完成" : "累计进度已记录", icon: "success" });
      if (action === "COMPLETE") setTimeout(() => wx.navigateBack(), 500);
      else await this.loadTask();
    } catch (error) {
      const message = error instanceof Error ? error.message : "提交失败";
      wx.showToast({ title: message, icon: "none", duration: 2800 });
      if (/状态已变化|版本|冲突/.test(message)) await this.loadTask();
    } finally {
      this.setData({ submitting: false });
    }
  },
  back() { wx.navigateBack(); },
});
