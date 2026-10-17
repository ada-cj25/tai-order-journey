import "dotenv/config";
import { PrismaService } from "../server/prisma.service.js";
import { localTestAccountsEnabled } from "../server/runtime-config.js";

if (!localTestAccountsEnabled()) throw new Error("此核查脚本仅允许连接本地非生产数据库");

const db = new PrismaService();
try {
  const orders = await db.order.findMany({
    select: {
      id: true,
      trackingSerial: true,
      salesNumber: true,
      productionNumber: true,
      productionAreas: { select: { id: true, productionNumber: true } },
    },
  });
  const related = {
    processes: await db.productionProcess.count(),
    reports: await db.productionReport.count(),
    technicalPackages: await db.technicalPackageVersion.count(),
    materialImports: await db.materialImportBatch.count(),
    materialVersions: await db.materialListVersion.count(),
    costVersions: await db.orderMaterialCostVersion.count(),
  };
  const orphanRows = {
    processes: await db.productionProcess.findMany({ where: { productionAreaId: null }, select: { id: true, order: { select: { trackingSerial: true, productionNumber: true } } } }),
    reports: await db.productionReport.findMany({ where: { productionAreaId: null }, select: { id: true, order: { select: { trackingSerial: true, productionNumber: true } } } }),
    technicalPackages: await db.technicalPackageVersion.findMany({ where: { productionAreaId: null }, select: { id: true, order: { select: { trackingSerial: true, productionNumber: true } } } }),
    materialImports: await db.materialImportBatch.findMany({ where: { productionAreaId: null }, select: { id: true, order: { select: { trackingSerial: true, productionNumber: true } } } }),
    materialVersions: await db.materialListVersion.findMany({ where: { productionAreaId: null }, select: { id: true, order: { select: { trackingSerial: true, productionNumber: true } } } }),
    costVersions: await db.orderMaterialCostVersion.findMany({ where: { productionAreaId: null }, select: { id: true, order: { select: { trackingSerial: true, productionNumber: true } } } }),
  };
  const orphaned = Object.fromEntries(Object.entries(orphanRows).map(([key, rows]) => [key, rows.length]));
  const missingSalesNumbers = orders.filter((order) => !order.salesNumber);
  const legacyNumberMismatches = orders.filter((order) => order.productionNumber && !order.productionAreas.some((area) => area.productionNumber === order.productionNumber));
  const duplicateSalesNumbers = await db.order.groupBy({ by: ["salesNumber"], where: { salesNumber: { not: null } }, _count: { salesNumber: true }, having: { salesNumber: { _count: { gt: 1 } } } });
  const formalSalesOrders = orders.filter((order) => order.salesNumber && /^[NACEW]\d{8}$/.test(order.salesNumber));
  const testSalesOrders = orders.filter((order) => order.trackingSerial.startsWith("TEST-") || order.productionNumber?.startsWith("TEST-"));
  const invalidTestSalesNumbers = testSalesOrders.filter((order) => !order.salesNumber?.startsWith("TEST-SALES-"));
  const failures = {
    missingSalesNumbers: missingSalesNumbers.map((order) => order.trackingSerial),
    duplicateSalesNumbers,
    legacyNumberMismatches: legacyNumberMismatches.map((order) => ({ trackingSerial: order.trackingSerial, productionNumber: order.productionNumber })),
    orphaned: Object.fromEntries(Object.entries(orphanRows).filter(([, rows]) => rows.length > 0)),
    invalidTestSalesNumbers: invalidTestSalesNumbers.map((order) => order.trackingSerial),
  };
  if (Object.values(failures).some((value) => Array.isArray(value) ? value.length : Object.keys(value).length)) {
    throw new Error(`多区域迁移核查失败：${JSON.stringify(failures)}`);
  }
  console.log(JSON.stringify({
    ok: true,
    orders: orders.length,
    formalSalesOrders: formalSalesOrders.length,
    testSalesOrders: testSalesOrders.length,
    legacyProductionOrders: orders.filter((order) => order.productionNumber).length,
    productionAreas: orders.reduce((sum, order) => sum + order.productionAreas.length, 0),
    related,
    productionNumberPools: await db.productionNumberSequence.findMany({ select: { yearMonth: true, category: true, lastValue: true }, orderBy: [{ yearMonth: "asc" }, { category: "asc" }] }),
    salesNumberPools: await db.salesNumberSequence.findMany({ select: { yearMonth: true, prefix: true, lastValue: true }, orderBy: [{ yearMonth: "asc" }, { prefix: "asc" }] }),
  }, null, 2));
} finally {
  await db.$disconnect();
}
