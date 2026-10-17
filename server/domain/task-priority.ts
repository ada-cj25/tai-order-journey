export type PrioritizableTask = {
  dueAt: Date | null;
  status: string;
  order: { rush: boolean } | null;
};

export type TaskUrgency = "OVERDUE" | "RUSH" | "DUE_SOON" | "NORMAL";

export function taskUrgency(task: PrioritizableTask, now = new Date()): TaskUrgency {
  if (task.status === "OVERDUE" || (task.dueAt && task.dueAt < now)) return "OVERDUE";
  if (task.order?.rush) return "RUSH";
  if (task.dueAt && task.dueAt.getTime() - now.getTime() <= 24 * 60 * 60 * 1000) return "DUE_SOON";
  return "NORMAL";
}

export function sortTasksByUrgency<T extends PrioritizableTask>(tasks: T[], now = new Date()): T[] {
  const rank: Record<TaskUrgency, number> = { OVERDUE: 0, RUSH: 1, DUE_SOON: 2, NORMAL: 3 };
  return [...tasks].sort((left, right) => {
    const priority = rank[taskUrgency(left, now)] - rank[taskUrgency(right, now)];
    return priority || (left.dueAt?.getTime() ?? Number.POSITIVE_INFINITY) - (right.dueAt?.getTime() ?? Number.POSITIVE_INFINITY);
  });
}
