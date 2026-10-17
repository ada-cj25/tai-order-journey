import "dotenv/config";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

// Never infer permission to create/drop a database from the application's DATABASE_URL.
if (!process.env.TEST_DATABASE_ADMIN_URL) throw new Error("请配置专用 TEST_DATABASE_ADMIN_URL；不会回退到业务 DATABASE_URL");
const adminUrl = new URL(process.env.TEST_DATABASE_ADMIN_URL);
const name = `erp_test_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Client({ connectionString: adminUrl.href });
await admin.connect();
let created = false;
let exitCode = 1;
try {
  await admin.query(`CREATE DATABASE "${name}"`); created = true;
  const testUrl = new URL(adminUrl); testUrl.pathname = `/${name}`;
  const env = { ...process.env, DATABASE_URL: testUrl.href, NODE_ENV: "test", COST_MODULE_ENABLED: "false", TZ: "Asia/Shanghai", TSX_TSCONFIG_PATH: "server/tsconfig.json" };
  const migrate = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env, stdio: "inherit" });
  if (migrate.status !== 0) throw new Error("隔离数据库迁移失败");
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", "tests/integration/production-hardening.test.ts"], { env, stdio: "inherit" });
  exitCode = result.status ?? 1;
} finally {
  if (created) {
    if (!/^erp_test_[a-f0-9]{32}$/.test(name)) throw new Error("拒绝清理非本次生成的测试库");
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    console.log("已清理本次生成的隔离测试库；业务数据库未被测试脚本修改。");
  }
  await admin.end();
}
process.exitCode = exitCode;
