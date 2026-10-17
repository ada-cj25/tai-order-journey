import { getStoredSession } from "../../domain/store";
import { requireRole } from "../../domain/roles";
import type { MiniWorkspace, MiniWorkspaceTask } from "../../domain/types";
import {
  completeMiniProcurementRoute,
  finalizeMiniHardwarePackages,
  listMiniPaymentAccounts,
  loadMiniProcurementForm,
  requestMiniPaymentAccount,
  reviewMiniPaymentAccount,
  type MiniPaymentAccount,
  type MiniProcurementForm,
} from "../../services/mobile";
import { loadRoleWorkspace } from "../../services/workspace";

const sectionLabels = {
  risk: ["风险与审批", "查看全局风险并处理关键审批"],
  finance: ["收款工作区", "核验到账事实与申请收款账户"],
  design: ["设计任务", "手机接单、退回或转交；设计文件仍在电脑端提交"],
  technical: ["技术拆单", "查看区域与期限摘要，海迅及物料表在电脑端办理"],
  procurement: ["采购确认", "确认路线放行与区域五金包最终数量"],
} as const;

type Section = keyof typeof sectionLabels;

Page({
  data: {
    employee: getStoredSession(), section: "risk" as Section, title: "岗位工作区", subtitle: "", workbench: null as MiniWorkspace | null,
    tasks: [] as MiniWorkspaceTask[], accounts: [] as MiniPaymentAccount[], procurement: null as MiniProcurementForm | null, hardwareTotal: 0, hardwarePending: 0,
    accountName: "", reviewComment: "", overrideReason: "", loading: true, busy: false, activeOrderId: "",
  },
  onLoad(query: { section?: string; orderId?: string }) {
    const employee = requireRole(["CHAIRMAN", "FINANCE", "DESIGNER", "TECHNICAL", "PROCUREMENT"]);
    if (!employee) return;
    const fallback: Section = employee.role === "FINANCE" ? "finance" : employee.role === "DESIGNER" ? "design" : employee.role === "TECHNICAL" ? "technical" : employee.role === "PROCUREMENT" ? "procurement" : "risk";
    const section = query.section && query.section in sectionLabels ? query.section as Section : fallback;
    const labels = sectionLabels[section];
    this.setData({ employee, section, title: labels[0], subtitle: labels[1], activeOrderId: query.orderId ?? "" });
  },
  onShow() { if (this.data.employee) this.loadData(); },
  onPullDownRefresh() { this.loadData().finally(() => wx.stopPullDownRefresh()); },
  async loadData() {
    this.setData({ loading: true });
    try {
      const workbench = await loadRoleWorkspace();
      const employee = this.data.employee;
      const [accounts, procurement] = await Promise.all([
        employee && ["FINANCE", "CHAIRMAN"].includes(employee.role) ? listMiniPaymentAccounts() : Promise.resolve([]),
        this.data.activeOrderId && employee && ["PROCUREMENT", "CHAIRMAN"].includes(employee.role) ? loadMiniProcurementForm(this.data.activeOrderId) : Promise.resolve(null),
      ]);
      this.setData({ workbench, tasks: workbench.tasks, accounts, procurement, hardwareTotal: procurement?.hardwareAreas.reduce((sum, area) => sum + Number(area.total), 0) ?? 0, hardwarePending: procurement?.hardwareAreas.filter((area) => !area.finalized).length ?? 0, loading: false });
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: error instanceof Error ? error.message : "工作区加载失败", icon: "none" });
    }
  },
  openTask(event: { currentTarget: { dataset: { route?: string; desktop?: boolean; identifier?: string; module?: string; reason?: string } } }) {
    const data = event.currentTarget.dataset;
    if (data.desktop) {
      wx.showModal({ title: "请在电脑端办理", content: `${data.reason || "该任务包含大文件或复杂表格"}\n\n电脑端位置：${data.module || "订单详情"}\n业务编号：${data.identifier || "请查看任务卡"}`, confirmText: data.identifier ? "复制编号" : "知道了", showCancel: Boolean(data.identifier), success: (result) => { if (result.confirm && data.identifier) wx.setClipboardData({ data: data.identifier }); } });
      return;
    }
    if (data.route) wx.navigateTo({ url: data.route });
  },
  changeAccountName(event: { detail: { value: string } }) { this.setData({ accountName: event.detail.value }); },
  changeReviewComment(event: { detail: { value: string } }) { this.setData({ reviewComment: event.detail.value }); },
  changeOverrideReason(event: { detail: { value: string } }) { this.setData({ overrideReason: event.detail.value }); },
  changeHardwareTotal(event: { currentTarget: { dataset: { index: number } }; detail: { value: string } }) {
    const index = Number(event.currentTarget.dataset.index);
    if (this.data.procurement?.hardwareAreas[index]?.finalized) return;
    this.setData({ [`procurement.hardwareAreas[${index}].total`]: Math.max(0, Number(event.detail.value) || 0) });
    const areas = this.data.procurement?.hardwareAreas ?? [];
    this.setData({ hardwareTotal: areas.reduce((sum, area) => sum + Number(area.total), 0) });
  },
  async requestAccount() {
    const name = this.data.accountName.trim();
    if (!name) { wx.showToast({ title: "请填写账户名称", icon: "none" }); return; }
    this.setData({ busy: true });
    try { await requestMiniPaymentAccount(name); this.setData({ accountName: "" }); await this.loadData(); wx.showToast({ title: "已提交审批", icon: "success" }); }
    catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "提交失败", icon: "none" }); }
    finally { this.setData({ busy: false }); }
  },
  reviewAccount(event: { currentTarget: { dataset: { id: string; decision: "APPROVE" | "REJECT" } } }) {
    const { id, decision } = event.currentTarget.dataset;
    if (decision === "REJECT" && this.data.reviewComment.trim().length < 2) { wx.showToast({ title: "驳回时请填写审批意见", icon: "none" }); return; }
    wx.showModal({ title: decision === "APPROVE" ? "通过账户申请" : "驳回账户申请", content: decision === "APPROVE" ? "通过后财务可在后续收款报备中选择此账户。" : "申请将被驳回，审批意见会通知财务。", confirmText: "确认", success: async (result) => {
      if (!result.confirm) return;
      try { await reviewMiniPaymentAccount(id, decision, this.data.reviewComment); this.setData({ reviewComment: "" }); await this.loadData(); wx.showToast({ title: "审批已记录", icon: "success" }); }
      catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "审批失败", icon: "none" }); }
    } });
  },
  confirmRoute(event: { currentTarget: { dataset: { kind: "PANEL" | "WOOD_PAINT" } } }) {
    const employee = this.data.employee;
    const kind = event.currentTarget.dataset.kind;
    if (!this.data.procurement || !employee) return;
    if (employee.role === "CHAIRMAN" && this.data.overrideReason.trim().length < 5) { wx.showToast({ title: "请填写至少5个字的覆盖原因", icon: "none" }); return; }
    wx.showModal({ title: "确认采购路线完成", content: "提交后将释放该路线进入生产，服务端会记录确认人和时间。", confirmText: "确认放行", success: async (result) => {
      if (!result.confirm || !this.data.procurement) return;
      this.setData({ busy: true });
      try { this.setData({ procurement: await completeMiniProcurementRoute(this.data.procurement.order.id, kind, this.data.procurement.order.updatedAt, this.data.overrideReason), overrideReason: "" }); wx.showToast({ title: "路线已放行", icon: "success" }); }
      catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "确认失败", icon: "none" }); }
      finally { this.setData({ busy: false }); }
    } });
  },
  finalizeHardware() {
    const form = this.data.procurement;
    if (!form || this.data.employee?.role !== "PROCUREMENT") return;
    wx.showModal({ title: "确认所有区域五金包", content: "将按当前显示数量一次性确认所有有效生产区域，确认后需在网页端说明原因才能重新打开。", confirmText: "确认数量", success: async (result) => {
      if (!result.confirm || !this.data.procurement) return;
      this.setData({ busy: true });
      try {
        const areas = this.data.procurement.hardwareAreas.map((area) => ({ productionAreaId: area.id, total: Number(area.total) }));
        const procurement = await finalizeMiniHardwarePackages(this.data.procurement.order.id, areas, this.data.procurement.order.updatedAt);
        this.setData({ procurement, hardwareTotal: procurement.hardwareAreas.reduce((sum, area) => sum + Number(area.total), 0), hardwarePending: procurement.hardwareAreas.filter((area) => !area.finalized).length });
        wx.showToast({ title: "五金包已确认", icon: "success" });
      } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : "确认失败", icon: "none" }); }
      finally { this.setData({ busy: false }); }
    } });
  },
  back() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: "/pages/workspace/index" });
  },
});
