// Pure definitions shared by account configuration and production permissions.
export const WORKSHOP_PROCESS_TEMPLATES = {
  PANEL: ["开料", "封边", "打孔", "清洗修边", "品检", "送组装车间"],
  WOOD: ["开料", "制作1", "贴皮", "制作2", "送油漆车间"],
  PAINT: ["白坯打磨", "喷底漆", "一次油磨", "喷底漆", "二次油磨", "喷面漆", "品检", "送组装车间"],
  ASSEMBLY: ["打包", "领五金", "入库", "订单生产完成"],
} as const;

export type Workshop = keyof typeof WORKSHOP_PROCESS_TEMPLATES;
export const WORKSHOP_LABELS: Record<Workshop, string> = {
  PANEL: "板式车间", WOOD: "木工（实木）车间", PAINT: "油漆车间", ASSEMBLY: "组装车间",
};

export function workshopProcessOptions(workshop?: string | null) {
  const steps = WORKSHOP_PROCESS_TEMPLATES[workshop as Workshop];
  return steps?.map((name, index) => ({
    value: `${workshop}-${String(index + 1).padStart(2, "0")}`,
    label: `${index + 1}. ${name}`,
  })) ?? [];
}

export function assignedProcessCodes(employee: { processCodes?: readonly string[]; processCode?: string | null }) {
  // An explicit empty list grants no rights, even if the legacy field still exists.
  return employee.processCodes ?? (employee.processCode ? [employee.processCode] : []);
}
