import test from "node:test";
import assert from "node:assert/strict";
import { validateAccount } from "../account-policy.js";
import { canReportProductionProcess, productionProcessAvailability } from "./production-progress.js";
import { LOCAL_WORKERS } from "./local-worker-roster.js";
import { workshopProcessOptions, WORKSHOP_PROCESS_TEMPLATES } from "./workshop-processes.js";

test("12 distinct workers cover all 23 exact processes once with the confirmed staffing", () => {
  assert.equal(new Set(LOCAL_WORKERS.map((worker) => worker.username)).size, 12);
  assert.equal(new Set(LOCAL_WORKERS.map((worker) => worker.employeeNo)).size, 12);
  assert.deepEqual(Object.keys(WORKSHOP_PROCESS_TEMPLATES).map((workshop) => LOCAL_WORKERS.filter((worker) => worker.workshop === workshop).length), [5, 3, 3, 1]);
  const assignments = Object.fromEntries(LOCAL_WORKERS.map((worker) => [worker.username, worker.processCodes]));
  assert.deepEqual(assignments, {
    panelcut: ["PANEL-01"], paneledge: ["PANEL-02"], paneldrill: ["PANEL-03"], panelclean: ["PANEL-04"], panelquality: ["PANEL-05", "PANEL-06"],
    woodcut: ["WOOD-01"], woodveneer: ["WOOD-03"], woodmake: ["WOOD-02", "WOOD-04", "WOOD-05"],
    paintsand: ["PAINT-01", "PAINT-03", "PAINT-05"], paintspray: ["PAINT-02", "PAINT-04", "PAINT-06"], paintquality: ["PAINT-07", "PAINT-08"],
    assemblyworker: ["ASSEMBLY-01", "ASSEMBLY-02", "ASSEMBLY-03", "ASSEMBLY-04"],
  });
  for (const workshop of Object.keys(WORKSHOP_PROCESS_TEMPLATES)) for (const process of workshopProcessOptions(workshop)) {
    assert.equal(LOCAL_WORKERS.filter((worker) => canReportProductionProcess(worker, { workshop, processCode: process.value })).length, 1, process.value);
  }
});

test("multi-process account validation rejects empty, repeated, malformed and cross-workshop assignments", () => {
  const worker = LOCAL_WORKERS.find((item) => item.username === "woodmake")!;
  assert.deepEqual(validateAccount(worker).processCodes, ["WOOD-02", "WOOD-04", "WOOD-05"]);
  for (const codes of [[], ["WOOD-02", "WOOD-02"], ["WOOD-02", "PANEL-02"], ["WOOD-06"], ["制作1"], [null], "WOOD-02", null]) {
    assert.throws(() => validateAccount({ ...worker, processCodes: codes }));
  }
  assert.deepEqual(validateAccount({ ...worker, level: "SUPERVISOR" }).processCodes, []);
  assert.deepEqual(validateAccount({ ...worker, role: "FINANCE" }).processCodes, []);
  assert.deepEqual(validateAccount({ ...worker, processCodes: undefined, processCode: "WOOD-02" }).processCodes, ["WOOD-02"]);
});

test("explicit assignments override the legacy field and do not grant another workshop or all-process authority", () => {
  const worker = LOCAL_WORKERS.find((item) => item.username === "woodmake")!;
  assert.equal(canReportProductionProcess(worker, { workshop: "WOOD", processCode: "WOOD-04" }), true);
  assert.equal(canReportProductionProcess(worker, { workshop: "WOOD", processCode: "WOOD-03" }), false);
  assert.equal(canReportProductionProcess({ ...worker, processCodes: ["PANEL-01"] }, { workshop: "PANEL", processCode: "PANEL-01" }), false);
  assert.equal(canReportProductionProcess({ ...worker, processCodes: [] }, { workshop: "WOOD", processCode: "WOOD-02" }), false);
  assert.equal(canReportProductionProcess({ ...worker, role: "SALES" }, { workshop: "WOOD", processCode: "WOOD-02" }), false);
});

test("a worker owning later processes cannot skip the intervening worker's step", () => {
  const worker = LOCAL_WORKERS.find((item) => item.username === "woodmake")!;
  const processes = WORKSHOP_PROCESS_TEMPLATES.WOOD.map((_, index) => ({ workshop: "WOOD", sequence: index + 1, status: index < 2 ? "COMPLETE" : "PENDING" }));
  assert.equal(canReportProductionProcess(worker, { workshop: "WOOD", processCode: "WOOD-04" }), true);
  assert.equal(productionProcessAvailability(processes, processes[3]).available, false);
  processes[2].status = "COMPLETE";
  assert.equal(productionProcessAvailability(processes, processes[3]).available, true);
  assert.equal(productionProcessAvailability(processes, processes[4]).available, false);
  processes[3].status = "COMPLETE";
  assert.equal(productionProcessAvailability(processes, processes[4]).available, true);
});
