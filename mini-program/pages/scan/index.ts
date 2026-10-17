import type { MiniTask } from "../../domain/types";
import { resolveProductionNumber } from "../../services/workbench";
import { requireRole } from "../../domain/roles";

const MOCK_PRODUCTION_NUMBER = "TEST-DEMO-AREA-01";
const MOCK_QR = `tai://production/${MOCK_PRODUCTION_NUMBER}`;

Page({
  data: { result: "", scanning: false },
  onLoad() { requireRole(["WORKSHOP"]); },
  startScan() {
    this.setData({ scanning: true });
    wx.scanCode({
      onlyFromCamera: true,
      success: (result) => this.resolveCode(result.result),
      fail: () => {
        this.setData({ scanning: false });
        wx.showModal({ title: "使用本地模拟二维码？", content: "体验周女士订单 · 儿童房 · TEST-DEMO-AREA-01 的打孔报工。", confirmText: "继续体验", success: (choice) => { if (choice.confirm) this.resolveCode(MOCK_QR); } });
      },
    });
  },
  async resolveCode(value: string) {
    this.setData({ result: value, scanning: false });
    const prefix = "tai://production/";
    const productionNumber = value.startsWith(prefix) ? decodeURIComponent(value.slice(prefix.length)).trim() : "";
    if (!productionNumber) { wx.showToast({ title: "这不是有效的生产区域二维码", icon: "none" }); return; }
    try {
      const resolution = await resolveProductionNumber(productionNumber);
      if (resolution.status === "DIRECT") { this.openTask(resolution.task); return; }
      if (resolution.status === "MULTIPLE") {
        wx.showActionSheet({
          itemList: resolution.tasks.map((task) => `${task.routeLabel} · ${task.title}`),
          success: (choice) => {
            const task = resolution.tasks[choice.tapIndex];
            if (task) this.openTask(task);
          },
        });
        return;
      }
      if (resolution.status === "WAITING") {
        const task = resolution.tasks[0];
        wx.showModal({
          title: "当前工序尚未开放",
          content: task ? `${task.customerName} · ${task.productionAreaName}\n${task.productionNumber}\n${resolution.message}` : resolution.message,
          showCancel: false,
        });
        return;
      }
      wx.showModal({ title: "不能报工", content: resolution.message, showCancel: false });
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "扫码结果查询失败", icon: "none", duration: 2800 });
    }
  },
  openTask(task: MiniTask) { wx.navigateTo({ url: `/pages/report/index?taskId=${task.id}` }); },
});
