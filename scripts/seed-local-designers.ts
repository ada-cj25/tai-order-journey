import "dotenv/config";
import { hash } from "bcryptjs";
import { LOCAL_DESIGNERS } from "../server/domain/local-designer-roster.js";
import { PrismaService } from "../server/prisma.service.js";
import { localTestAccountsEnabled } from "../server/runtime-config.js";

if (!localTestAccountsEnabled()) throw new Error("设计师测试账号只能初始化到 localhost 非生产数据库");

const apply = process.argv.includes("--apply");
const db = new PrismaService();

try {
  const passwordHash = apply ? await hash("erp123456", 12) : "";
  const results = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('employee-administration'))`;
    const output: Array<{ username: string; status: string }> = [];
    for (const item of LOCAL_DESIGNERS) {
      const existing = await tx.employee.findFirst({
        where: { OR: [{ username: item.username }, { employeeNo: item.employeeNo }] },
      });
      if (existing && (
        existing.username !== item.username
        || existing.employeeNo !== item.employeeNo
        || existing.role !== "DESIGNER"
        || existing.department !== item.department
      )) throw new Error(`${item.username} 与已有账号冲突，未覆盖任何账号`);

      if (!existing && apply) {
        const employee = await tx.employee.create({
          data: { ...item, passwordHash, mustChangePassword: false },
        });
        await tx.securityAudit.create({
          data: {
            targetId: employee.id,
            action: "LOCAL_DESIGNER_CREATED",
            metadata: { username: item.username, source: "local-designer-handoff-20260912" },
          },
        });
      }
      output.push({
        username: item.username,
        status: existing ? "保留已有账号、密码及启用状态" : apply ? "已创建" : "将创建",
      });
    }
    return output;
  });
  console.log(JSON.stringify({ mode: apply ? "已应用" : "预览；加 --apply 才会写入", results }, null, 2));
} finally {
  await db.$disconnect();
}
