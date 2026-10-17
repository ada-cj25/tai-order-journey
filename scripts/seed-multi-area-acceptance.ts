import "dotenv/config";
import { PrismaService } from "../server/prisma.service.js";
import { localTestAccountsEnabled } from "../server/runtime-config.js";
import { WORKSHOP_LABELS, WORKSHOP_PROCESS_TEMPLATES } from "../server/domain/workshop-processes.js";

if (!localTestAccountsEnabled()) throw new Error("此样例仅允许写入本地非生产数据库");
const db = new PrismaService();
const trackingSerial = "TEST-MULTI-AREA-20260901";

try {
  const existing = await db.order.findUnique({ where: { trackingSerial }, include: { productionAreas: true } });
  if (existing) {
    await db.order.update({ where: { id: existing.id }, data: { stage: "PRODUCTION", currentOwnerLabel: "生产车间", nextAction: "继续完成未完工区域；已完工区域可按批发货" } });
    console.log(`多区域验收样例已存在：${existing.salesNumber}，保留后续人工测试事实；区域 ${existing.productionAreas.length} 个`);
  } else {
    const [sales, designer, chairman] = await Promise.all([
      db.employee.findUniqueOrThrow({ where: { username: "sales" } }),
      db.employee.findUniqueOrThrow({ where: { username: "designer" } }),
      db.employee.findUniqueOrThrow({ where: { username: "chairman" } }),
    ]);
    const now = new Date();
    const order = await db.order.create({
      data: {
        trackingSerial,
        salesNumber: "TEST-SALES-MULTI-AREA-20260901",
        businessType: "NOERLI_FORMAL",
        siteType: "FINISHED",
        customerName: "多区域三路线验收样例",
        customerPhone: "LOCAL-TEST-ONLY",
        address: "本地验收项目（无真实客户数据）",
        amount: 168000,
        signedAt: now,
        standardDueAt: new Date("2026-10-15T17:00:00+08:00"),
        promisedAt: new Date("2026-10-15T17:00:00+08:00"),
        internalDueAt: new Date("2026-10-15T17:00:00+08:00"),
        productionDueAt: new Date("2026-10-10T17:00:00+08:00"),
        stage: "PRODUCTION",
        currentOwnerLabel: "生产车间",
        nextAction: "继续完成主卧与卫生间；已完工区域可按批发货",
        depositReported: true,
        depositConfirmed: true,
        tailPaymentReported: true,
        tailPaymentConfirmed: true,
        installationApplied: true,
        procurementPlanned: true,
        procurementStartedAt: new Date("2026-09-01T09:00:00+08:00"),
        procurementDueAt: new Date("2026-09-18T17:00:00+08:00"),
        procurementCompletedAt: now,
        procurementCompletedBy: chairman.id,
        materialSubstatus: "多区域验收样例 · 全部采购已完成",
        salesId: sales.id,
        designerId: designer.id,
      },
    });
    const areas = [
      { name: "客厅", productionNumber: "TEST-AREA-LIVING-01", workshops: ["PANEL", "ASSEMBLY"], completeWorkshops: ["PANEL", "ASSEMBLY"] },
      { name: "主卧", productionNumber: "TEST-AREA-BEDROOM-02", workshops: ["WOOD", "PAINT", "ASSEMBLY"], completeWorkshops: ["WOOD"] },
      { name: "卫生间", productionNumber: "TEST-AREA-BATHROOM-03", workshops: ["PANEL", "WOOD", "PAINT", "ASSEMBLY"], completeWorkshops: ["PANEL"] },
    ] as const;
    for (const [areaIndex, definition] of areas.entries()) {
      const areaComplete = definition.completeWorkshops.length === definition.workshops.length;
      const area = await db.productionArea.create({ data: { orderId: order.id, name: definition.name, sequence: areaIndex + 1, productionNumber: definition.productionNumber, status: areaComplete ? "PRODUCTION_COMPLETE" : "PRODUCTION", productionCompletedAt: areaComplete ? now : null, createdBy: chairman.id } });
      for (const workshop of definition.workshops) {
        const steps = WORKSHOP_PROCESS_TEMPLATES[workshop];
        const workshopComplete = definition.completeWorkshops.includes(workshop as never);
        for (const [index, processName] of steps.entries()) {
          await db.productionProcess.create({ data: {
            orderId: order.id,
            productionAreaId: area.id,
            workshop,
            workshopLabel: WORKSHOP_LABELS[workshop],
            processCode: `${workshop}-${String(index + 1).padStart(2, "0")}`,
            processName,
            sequence: index + 1,
            plannedQty: 10,
            completedQty: workshopComplete ? 10 : 0,
            status: workshopComplete ? "COMPLETE" : "PENDING",
            startedAt: workshopComplete ? now : null,
            completedAt: workshopComplete ? now : null,
            lastReportedAt: workshopComplete ? now : null,
            updatedBy: workshopComplete ? chairman.id : null,
          } });
        }
      }
    }
    await db.orderEvent.create({ data: { orderId: order.id, actorId: chairman.id, type: "LOCAL_MULTI_AREA_ACCEPTANCE_SAMPLE", title: "多区域三路线验收样例已建立", description: "客厅仅板式且已完工；主卧仅木工油漆；卫生间双路线且板式已完成，可验证组装OR解锁以及已完工区域按批发货。", fromStage: "PRODUCTION", toStage: "PRODUCTION", metadata: { sample: true } } });
    console.log(`多区域验收样例已建立：${order.salesNumber}；3个区域均使用 TEST-AREA-*，未占正式编号池`);
  }
} finally {
  await db.$disconnect();
}
