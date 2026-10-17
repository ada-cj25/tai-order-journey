import test from "node:test";
import assert from "node:assert/strict";
import { miniProgramDevLoginEnabled, miniProgramEnabled, tokenHash } from "./mini-auth.service.js";
import { isMiniProgramRole, miniCapabilities, miniEmployeeView } from "./domain/mini-program-access.js";

test("小程序服务端开关必须显式开启", () => {
  assert.equal(miniProgramEnabled({ NODE_ENV: "development" } as NodeJS.ProcessEnv), false);
  assert.equal(miniProgramEnabled({ NODE_ENV: "production", MINI_PROGRAM_ENABLED: "false" } as NodeJS.ProcessEnv), false);
  assert.equal(miniProgramEnabled({ NODE_ENV: "development", MINI_PROGRAM_ENABLED: "true" } as NodeJS.ProcessEnv), true);
  assert.equal(miniProgramEnabled({ NODE_ENV: "production", MINI_PROGRAM_ENABLED: "true" } as NodeJS.ProcessEnv), true);
  assert.equal(miniProgramDevLoginEnabled({ NODE_ENV: "production", MINI_PROGRAM_ENABLED: "true", MINI_PROGRAM_DEV_LOGIN_ENABLED: "true", DATABASE_URL: "postgresql://localhost/test", WEB_ORIGIN: "http://localhost:5173" } as NodeJS.ProcessEnv), false);
  assert.equal(miniProgramDevLoginEnabled({ NODE_ENV: "development", MINI_PROGRAM_ENABLED: "true", MINI_PROGRAM_DEV_LOGIN_ENABLED: "true", DATABASE_URL: "postgresql://127.0.0.1/test", WEB_ORIGIN: "http://127.0.0.1:5173" } as NodeJS.ProcessEnv), true);
});

test("十类在用岗位拥有移动能力且历史仓库岗位保持关闭", () => {
  for (const role of ["CHAIRMAN", "ORDER_ADMIN", "FINANCE", "SALES", "DESIGNER", "TECHNICAL", "PROCUREMENT", "WORKSHOP", "INSTALLER", "AFTERSALES"]) {
    assert.equal(isMiniProgramRole(role), true);
    assert.ok(miniCapabilities(role).length > 0);
  }
  assert.equal(isMiniProgramRole("WAREHOUSE"), false);
  assert.deepEqual(miniCapabilities("WAREHOUSE"), []);
  assert.ok(!miniCapabilities("SALES").includes("shipment:write"));
  assert.ok(!miniCapabilities("ORDER_ADMIN").includes("installation:write"));
  assert.ok(miniCapabilities("FINANCE").includes("finance:confirm"));
  assert.ok(miniCapabilities("TECHNICAL").includes("technical:desktop-handoff"));
  assert.ok(!miniCapabilities("TECHNICAL").includes("technical:submit"));
  assert.ok(!miniCapabilities("WORKSHOP").includes("workshop:bulk-complete"));
});

test("移动员工视图只返回工作台所需身份字段", () => {
  const view = miniEmployeeView({ id: "e1", employeeNo: "S001", name: "销售测试", department: "销售部", role: "SALES", level: "STAFF", businessUnit: "NOERLI", workshop: null });
  assert.equal(view.roleLabel, "诺尔丽销售员");
  assert.equal(view.role, "SALES");
  assert.equal("username" in view, false);
  assert.equal("passwordHash" in view, false);
});

test("销售移动身份明确区分品牌主管和普通销售", () => {
  const supervisor = miniEmployeeView({ id: "m1", employeeNo: "SM01", name: "主管", department: "艾可居销售部", role: "SALES", level: "SUPERVISOR", businessUnit: "AIKEJU", workshop: null });
  const representative = miniEmployeeView({ id: "s1", employeeNo: "S01", name: "销售", department: "诺尔丽销售部", role: "SALES", level: "STAFF", businessUnit: "NOERLI", workshop: null });
  assert.equal(supervisor.roleLabel, "艾可居销售主管");
  assert.ok(supervisor.capabilities.includes("sales:brand-orders-read"));
  assert.equal(representative.roleLabel, "诺尔丽销售员");
  assert.ok(representative.capabilities.includes("sales:own-orders-read"));
});

test("车间主管只有巡查与逐项报工能力，没有移动批量完成能力", () => {
  const capabilities = miniCapabilities("WORKSHOP", "SUPERVISOR");
  assert.ok(capabilities.includes("workshop:supervise"));
  assert.ok(capabilities.includes("workshop:report"));
  assert.ok(!capabilities.includes("workshop:bulk-complete"));
});

test("移动令牌只持久化不可逆摘要", () => {
  const value = "a-secure-mobile-token-value";
  assert.notEqual(tokenHash(value), value);
  assert.equal(tokenHash(value), tokenHash(value));
  assert.equal(tokenHash(value).length, 64);
});
