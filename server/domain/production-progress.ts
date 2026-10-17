import { BadRequestException } from "@nestjs/common";

import { assignedProcessCodes, WORKSHOP_PROCESS_TEMPLATES, WORKSHOP_LABELS } from "./workshop-processes.js";
export { WORKSHOP_PROCESS_TEMPLATES, WORKSHOP_LABELS } from "./workshop-processes.js";

export const WORKSHOP_DEPENDENCIES: Record<keyof typeof WORKSHOP_PROCESS_TEMPLATES, Array<keyof typeof WORKSHOP_PROCESS_TEMPLATES>> = {
  PANEL: [],
  WOOD: [],
  PAINT: ["WOOD"],
  ASSEMBLY: [],
};

export type ProductionReportAction = "START" | "PROGRESS" | "COMPLETE" | "ISSUE";

type QuantityInput = { plannedQty: number; completedQty: number; action: ProductionReportAction };
export type ProcessQuantity = { workshop: string; plannedQty: number; completedQty: number; status?: string; metricMode?: string };
type ProcessState = { workshop: string; processCode?: string; sequence: number; status: string; metricMode?: string; productionRouteReleasedAt?: Date | string | null };
type ProductionActor = { role: string; level?: string | null; workshop?: string | null; processCode?: string | null; processCodes?: readonly string[] };
type ProcessOwner = { workshop: string; processCode: string };

export function normalizeProductionReport(input: QuantityInput) {
  const plannedQty = Number(input.plannedQty);
  const completedQty = Number(input.completedQty);
  if (!Number.isFinite(plannedQty) || plannedQty <= 0) throw new BadRequestException("计划数量必须大于0");
  if (!Number.isFinite(completedQty) || completedQty < 0) throw new BadRequestException("完成数量不能小于0");
  if (completedQty > plannedQty) throw new BadRequestException("完成数量不能超过计划数量");
  if (input.action === "COMPLETE" && completedQty !== plannedQty) throw new BadRequestException("全部完成时完成数量必须等于计划数量");
  const status = input.action === "ISSUE" ? "ISSUE" : completedQty === plannedQty ? "COMPLETE" : input.action === "START" && completedQty === 0 ? "IN_PROGRESS" : completedQty > 0 ? "IN_PROGRESS" : "PENDING";
  return { plannedQty, completedQty, status };
}

export function calculateProductionProgress(processes: ProcessQuantity[]) {
  const productionProcesses = processes.filter((process) => !["REFERENCE_CONFIRMATION", "PACKAGE_COUNT"].includes(process.metricMode ?? ""));
  const workshops: Record<string, { plannedQty: number; completedQty: number; percent: number; completedSteps: number; totalSteps: number; mixedMetrics: boolean; complete: boolean }> = {};
  for (const process of productionProcesses) {
    const current = workshops[process.workshop] ?? { plannedQty: 0, completedQty: 0, percent: 0, completedSteps: 0, totalSteps: 0, mixedMetrics: false, complete: false };
    current.plannedQty += Number(process.plannedQty);
    current.completedQty += Number(process.completedQty);
    current.totalSteps += 1;
    current.completedSteps += process.status ? Number(process.status === "COMPLETE") : Number(Number(process.completedQty) === Number(process.plannedQty));
    current.mixedMetrics ||= Boolean(process.metricMode && process.metricMode !== "AREA_QUANTITY");
    workshops[process.workshop] = current;
  }
  for (const summary of Object.values(workshops)) {
    summary.percent = summary.mixedMetrics ? Math.round(summary.completedSteps / summary.totalSteps * 100) : summary.plannedQty ? Math.round(summary.completedQty / summary.plannedQty * 100) : 0;
    summary.complete = summary.totalSteps > 0 && summary.completedSteps === summary.totalSteps;
  }
  const plannedQty = Object.values(workshops).reduce((sum, item) => sum + item.plannedQty, 0);
  const completedQty = Object.values(workshops).reduce((sum, item) => sum + item.completedQty, 0);
  const completedSteps = Object.values(workshops).reduce((sum, item) => sum + item.completedSteps, 0);
  const totalSteps = productionProcesses.length;
  return {
    plannedQty,
    completedQty,
    percent: plannedQty ? Math.round(completedQty / plannedQty * 100) : 0,
    complete: productionProcesses.length > 0 && productionProcesses.every((process) => process.status ? process.status === "COMPLETE" : Number(process.completedQty) === Number(process.plannedQty)),
    completedSteps,
    totalSteps,
    workshops,
  };
}

export function productionWorkshopComplete(processes: ProcessQuantity[], workshop: string) {
  return calculateProductionProgress(processes).workshops[workshop]?.complete === true;
}

export function assertProcessAvailable(processes: Array<{ sequence: number; status: string }>, targetSequence: number) {
  if (targetSequence <= 1) return;
  const previous = processes.find((process) => process.sequence === targetSequence - 1);
  if (!previous || previous.status !== "COMPLETE") throw new BadRequestException("前序工序尚未全部完成，当前工序暂不能报工");
}

export function productionProcessAvailability(processes: ProcessState[], target: Pick<ProcessState, "workshop" | "processCode" | "sequence" | "metricMode" | "productionRouteReleasedAt">) {
  if (target.productionRouteReleasedAt === null) return { available: false, reason: "待采购确认本生产路线后开放" };
  if (target.workshop === "ASSEMBLY") {
    const panel = processes.filter((process) => process.workshop === "PANEL");
    const wood = processes.filter((process) => process.workshop === "WOOD");
    const paint = processes.filter((process) => process.workshop === "PAINT");
    const panelComplete = panel.length > 0 && panel.every((process) => process.status === "COMPLETE");
    const woodPaintComplete = wood.length > 0 && paint.length > 0
      && wood.every((process) => process.status === "COMPLETE")
      && paint.every((process) => process.status === "COMPLETE");
    if (!panelComplete && !woodPaintComplete) {
      const routes = [panel.length ? "板式车间" : null, wood.length || paint.length ? "木工与油漆车间" : null].filter(Boolean).join("或");
      return { available: false, reason: `${routes || "区域上游路线"}全部工序完成后开放` };
    }
  }
  const dependencies = WORKSHOP_DEPENDENCIES[target.workshop as keyof typeof WORKSHOP_DEPENDENCIES] ?? [];
  const unfinishedDependencies = dependencies.filter((workshop) => {
    const dependencyProcesses = processes.filter((process) => process.workshop === workshop);
    return dependencyProcesses.length === 0 || dependencyProcesses.some((process) => process.status !== "COMPLETE");
  });
  if (unfinishedDependencies.length) {
    const labels = unfinishedDependencies.map((workshop) => WORKSHOP_LABELS[workshop]).join("和");
    return { available: false, reason: `${labels}全部工序完成后开放` };
  }

  if (target.workshop === "WOOD" && target.processCode) {
    const requiredCodes = target.processCode === "WOOD-02"
      ? ["WOOD-01"]
      : ["WOOD-03", "WOOD-04"].includes(target.processCode)
        ? ["WOOD-02"]
        : target.processCode === "WOOD-05"
          ? ["WOOD-04", ...(processes.some((process) => process.processCode === "WOOD-03") ? ["WOOD-03"] : [])]
          : [];
    const unfinished = requiredCodes.filter((code) => processes.find((process) => process.processCode === code)?.status !== "COMPLETE");
    if (unfinished.length) return { available: false, reason: "实木车间前序工序完成后开放" };
  } else if (target.sequence > 1 && !["REFERENCE_CONFIRMATION", "PACKAGE_COUNT"].includes(target.metricMode ?? "")) {
    const previous = processes
      .filter((process) => process.workshop === target.workshop && process.sequence < target.sequence && !["REFERENCE_CONFIRMATION", "PACKAGE_COUNT"].includes(process.metricMode ?? ""))
      .sort((left, right) => right.sequence - left.sequence)[0];
    if (!previous || previous.status !== "COMPLETE") return { available: false, reason: "本车间前序工序完成后开放" };
  }
  return { available: true, reason: null };
}

export function assertProductionProcessAvailable(processes: ProcessState[], target: Pick<ProcessState, "workshop" | "processCode" | "sequence" | "metricMode" | "productionRouteReleasedAt">) {
  const availability = productionProcessAvailability(processes, target);
  if (!availability.available) throw new BadRequestException(availability.reason ?? "当前工序暂不能报工");
}

export function canReportProductionProcess(employee: ProductionActor, process: ProcessOwner) {
  if (employee.role === "CHAIRMAN") return true;
  if (employee.role !== "WORKSHOP" || employee.workshop !== process.workshop) return false;
  return employee.level === "SUPERVISOR" || (employee.level === "STAFF" && assignedProcessCodes(employee).includes(process.processCode));
}
