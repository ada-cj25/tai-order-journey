import "dotenv/config";
import { PrismaService } from "../server/prisma.service.js";
import { localTestAccountsEnabled } from "../server/runtime-config.js";

if (!localTestAccountsEnabled()) throw new Error("此核查脚本仅用于本地非生产数据库");
const db = new PrismaService();
try {
  const pools = await db.productionNumberSequence.findMany({ orderBy: [{ yearMonth: "asc" }, { category: "asc" }] });
  const orders = await db.order.findMany({ where: { productionNumber: { not: null } }, select: { trackingSerial: true, productionNumber: true, businessType: true, createdAt: true }, orderBy: { productionNumber: "asc" } });
  const reservations = await db.securityAudit.findMany({ where: { action: "LEGACY_NUMBER_RESERVED" }, select: { createdAt: true, metadata: true } });
  console.log(JSON.stringify({ pools, orders, reservations }, null, 2));
} finally { await db.$disconnect(); }
