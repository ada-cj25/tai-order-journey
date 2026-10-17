import type { MiniOrder, MiniProductionArea, MiniTask, MiniTaskGroup, TaskUrgency, WorkshopTaskState } from "./types";

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function orderProgressPercent(order: MiniOrder): number {
  return clampPercent((order.stageIndex / order.stageTotal) * 100);
}

export function taskProgressPercent(task: MiniTask): number {
  if (!task.plannedQty || task.completedQty == null) return task.status === "DONE" ? 100 : 0;
  return clampPercent((task.completedQty / task.plannedQty) * 100);
}

export function areaProgressPercent(area: Pick<MiniProductionArea, "workshopFlows">): number {
  const processes = area.workshopFlows.flatMap((flow) => flow.processes).filter((process) => process.progressIncluded);
  if (!processes.length) return 0;
  const total = processes.reduce((sum, process) => {
    if (process.plannedQty && process.completedQty != null) return sum + clampPercent((process.completedQty / process.plannedQty) * 100);
    return sum + (process.status === "DONE" ? 100 : 0);
  }, 0);
  return clampPercent(total / processes.length);
}

export function summarizeProductionAreas(areas: MiniProductionArea[]) {
  const completed = areas.filter((area) => area.complete).length;
  const inProgress = areas.filter((area) => !area.complete && area.percent > 0).length;
  const waiting = Math.max(0, areas.length - completed - inProgress);
  return {
    total: areas.length,
    completed,
    inProgress,
    waiting,
    percent: areas.length ? clampPercent(areas.reduce((sum, area) => sum + area.percent, 0) / areas.length) : 0
  };
}

export function visibleNextTasks(tasks: MiniTask[], currentId: string): MiniTask[] {
  const currentIndex = tasks.findIndex((task) => task.id === currentId);
  if (currentIndex < 0) return [];
  return tasks.slice(currentIndex + 1, currentIndex + 3);
}

const urgencyRank: Record<TaskUrgency, number> = { OVERDUE: 0, RUSH: 1, DUE_SOON: 2, NORMAL: 3 };

export function sortWorkshopTasks(tasks: MiniTask[]): MiniTask[] {
  return [...tasks].sort((left, right) => {
    const urgency = urgencyRank[left.urgency] - urgencyRank[right.urgency];
    if (urgency) return urgency;
    const deadline = new Date(left.dueAt ?? 0).getTime() - new Date(right.dueAt ?? 0).getTime();
    if (deadline) return deadline;
    return `${left.salesNumber ?? ""}-${left.productionNumber}-${left.processCode ?? ""}`.localeCompare(`${right.salesNumber ?? ""}-${right.productionNumber}-${right.processCode ?? ""}`);
  });
}

function searchMatches(task: MiniTask, keyword: string) {
  if (!keyword) return true;
  return [task.customerName, task.salesNumber ?? "", task.productionNumber, task.productionAreaName, task.title]
    .some((value) => value.toLocaleLowerCase().includes(keyword));
}

function matchesFilter(task: MiniTask, filter: "ALL" | WorkshopTaskState) {
  if (filter === "ALL") return true;
  return task.state === filter;
}

function filterTasks(tasks: MiniTask[], filter: "ALL" | WorkshopTaskState, keyword: string) {
  return sortWorkshopTasks(tasks.filter((task) => matchesFilter(task, filter) && searchMatches(task, keyword)));
}

export function selectWorkshopTasks(tasks: MiniTask[], filter: "ALL" | WorkshopTaskState, query = ""): MiniTask[] {
  return filterTasks(tasks, filter, query.trim().toLocaleLowerCase());
}

export function groupWorkshopTasks(tasks: MiniTask[]): MiniTaskGroup[] {
  const groups = new Map<string, MiniTaskGroup>();
  for (const task of tasks) {
    const key = task.orderId;
    const current = groups.get(key) ?? {
      key,
      orderId: task.orderId,
      customerName: task.customerName,
      salesNumber: task.salesNumber ?? "未生成销售编号",
      tasks: [],
    };
    current.tasks.push(task);
    groups.set(key, current);
  }
  return [...groups.values()];
}

export function newIdempotencyKey(prefix = "mini"): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${random}`;
}
