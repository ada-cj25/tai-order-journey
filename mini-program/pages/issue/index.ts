import { newIdempotencyKey } from "../../domain/projections";
import type { MiniTask } from "../../domain/types";
import { loadWorkshopTask, reportWorkshopTask, uploadProductionIssuePhotos } from "../../services/workbench";
import { requireRole } from "../../domain/roles";

const noteKey = (taskId: string) => `tai-mini-issue-note:${taskId}`;
const photoKey = (taskId: string) => `tai-mini-issue-photos:${taskId}`;
const uploadedKey = (taskId: string) => `tai-mini-issue-uploaded:${taskId}`;
const attemptKey = (taskId: string) => `tai-mini-issue-attempt:${taskId}`;

Page({
  data: { taskId: "", task: undefined as MiniTask | undefined, note: "", attachments: [] as string[], submitting: false, loading: true },
  onLoad(query: { taskId?: string }) {
    if (!requireRole(["WORKSHOP"])) return;
    const taskId = query.taskId ?? "";
    this.setData({ taskId, note: wx.getStorageSync<string>(noteKey(taskId)) || "", attachments: wx.getStorageSync<string[]>(photoKey(taskId)) || [] });
    this.loadTask();
  },
  async loadTask() {
    try {
      const task = await loadWorkshopTask(this.data.taskId);
      if (!task) throw new Error("该工序已完成、已锁定或不属于当前账号");
      this.setData({ task, loading: false });
    } catch (error) {
      this.setData({ loading: false });
      wx.showModal({ title: "无法报告异常", content: error instanceof Error ? error.message : "工序加载失败", showCancel: false, success: () => wx.navigateBack() });
    }
  },
  changeNote(event: { detail: { value: string } }) {
    this.setData({ note: event.detail.value });
    wx.setStorageSync(noteKey(this.data.taskId), event.detail.value);
    wx.setStorageSync(attemptKey(this.data.taskId), "");
  },
  choosePhoto() {
    wx.chooseMedia({
      count: Math.max(0, 3 - this.data.attachments.length),
      mediaType: ["image"],
      sourceType: ["camera", "album"],
      success: (result) => {
        const attachments = [...this.data.attachments, ...result.tempFiles.map((file) => file.tempFilePath)].slice(0, 3);
        this.setData({ attachments });
        wx.setStorageSync(photoKey(this.data.taskId), attachments);
        wx.setStorageSync(uploadedKey(this.data.taskId), []);
        wx.setStorageSync(attemptKey(this.data.taskId), "");
      },
    });
  },
  removePhoto(event: { currentTarget: { dataset: { index: number } } }) {
    const attachments = this.data.attachments.filter((_path, index) => index !== Number(event.currentTarget.dataset.index));
    this.setData({ attachments });
    wx.setStorageSync(photoKey(this.data.taskId), attachments);
    wx.setStorageSync(uploadedKey(this.data.taskId), []);
    wx.setStorageSync(attemptKey(this.data.taskId), "");
  },
  async submit() {
    const task = this.data.task;
    if (!task?.processId || this.data.submitting) return;
    if (!this.data.note.trim()) { wx.showToast({ title: "请填写问题说明", icon: "none" }); return; }
    this.setData({ submitting: true });
    try {
      let attachmentIds = wx.getStorageSync<string[]>(uploadedKey(task.id)) || [];
      if (attachmentIds.length !== this.data.attachments.length) {
        attachmentIds = await uploadProductionIssuePhotos(task, this.data.attachments);
        wx.setStorageSync(uploadedKey(task.id), attachmentIds);
      }
      const existingKey = wx.getStorageSync<string>(attemptKey(task.id));
      const idempotencyKey = existingKey || newIdempotencyKey("issue");
      if (!existingKey) wx.setStorageSync(attemptKey(task.id), idempotencyKey);
      await reportWorkshopTask(task, {
        orderId: task.orderId,
        processId: task.processId,
        action: "ISSUE",
        note: this.data.note.trim(),
        attachmentPaths: this.data.attachments,
        attachmentIds,
        idempotencyKey,
        expectedUpdatedAt: task.orderUpdatedAt,
      });
      wx.setStorageSync(noteKey(task.id), "");
      wx.setStorageSync(photoKey(task.id), []);
      wx.setStorageSync(uploadedKey(task.id), []);
      wx.setStorageSync(attemptKey(task.id), "");
      wx.showToast({ title: "异常已记录", icon: "success" });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (error) {
      const message = error instanceof Error ? error.message : "提交失败，内容已保留";
      wx.showToast({ title: message, icon: "none", duration: 2800 });
      if (/状态已变化|版本|冲突/.test(message)) await this.loadTask();
    } finally {
      this.setData({ submitting: false });
    }
  },
  back() { wx.navigateBack(); },
});
