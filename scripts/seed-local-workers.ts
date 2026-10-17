import "dotenv/config";
import { hash } from "bcryptjs";
import { PrismaService } from "../server/prisma.service.js";
import { LOCAL_WORKERS } from "../server/domain/local-worker-roster.js";
import { localTestAccountsEnabled } from "../server/runtime-config.js";

if (!localTestAccountsEnabled()) throw new Error("工人测试账号只能初始化到 localhost 非生产数据库");
const db = new PrismaService();
try {
  const passwordHash = await hash("erp123456", 12);
  const results = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('employee-administration'))`;
    const result = [];
    for (const worker of LOCAL_WORKERS) {
      const existing = await tx.employee.findFirst({ where: { OR: [{ username: worker.username }, { employeeNo: worker.employeeNo }] } });
      if (existing) {
        if (existing.username !== worker.username || existing.employeeNo !== worker.employeeNo || existing.role !== worker.role || existing.workshop !== worker.workshop || existing.level !== "STAFF") throw new Error(`${worker.username} 与已有账号冲突，未覆盖`);
        // A repeat run must not revert the user's later permission or password edits.
        result.push({ username: worker.username, status: "保留已有账号", active: existing.active, processCodes: existing.processCodes });
        continue;
      }
      const employee = await tx.employee.create({ data: { ...worker, passwordHash, mustChangePassword: false } });
      await tx.securityAudit.create({ data: { targetId: employee.id, action: "LOCAL_WORKER_CREATED", metadata: { username: worker.username, workshop: worker.workshop, processCodes: worker.processCodes, source: "local-workers-20260831" } } });
      result.push({ username: worker.username, status: "已创建本地工人账号", active: true, processCodes: worker.processCodes });
    }
    return result;
  }, { timeout: 30_000 });
  console.log(JSON.stringify(results, null, 2));
} finally {
  await db.$disconnect();
}
