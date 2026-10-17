import { WORKSHOP_LABELS, type Workshop } from "./workshop-processes.js";

// Local sample identities, not production employees. Staffing confirmed 2026-08-31.
const roster: Array<[string, string, string, Workshop, number[]]> = [
  ["W101", "panelcut", "板式开料工", "PANEL", [1]],
  ["W102", "paneledge", "板式封边工", "PANEL", [2]],
  ["W103", "paneldrill", "板式打孔工", "PANEL", [3]],
  ["W104", "panelclean", "板式清洗修边工", "PANEL", [4]],
  ["W105", "panelquality", "板式品检转运工", "PANEL", [5, 6]],
  ["W201", "woodcut", "木工开料工", "WOOD", [1]],
  ["W202", "woodveneer", "木工贴皮工", "WOOD", [3]],
  ["W203", "woodmake", "木工制作转运工", "WOOD", [2, 4, 5]],
  ["W301", "paintsand", "油漆打磨工", "PAINT", [1, 3, 5]],
  ["W302", "paintspray", "油漆喷漆工", "PAINT", [2, 4, 6]],
  ["W303", "paintquality", "油漆品检转运工", "PAINT", [7, 8]],
  ["W401", "assemblyworker", "组装综合工", "ASSEMBLY", [1, 2, 3, 4]],
];

export const LOCAL_WORKERS = roster.map(([employeeNo, username, name, workshop, sequences]) => {
  const processCodes = sequences.map((sequence) => `${workshop}-${String(sequence).padStart(2, "0")}`);
  return { employeeNo, username, name, department: WORKSHOP_LABELS[workshop], role: "WORKSHOP" as const, level: "STAFF", workshop, processCode: processCodes[0], processCodes };
});
