import "dotenv/config";
import { readFile } from "node:fs/promises";
import { hash } from "bcryptjs";
import { PrismaService } from "./prisma.service.js";
import { validateAccount, validatePassword } from "./account-policy.js";
import { numberPoolMonth } from "./domain/number-pool-month.js";

const path = process.argv.find((arg) => arg.startsWith("--manifest="))?.slice(11);
if (!path) throw new Error("需要 --manifest=/安全目录/已审核初始化清单.json；默认只检查，不写入");
const manifest = JSON.parse(await readFile(path, "utf8"));
const input = validateAccount({ ...manifest.administrator, role: "CHAIRMAN", level: "STAFF", active: true });
if (!manifest.approvedBy || !manifest.receiptAccountsConfirmed || !manifest.numberingCutoverConfirmed) throw new Error("需确认负责人、三个收款账户及新旧编号衔接");
if (!Array.isArray(manifest.numberPools) || !manifest.numberPools.length) throw new Error("必须提供已核对的编号池起点");
const keys = new Set<string>();
for (const pool of manifest.numberPools) {
  pool.yearMonth = numberPoolMonth(pool.yearMonth);
  if (![0, 1, 5, 7, 8, 9].includes(pool.category) || !Number.isInteger(pool.lastValue) || pool.lastValue < 0 || pool.lastValue > 999) throw new Error("编号池格式无效；lastValue是已占用最大流水，不是下一编号");
  const key = `${pool.yearMonth}:${pool.category}`;
  if (keys.has(key)) throw new Error("编号池重复");
  keys.add(key);
}
for (const month of new Set<string>(manifest.numberPools.map((pool: { yearMonth: string }) => pool.yearMonth))) {
  for (const category of [0, 1, 5, 7, 8, 9]) if (!keys.has(`${month}:${category}`)) throw new Error("每个月必须确认全部六个流水池（未使用填0）");
}

const db = new PrismaService();
try {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('employee-administration'))`;
    if (await tx.employee.count() || await tx.order.count() || await tx.productionNumberSequence.count()) throw new Error("仅允许初始化空业务库；不得覆盖已有账号、订单或编号池");
    if (!process.argv.includes("--apply")) {
      console.log("清单与空库检查通过；尚未写入。实际收款账户仍须由财务逐项核对。");
      return;
    }
    const database = new URL(process.env.DATABASE_URL!).pathname.slice(1);
    if (process.env.NODE_ENV !== "production" || process.env.BOOTSTRAP_CONFIRM_DATABASE !== database) throw new Error("应用前需设置 NODE_ENV=production 和与目标库名一致的 BOOTSTRAP_CONFIRM_DATABASE");
    validatePassword(process.env.BOOTSTRAP_ADMIN_PASSWORD);
    const passwordHash = await hash(process.env.BOOTSTRAP_ADMIN_PASSWORD!, 12);
    const admin = await tx.employee.create({ data: { ...input, role: "CHAIRMAN", passwordHash, mustChangePassword: true } });
    await tx.productionNumberSequence.createMany({ data: manifest.numberPools.map(({ yearMonth, category, lastValue }: { yearMonth: string; category: number; lastValue: number }) => ({ yearMonth, category, lastValue })) });
    await tx.securityAudit.create({ data: { actorId: admin.id, action: "PRODUCTION_BOOTSTRAPPED", metadata: { approvedBy: manifest.approvedBy, numberPools: manifest.numberPools, receiptAccountsConfirmed: true } } });
    console.log("已初始化唯一管理员和已审核编号池；无订单、样例或成本数据被导入。首次登录须改密。");
  }, { timeout: 30_000 });
} finally {
  await db.$disconnect();
}
