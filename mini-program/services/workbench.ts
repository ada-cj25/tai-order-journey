import { runtime } from "../config/runtime";
import { getMockWorkshopWorkbench, getTask, resolveMockProductionNumber, submitProductionReport } from "../domain/store";
import type { MiniTask, ProductionReportDraft, ProductionScanResolution, TaskUrgency, WorkshopWorkbench } from "../domain/types";
import { miniRequest, miniUpload } from "./client";

const urgencyLabels: Record<TaskUrgency, string> = {
  OVERDUE: "已逾期",
  RUSH: "加急",
  DUE_SOON: "24小时内到期",
  NORMAL: "按计划",
};

function dueLabel(value?: string) {
  if (!value) return "车间最晚完成 · 待排期";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "车间最晚完成 · 待排期";
  return `车间最晚完成 · ${String(date.getMonth() + 1).padStart(2, "0")}月${String(date.getDate()).padStart(2, "0")}日`;
}

function normalizeTask(task: MiniTask): MiniTask {
  return {
    ...task,
    dueAt: task.dueAt ? String(task.dueAt) : undefined,
    dueLabel: task.dueLabel || dueLabel(task.dueAt),
    urgencyLabel: task.urgencyLabel || urgencyLabels[task.urgency],
    updatedAt: String(task.updatedAt),
    orderUpdatedAt: String(task.orderUpdatedAt),
  };
}

function normalizeWorkbench(value: WorkshopWorkbench): WorkshopWorkbench {
  return {
    ...value,
    actionable: value.actionable.map(normalizeTask),
    allUnfinished: value.allUnfinished.map(normalizeTask),
    completedToday: value.completedToday.map(normalizeTask),
    serverTime: String(value.serverTime),
    updatedAt: String(value.updatedAt),
  };
}

export async function loadWorkshopWorkbench(): Promise<WorkshopWorkbench> {
  if (runtime.mode === "mock") return getMockWorkshopWorkbench();
  return normalizeWorkbench(await miniRequest<WorkshopWorkbench>("/api/v1/mini/workshop/workbench"));
}

export async function loadWorkshopTask(taskId: string): Promise<MiniTask | undefined> {
  if (runtime.mode === "mock") return getTask(taskId);
  const workbench = await loadWorkshopWorkbench();
  return [...workbench.allUnfinished, ...workbench.completedToday].find((task) => task.id === taskId || task.processId === taskId);
}

export async function reportWorkshopTask(task: MiniTask, draft: ProductionReportDraft): Promise<void> {
  if (runtime.mode === "mock") {
    submitProductionReport(draft);
    return;
  }
  await miniRequest(`/api/v1/mini/orders/${task.orderId}/production/report`, {
    method: "POST",
    body: {
      processId: draft.processId,
      action: draft.action,
      completedQty: draft.completedQty,
      note: draft.note,
      attachmentIds: draft.attachmentIds,
    },
    idempotencyKey: draft.idempotencyKey,
    expectedUpdatedAt: draft.expectedUpdatedAt,
  });
}

export async function uploadProductionIssuePhotos(task: MiniTask, paths: string[]): Promise<string[]> {
  if (runtime.mode === "mock") return paths;
  const uploads = paths.map((path) => miniUpload<{ id: string }>(`/api/v1/mini/attachments/${task.orderId}`, path, {
    category: "PRODUCTION_ISSUE",
    productionAreaId: task.productionAreaId,
  }));
  return (await Promise.all(uploads)).map((attachment) => attachment.id);
}

export async function resolveProductionNumber(productionNumber: string): Promise<ProductionScanResolution> {
  if (runtime.mode === "mock") return resolveMockProductionNumber(productionNumber);
  const result = await miniRequest<ProductionScanResolution>(`/api/v1/mini/workshop/production-areas/${encodeURIComponent(productionNumber)}/assignment`);
  const tasks = result.tasks.map(normalizeTask);
  if (result.status === "DIRECT") return { ...result, task: normalizeTask(result.task), tasks };
  return { ...result, tasks };
}

export function syncLabel(iso: string) {
  const elapsed = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return "刚刚更新";
  if (elapsed < 60 * 60_000) return `${Math.max(1, Math.floor(elapsed / 60_000))}分钟前更新`;
  return "已更新，建议下拉获取最新状态";
}
