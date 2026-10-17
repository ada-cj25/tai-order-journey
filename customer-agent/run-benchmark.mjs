import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const database = new URL(process.env.CUSTOMER_AGENT_DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || database.pathname !== "/whole_house_erp_customer_agent_demo") {
  throw new Error("评测只能使用本机独立 Agent 数据库");
}
const result = spawnSync(path.join(root, ".venv", "bin", "python"), [path.join(root, "benchmark.py")], { stdio: "inherit", env: process.env });
process.exitCode = result.status ?? 1;
