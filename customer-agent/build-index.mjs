import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const directory = path.dirname(fileURLToPath(import.meta.url));
const database = new URL(process.env.CUSTOMER_AGENT_DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || database.pathname !== "/whole_house_erp_customer_agent_demo") {
  throw new Error("知识向量只能写入本机独立客服测试库");
}
const result = spawnSync(path.join(directory, ".venv", "bin", "python"), [path.join(directory, "build_index.py"), ...process.argv.slice(2)], {
  cwd: path.dirname(directory),
  env: { ...process.env, CUSTOMER_ENABLE_DENSE: "true" },
  stdio: "inherit",
});
process.exit(result.status ?? 1);
