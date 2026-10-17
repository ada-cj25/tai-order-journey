import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module.js";
import { addInternalWorkingDays } from "../domain/rules.js";
import { MaterialCostService } from "../material-cost.service.js";
import { PrismaService } from "../prisma.service.js";

const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error"] });
const prisma = app.get(PrismaService);
const materialCosts = app.get(MaterialCostService);

try {
  const versions = await prisma.materialListVersion.findMany({
    where: {
      status: { in: ["PUBLISHED", "WAREHOUSE_RELEASED"] },
      lines: { some: {} },
    },
    include: { lines: true, costVersion: { select: { id: true } }, order: { select: { stage: true, procurementStartedAt: true } } },
    orderBy: { releasedAt: "asc" },
  });
  for (const version of versions) {
    if (!version.costVersion) await prisma.$transaction((tx) => materialCosts.createForMaterialVersion(tx, version.orderId, version.id, version.lines));
    if (version.order.stage === "MATERIALS" && !version.order.procurementStartedAt) {
      await prisma.order.update({ where: { id: version.orderId }, data: { procurementStartedAt: version.releasedAt, procurementDueAt: addInternalWorkingDays(version.releasedAt, 15), currentOwnerLabel: "采购部", nextAction: "线下完成全部采购并确认", materialSubstatus: "线下采购进行中" } });
    }
  }
  console.log(`Procurement cost V2 backfill checked: ${versions.length} material version(s).`);
} finally {
  await app.close();
}
