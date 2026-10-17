import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const modal = readFileSync(new URL("../src/WorkflowActionModal.tsx", import.meta.url), "utf8");
const ordersService = readFileSync(new URL("../server/orders.service.ts", import.meta.url), "utf8");
const localAccounts = readFileSync(new URL("../src/LocalTestAccounts.tsx", import.meta.url), "utf8");
const seed = readFileSync(new URL("../server/prisma/seed.ts", import.meta.url), "utf8");

test("常规订单保留设计退回入口，非常规订单同时由界面和服务端拦截", () => {
  assert.match(app, /RETURN_DESIGN[^\n]+退回销售/);
  assert.match(app, /if \(command === "RETURN_DESIGN"\) return order\.creationMode === "SALES_STANDARD"/);
  assert.match(ordersService, /command === "RETURN_DESIGN" && isInternalException\(current\)/);
  assert.match(app, /ASSIGN_DESIGNER[^\n]+重新分配设计师/);
  assert.match(app, /TRANSFER_DESIGN[^\n]+转给其他设计师/);
  assert.match(app, /最晚设计下单/);
});

test("本地验收提供第二位设计师用于重新分配和转交", () => {
  assert.match(localAccounts, /designer2[^\n]+设计师林若溪（交接测试）/);
  assert.match(seed, /LOCAL_DESIGNERS/);
  assert.doesNotMatch(seed, /update:\s*\{\s*\.\.\.employee,\s*passwordHash\s*\}/);
});

test("CAD栏支持Excel且样块附件要求共用备注", () => {
  assert.match(modal, /DESIGN_CAD[^\n]+\.xls,\.xlsx/);
  assert.match(modal, /sampleBlockRemark/);
  assert.match(modal, /上传客户样块时必须填写样块备注/);
});
