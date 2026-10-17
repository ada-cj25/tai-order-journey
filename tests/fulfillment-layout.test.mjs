import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("发货执行在所有桌面宽度保持图二的上下单栏布局", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.erp-fulfillment-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.doesNotMatch(css, /\.erp-fulfillment-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2/s);
});

test("定制产品发货门禁标签与下方批次表保持清晰间距", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.erp-gate-row\s*\{[^}]*margin-bottom:\s*16px/s);
});

test("车间产品与外购产品共用一个发货登记入口", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const modal = await readFile(new URL("../src/WorkflowActionModal.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(app, /setWorkflowAction\(\{ command: "RECORD_OUTSOURCE_DELIVERY"/);
  assert.match(app, /RECORD_DELIVERY[^\n]*登记发货/);
  const deliveryForm = modal.slice(modal.indexOf('case "RECORD_DELIVERY"'), modal.indexOf('case "COMPLETE_INSTALLATION_BATCH"'));
  assert.match(deliveryForm, /name="outsourceLineIds"/);
  assert.match(deliveryForm, /本车次外购产品/);
  assert.doesNotMatch(deliveryForm, /case "RECORD_OUTSOURCE_DELIVERY"/);
});

test("路线发货可分批并由订单管理员确认本路线末批", async () => {
  const modal = await readFile(new URL("../src/WorkflowActionModal.tsx", import.meta.url), "utf8");
  const deliveryForm = modal.slice(modal.indexOf('case "RECORD_DELIVERY"'), modal.indexOf('case "COMPLETE_INSTALLATION_BATCH"'));
  assert.match(deliveryForm, /本路线本次为最后一批/);
  assert.match(deliveryForm, /productionRouteFinalFlags/);
  assert.doesNotMatch(deliveryForm, /区域末批由系统判定/);
});

test("订单级安装申请退出当前流程，自产发货收集本车次安装安排", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const modal = await readFile(new URL("../src/WorkflowActionModal.tsx", import.meta.url), "utf8");
  const commands = app.slice(app.indexOf("const COMMANDS"), app.indexOf("function availableActions"));
  assert.doesNotMatch(commands, /SUBMIT_INSTALLATION_APPLICATION/);
  assert.doesNotMatch(modal, /case "SUBMIT_INSTALLATION_APPLICATION"/);
  const deliveryForm = modal.slice(modal.indexOf('case "RECORD_DELIVERY"'), modal.indexOf('case "COMPLETE_INSTALLATION_BATCH"'));
  for (const field of ["installationDepartment", "contact", "plannedAt", "supplyChecks"]) assert.match(deliveryForm, new RegExp(`name="${field}"`));
  assert.match(deliveryForm, /发货后将自动生成对应的安装部待办/);
});

test("外购声明编辑器直接展示操作控件，不显示大块说明提示", async () => {
  const source = await readFile(new URL("../src/OutsourceRequirementEditor.tsx", import.meta.url), "utf8");
  const activeEditor = source.slice(source.lastIndexOf('return <Card title="订单级外购成品清单" className="erp-panel">'));
  assert.doesNotMatch(activeEditor, /外购不属于任何生产区域/);
  assert.match(activeEditor, /本订单无外购成品/);
  assert.match(activeEditor, /快速添加：/);
});

test("外购声明卡不展示内部草稿版本标签", async () => {
  const source = await readFile(new URL("../src/OutsourceRequirementEditor.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /草稿 V|draft\.version/);
});

test("四车间生产计划面积使用平方米，组装后续统计不伪装为面积", async () => {
  const modal = await readFile(new URL("../src/WorkflowActionModal.tsx", import.meta.url), "utf8");
  const technicalPlan = modal.slice(modal.indexOf('case "SUBMIT_TECHNICAL"'), modal.indexOf('case "RECORD_DELIVERY"'));
  assert.equal((technicalPlan.match(/addonAfter="㎡"/g) ?? []).length, 9);
  assert.doesNotMatch(technicalPlan, /addonAfter="件"/);

  const production = await readFile(new URL("../server/production.service.ts", import.meta.url), "utf8");
  const publishing = await readFile(new URL("../server/material-cost.service.ts", import.meta.url), "utf8");
  assert.match(production, /unit: assemblyMode \? "项" : "㎡"/);
  assert.match(publishing, /unit: assemblyMode \? "项" : "㎡"/);
});

test("采购订单首列在跟单号旁显示客户姓名", async () => {
  const source = await readFile(new URL("../src/ProcurementWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /`\$\{row\.trackingSerial\} · \$\{row\.customerName\}`/);
  assert.match(source, /`待生成销售编号 · \$\{row\.customerName\}`/);
});

test("批量确认采购时列出本次开放的具体生产区域", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const workspace = await readFile(new URL("../src/ProcurementWorkspace.tsx", import.meta.url), "utf8");
  assert.match(app, /affectedAreas\.map\(\(candidate\) => <li key=\{candidate\.id\}>\{candidate\.name\} · \{candidate\.productionNumber\}<\/li>\)/);
  assert.match(workspace, /pendingAreas\.map\(\(candidate: Row\) => <li key=\{candidate\.id\}>\{candidate\.name\} · \{candidate\.productionNumber\}<\/li>\)/);
});
