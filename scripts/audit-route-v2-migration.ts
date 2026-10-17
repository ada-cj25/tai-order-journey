import "dotenv/config";
import { PrismaService } from "../server/prisma.service.js";
import { localTestAccountsEnabled } from "../server/runtime-config.js";
import { addInternalWorkingDays } from "../server/domain/rules.js";
import { WORKSHOP_LABELS, WORKSHOP_PROCESS_TEMPLATES } from "../server/domain/workshop-processes.js";
import { PRODUCTION_ROUTE_LABELS, type ProductionRouteKind } from "../server/domain/route-execution.js";

if (!localTestAccountsEnabled()) throw new Error("路线迁移审计仅允许连接本地非生产数据库");

const apply = process.argv.includes("--apply");
const db = new PrismaService();

try {
  const before = {
    processes: await db.productionProcess.count(),
    reports: await db.productionReport.count(),
    packageEntries: await db.packageCountEntry.count(),
    shipmentAreas: await db.shipmentArea.count(),
  };
  const orders = await db.order.findMany({
    where: { productionExecutionMode: "AREA_LEGACY" },
    include: {
      productionReports: { select: { id: true } },
      packageCountSources: { where: { kind: { in: ["MANUFACTURED_AREA", "MANUFACTURED_ROUTE"] } }, select: { id: true } },
      shipments: { where: { kind: "MANUFACTURED" }, select: { id: true } },
      productionAreas: { where: { cancelledAt: null }, include: {
        productionProcesses: { select: { id: true } },
        technicalPackages: { where: { status: "APPROVED" }, orderBy: { version: "desc" }, take: 1 },
      } },
    },
    orderBy: { createdAt: "asc" },
  });

  const report = { automatic: [] as Record<string, unknown>[], pendingReview: [] as Record<string, unknown>[], retainedLegacy: [] as Record<string, unknown>[] };
  for (const order of orders) {
    const id = order.salesNumber ?? order.trackingSerial;
    if (order.productionReports.length || order.packageCountSources.length || order.shipments.length) {
      report.retainedLegacy.push({ id, reason: "已存在报工、自产包件或自产发货事实" });
      continue;
    }
    const packages = order.productionAreas.map((area) => area.technicalPackages[0]).filter(Boolean);
    if (!packages.length || packages.length !== order.productionAreas.length || packages.some((item) => !item?.submissionSetId)) {
      report.retainedLegacy.push({ id, reason: "尚无完整已审批技术提交集" });
      continue;
    }
    const unresolved = packages.filter((item) => item!.panelEnabled && item!.woodPaintEnabled && (!(Number(item!.panelAssemblyPlanQty) > 0) || !(Number(item!.woodPaintAssemblyPlanQty) > 0)));
    if (unresolved.length) {
      report.pendingReview.push({ id, reason: "双路线只有一份旧组装面积，不能臆测拆分", productionNumbers: unresolved.map((item) => item!.productionAreaId) });
      if (apply) await db.order.update({ where: { id: order.id }, data: { materialSubstatus: "路线组装计划待核定" } });
      continue;
    }
    report.automatic.push({ id, areas: order.productionAreas.length, routes: packages.reduce((sum, item) => sum + Number(item!.panelEnabled) + Number(item!.woodPaintEnabled), 0) });
    if (!apply) continue;

    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`;
      const startedAt = order.procurementStartedAt ?? new Date();
      const dueAt = order.procurementDueAt ?? addInternalWorkingDays(startedAt, 15);
      const setIds = [...new Set(packages.map((item) => item!.submissionSetId!))];
      if (setIds.length !== 1) throw new Error(`${id}的有效技术包不属于同一提交集`);
      const kinds: ProductionRouteKind[] = [
        ...(packages.some((item) => item!.panelEnabled) ? ["PANEL" as const] : []),
        ...(packages.some((item) => item!.woodPaintEnabled) ? ["WOOD_PAINT" as const] : []),
      ];
      const gates = new Map<ProductionRouteKind, string>();
      for (const kind of kinds) {
        const gate = await tx.procurementRouteGate.upsert({
          where: { submissionSetId_kind: { submissionSetId: setIds[0]!, kind } },
          update: {},
          create: { orderId: order.id, submissionSetId: setIds[0]!, kind, startedAt, dueAt },
        });
        gates.set(kind, gate.id);
      }
      await tx.productionProcess.deleteMany({ where: { orderId: order.id } });
      for (const item of packages) {
        const plans: Array<{ kind: ProductionRouteKind; assembly: number; workshops: Array<keyof typeof WORKSHOP_PROCESS_TEMPLATES>; quantities: Record<string, number> }> = [];
        if (item!.panelEnabled) plans.push({ kind: "PANEL", assembly: Number(item!.panelAssemblyPlanQty ?? item!.assemblyPlanQty), workshops: ["PANEL", "ASSEMBLY"], quantities: { PANEL: Number(item!.panelPlanQty), ASSEMBLY: Number(item!.panelAssemblyPlanQty ?? item!.assemblyPlanQty) } });
        if (item!.woodPaintEnabled) plans.push({ kind: "WOOD_PAINT", assembly: Number(item!.woodPaintAssemblyPlanQty ?? item!.assemblyPlanQty), workshops: ["WOOD", "PAINT", "ASSEMBLY"], quantities: { WOOD: Number(item!.woodPlanQty), PAINT: Number(item!.paintPlanQty), ASSEMBLY: Number(item!.woodPaintAssemblyPlanQty ?? item!.assemblyPlanQty) } });
        for (const plan of plans) {
          const route = await tx.productionRoute.create({ data: { orderId: order.id, productionAreaId: item!.productionAreaId!, technicalPackageId: item!.id, procurementRouteGateId: gates.get(plan.kind)!, kind: plan.kind, assemblyPlanQty: plan.assembly } });
          for (const workshop of plan.workshops) await tx.productionProcess.createMany({ data: WORKSHOP_PROCESS_TEMPLATES[workshop].map((name, index) => ({
            orderId: order.id, productionAreaId: item!.productionAreaId, productionRouteId: route.id, workshop,
            workshopLabel: workshop === "ASSEMBLY" ? `${PRODUCTION_ROUTE_LABELS[plan.kind]}组装` : WORKSHOP_LABELS[workshop],
            processCode: `${workshop}-${String(index + 1).padStart(2, "0")}`, processName: name, sequence: index + 1,
            plannedQty: workshop === "ASSEMBLY" && index > 0 ? 1 : plan.quantities[workshop], unit: workshop === "ASSEMBLY" && index > 0 ? "项" : "㎡",
            metricMode: workshop !== "ASSEMBLY" || index === 0 ? "AREA_QUANTITY" : index === 1 ? "REFERENCE_CONFIRMATION" : index === 2 ? "PACKAGE_COUNT" : "MILESTONE",
          })) });
        }
      }
      await tx.order.update({ where: { id: order.id }, data: { productionExecutionMode: "ROUTE_V2", procurementStartedAt: startedAt, procurementDueAt: dueAt, materialSubstatus: "路线采购进行中", productionReady: false } });
    });
  }

  const after = {
    processes: await db.productionProcess.count(),
    reports: await db.productionReport.count(),
    packageEntries: await db.packageCountEntry.count(),
    shipmentAreas: await db.shipmentArea.count(),
    routes: await db.productionRoute.count(),
    gates: await db.procurementRouteGate.count(),
  };
  if (apply && (before.reports !== after.reports || before.packageEntries !== after.packageEntries || before.shipmentAreas !== after.shipmentAreas)) throw new Error("事实守恒校验失败");
  console.log(JSON.stringify({ mode: apply ? "APPLY" : "AUDIT_ONLY", report, before, after }, null, 2));
} finally {
  await db.$disconnect();
}
