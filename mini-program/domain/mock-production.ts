import { areaProgressPercent } from "./projections";
import type { MiniProductionArea, MiniProductionProcess, MiniWorkshopFlow } from "./types";

type Route = "PANEL" | "WOOD_PAINT";
type Workshop = "PANEL" | "WOOD" | "PAINT" | "ASSEMBLY";

export function mockRouteComplete(area: MiniProductionArea, kind: Route): boolean {
  const keys = kind === "PANEL" ? ["PANEL", "ASSEMBLY_PANEL"] : ["WOOD", "PAINT", "ASSEMBLY_WOOD_PAINT"];
  const flows = area.workshopFlows.filter((flow) => keys.includes(flow.key));
  const included = flows.flatMap((flow) => flow.processes).filter((process) => process.progressIncluded);
  return flows.length > 0 && included.length > 0 && included.every((process) => process.status === "DONE");
}

const processNames: Record<Workshop, string[]> = {
  PANEL: ["开料", "封边", "打孔", "清洗修边", "品检", "送组装车间"],
  WOOD: ["开料", "制作1", "贴皮", "制作2", "送油漆车间"],
  PAINT: ["白坯打磨", "喷底漆", "一次油磨", "喷底漆", "二次油磨", "喷面漆", "品检", "送组装车间"],
  ASSEMBLY: ["打包", "领五金", "入库", "订单生产完成"],
};
const workshopLabels: Record<Workshop, string> = {
  PANEL: "板式车间", WOOD: "木工车间", PAINT: "油漆车间", ASSEMBLY: "组装车间",
};
const workerNumbers: Record<Workshop, string[]> = {
  PANEL: ["W101", "W102", "W103", "W104", "W105", "W105"],
  WOOD: ["W201", "W203", "W202", "W203", "W203"],
  PAINT: ["W301", "W302", "W301", "W302", "W301", "W302", "W303", "W303"],
  ASSEMBLY: ["W401", "W401", "W401", "W401"],
};

function flow(areaId: string, workshop: Workshop, route: Route, plannedQty: number): MiniWorkshopFlow {
  const key = workshop === "ASSEMBLY" ? `ASSEMBLY_${route}` : workshop;
  return {
    key,
    label: workshopLabels[workshop],
    processes: processNames[workshop].map((title, index): MiniProductionProcess => {
      const status = "LOCKED" as const;
      const milestone = workshop === "ASSEMBLY" && index >= 1;
      return {
        id: `${areaId}-${route}-${workshop}-${String(index + 1).padStart(2, "0")}`,
        processCode: `${workshop}-${String(index + 1).padStart(2, "0")}`,
        title, workshopLabel: workshopLabels[workshop], sequence: index + 1,
        plannedQty: milestone ? 1 : plannedQty, completedQty: 0, unit: milestone ? "次" : "㎡",
        dueLabel: "车间最晚完成", status, statusLabel: "等待前序",
        progressIncluded: !(workshop === "ASSEMBLY" && (index === 1 || index === 2)), canReport: false,
        assignedEmployeeId: workerNumbers[workshop][index] === "W103" ? "TEST-WORKER-PANEL-03" : `TEST-${workerNumbers[workshop][index]}`,
      };
    }),
  };
}

export function createMockCaseAreas(orderId: string, dueLabel: string, productionNumbers: string[]): MiniProductionArea[] {
  const cases: Array<{ name: string; panel?: number; wood?: number; paint?: number }> = [
    { name: "厨房", wood: 66, paint: 50 },
    { name: "阳台", panel: 24 },
    { name: "主卧", panel: 36, wood: 40, paint: 40 },
  ];
  return cases.map((item, index) => {
    const id = `${orderId}-area-${index + 1}`;
    const workshopFlows = [
      ...(item.panel ? [flow(id, "PANEL", "PANEL", item.panel), flow(id, "ASSEMBLY", "PANEL", item.panel)] : []),
      ...(item.wood && item.paint ? [flow(id, "WOOD", "WOOD_PAINT", item.wood), flow(id, "PAINT", "WOOD_PAINT", item.paint), flow(id, "ASSEMBLY", "WOOD_PAINT", item.paint)] : []),
    ];
    const area: MiniProductionArea = {
      id, name: item.name, productionNumber: productionNumbers[index]!,
      routeLabel: [item.panel ? "板式路线" : "", item.wood ? "实木油漆路线" : ""].filter(Boolean).join("＋"),
      statusLabel: "待放行", dueLabel, percent: 0, complete: false, workshopFlows,
    };
    area.percent = areaProgressPercent(area);
    return area;
  });
}

export function releaseMockRoute(areas: MiniProductionArea[], route: Route): void {
  for (const area of areas) {
    const first = area.workshopFlows.find((item) => item.key === (route === "PANEL" ? "PANEL" : "WOOD"))?.processes[0];
    if (first?.status === "LOCKED") { first.status = "READY"; first.statusLabel = "可报工"; }
    if (first) area.statusLabel = "待生产";
  }
}

export function unlockMockNextFlow(area: MiniProductionArea, completedFlow: MiniWorkshopFlow): void {
  const nextByFlow: Record<string, string> = {
    PANEL: "ASSEMBLY_PANEL", WOOD: "PAINT", PAINT: "ASSEMBLY_WOOD_PAINT",
  };
  const target = nextByFlow[completedFlow.key];
  if (!target) return;
  const first = area.workshopFlows.find((item) => item.key === target)?.processes[0];
  if (first?.status === "LOCKED") { first.status = "READY"; first.statusLabel = "可报工"; }
}
