import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const python = path.join(root, ".venv", "bin", "python");
const database = new URL(process.env.CUSTOMER_AGENT_DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || database.pathname !== "/whole_house_erp_customer_agent_demo") {
  throw new Error("Agent 启动配置必须指向本机独立数据库");
}
const processHandle = spawn(python, ["-m", "uvicorn", "app:app", "--app-dir", root, "--host", "127.0.0.1", "--port", "8042"], { stdio: "inherit", env: process.env });
process.on("SIGINT", () => processHandle.kill("SIGINT"));
process.on("SIGTERM", () => processHandle.kill("SIGTERM"));
processHandle.on("exit", (code) => { process.exitCode = code ?? 1; });
