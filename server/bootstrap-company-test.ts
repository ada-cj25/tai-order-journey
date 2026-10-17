import "dotenv/config";
import { readFile } from "node:fs/promises";
import { hash } from "bcryptjs";
import { PrismaService } from "./prisma.service.js";
import { validateAccount, validatePassword } from "./account-policy.js";
import { numberPoolMonth } from "./domain/number-pool-month.js";

const path = process.argv.find((arg) => arg.startsWith("--manifest="))?.slice(11);
if (!path) throw new Error("需要 --manifest=/bootstrap/company-test-bootstrap.json；默认只检查，不写入");
const manifest = JSON.parse(await readFile(path, "utf8"));
if (manifest.environment !== "company-test") throw new Error("初始化清单必须明确标记 company-test");
const administrator = validateAccount({ ...manifest.administrator, role: "CHAIRMAN", level: "STAFF", active: true });
const yearMonth = numberPoolMonth(manifest.yearMonth);
const database = new URL(process.env.DATABASE_URL ?? "").pathname.slice(1);
if (process.env.NODE_ENV !== "production" || process.env.APP_ENVIRONMENT !== "company-test") throw new Error("仅允许在公司云测试容器内运行");
if (!database || database !== "tai_erp") throw new Error("测试环境必须使用独立 PostgreSQL 实例中的 tai_erp 数据库");

const db = new PrismaService();
try {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('employee-administration'))`;
    if (await tx.employee.count() || await tx.order.count() || await tx.productionNumberSequence.count()) throw new Error("仅允许初始化空测试库；不得覆盖已有账号、订单或编号池");
    if (!process.argv.includes("--apply")) {
      console.log("公司云测试清单与空库检查通过；尚未写入。测试编号池将从 0 开始，仅用于编造数据。");
      return;
    }
    if (process.env.BOOTSTRAP_CONFIRM_DATABASE !== database || process.env.BOOTSTRAP_CONFIRM_ENVIRONMENT !== "company-test") throw new Error("应用前需双重确认目标数据库与 company-test 环境");
    validatePassword(process.env.BOOTSTRAP_ADMIN_PASSWORD);
    const passwordHash = await hash(process.env.BOOTSTRAP_ADMIN_PASSWORD!, 12);
    const admin = await tx.employee.create({ data: { ...administrator, role: "CHAIRMAN", passwordHash, mustChangePassword: true } });
    await tx.productionNumberSequence.createMany({ data: [0, 1, 5, 7, 8, 9].map((category) => ({ yearMonth, category, lastValue: 0 })) });
    await tx.securityAudit.create({ data: { actorId: admin.id, action: "COMPANY_TEST_BOOTSTRAPPED", metadata: { environment: "company-test", yearMonth, simulatedDataOnly: true } } });
    console.log("公司云测试库已初始化：唯一管理员须首次改密，六个测试编号池从 0 开始；未导入订单或演示账号。");
  }, { timeout: 30_000 });
} finally {
  await db.$disconnect();
}
