import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const erp = new URL(process.env.DATABASE_URL ?? "");
const agent = new URL(process.env.CUSTOMER_AGENT_DATABASE_URL ?? "");
const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
if (process.env.CUSTOMER_DEMO_ENABLED !== "true" || !loopback.has(erp.hostname) || !loopback.has(agent.hostname) || erp.pathname !== "/whole_house_erp_customer_demo" || agent.pathname !== "/whole_house_erp_customer_agent_demo") {
  throw new Error("初始化只允许连接两个指定的本机客服测试库");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, env: process.env, stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

// Databases must already exist. Never create or reset a user database here.
for (const url of [erp, agent]) run("psql", [url.toString(), "-tAc", "SELECT 1"]);
run(path.join(root, "node_modules", ".bin", "prisma"), ["migrate", "deploy", "--schema", "server/prisma/schema.prisma"]);
const check = spawnSync("psql", [erp.toString(), "-tAc", `SELECT to_regclass('public."CustomerAccount"') IS NOT NULL`], { cwd: root, env: process.env, encoding: "utf8" });
if (check.status !== 0) throw new Error("无法检查客服表");
if (check.stdout.trim() !== "t") run("psql", [erp.toString(), "-v", "ON_ERROR_STOP=1", "-f", "customer-agent/sql/local-customer-schema.sql"]);
run(process.execPath, ["--env-file=.env.customer-demo", "--import", "tsx", "scripts/seed-customer-demo.ts"]);
console.log("本机隔离客服测试库已准备好；现有用户库和云端均未操作。");
