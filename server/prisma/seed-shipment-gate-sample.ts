import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { WORKSHOP_LABELS, WORKSHOP_PROCESS_TEMPLATES } from "../domain/production-progress.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL 未配置");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const trackingSerial = "TEST-WHOLE-SHIPMENT-20260901";
const productionNumber = "TEST-AREA-WHOLE-SHIPMENT-01";

async function seedShipmentGateSample() {
  const [sales, designer, chairman, orderAdmin] = await Promise.all([
    prisma.employee.findUniqueOrThrow({ where: { username: "sales" } }),
    prisma.employee.findUniqueOrThrow({ where: { username: "designer" } }),
    prisma.employee.findUniqueOrThrow({ where: { username: "chairman" } }),
    prisma.employee.findUniqueOrThrow({ where: { username: "orderadmin" } }),
  ]);

  const order = await prisma.order.upsert({
    where: { trackingSerial },
    update: {
      salesNumber: "TEST-SALES-WHOLE-SHIPMENT",
      customerName: "区域批次发货条件快速验收样例",
      stage: "DELIVERY",
      currentOwnerLabel: "所属销售",
      nextAction: "报备尾款账户、金额、到账日期和凭证",
      productionReady: true,
      depositReported: true,
      depositConfirmed: true,
      tailPaymentReported: false,
      tailPaymentConfirmed: false,
      installationApplied: false,
      procurementPlanned: true,
      materialSubstatus: "已完成全部采购",
    },
    create: {
      trackingSerial,
      salesNumber: "TEST-SALES-WHOLE-SHIPMENT",
      productionNumber,
      businessType: "NOERLI_FORMAL",
      siteType: "FINISHED",
      customerName: "区域批次发货条件快速验收样例",
      customerPhone: "138****0830",
      address: "宁波市本地验收项目（样例）",
      amount: 188000,
      signedAt: new Date("2026-08-01T09:00:00+08:00"),
      standardDueAt: new Date("2026-09-12T17:00:00+08:00"),
      promisedAt: new Date("2026-09-12T17:00:00+08:00"),
      internalDueAt: new Date("2026-09-12T17:00:00+08:00"),
      productionDueAt: new Date("2026-09-10T17:00:00+08:00"),
      stage: "DELIVERY",
      currentOwnerLabel: "所属销售",
      nextAction: "报备尾款账户、金额、到账日期和凭证",
      depositReported: true,
      depositConfirmed: true,
      tailPaymentReported: false,
      tailPaymentConfirmed: false,
      installationApplied: false,
      productionReady: true,
      procurementPlanned: true,
      procurementStartedAt: new Date("2026-08-10T09:00:00+08:00"),
      procurementDueAt: new Date("2026-08-27T17:00:00+08:00"),
      procurementCompletedAt: new Date("2026-08-24T16:30:00+08:00"),
      procurementCompletedBy: chairman.id,
      materialSubstatus: "已完成全部采购",
      salesId: sales.id,
      designerId: designer.id,
    },
  });

  const existingArea = await prisma.productionArea.findFirst({ where: { orderId: order.id, sequence: 1 } });
  const area = existingArea
    ? await prisma.productionArea.update({ where: { id: existingArea.id }, data: { name: "历史未分区区域", status: "PRODUCTION_COMPLETE", productionCompletedAt: new Date("2026-08-29T16:30:00+08:00") } })
    : await prisma.productionArea.create({ data: { orderId: order.id, name: "历史未分区区域", sequence: 1, productionNumber, status: "PRODUCTION_COMPLETE", productionCompletedAt: new Date("2026-08-29T16:30:00+08:00"), createdBy: chairman.id } });

  const quantities = { PANEL: 36, WOOD: 12, PAINT: 12, ASSEMBLY: 36 } as const;
  const completedAt = new Date("2026-08-29T16:30:00+08:00");
  for (const [workshop, steps] of Object.entries(WORKSHOP_PROCESS_TEMPLATES)) {
    const plannedQty = quantities[workshop as keyof typeof quantities];
    for (const [index, processName] of steps.entries()) {
      const processCode = `${workshop}-${String(index + 1).padStart(2, "0")}`;
      const process = await prisma.productionProcess.upsert({
        where: { productionAreaId_workshop_processCode: { productionAreaId: area.id, workshop, processCode } },
        update: { plannedQty, completedQty: plannedQty, status: "COMPLETE", startedAt: completedAt, completedAt, lastReportedAt: completedAt, updatedBy: chairman.id },
        create: { orderId: order.id, productionAreaId: area.id, workshop, workshopLabel: WORKSHOP_LABELS[workshop as keyof typeof WORKSHOP_LABELS], processCode, processName, sequence: index + 1, plannedQty, completedQty: plannedQty, unit: "件", status: "COMPLETE", startedAt: completedAt, completedAt, lastReportedAt: completedAt, updatedBy: chairman.id },
      });
      const report = await prisma.productionReport.findFirst({ where: { productionProcessId: process.id, action: "COMPLETE" } });
      if (!report) await prisma.productionReport.create({ data: { orderId: order.id, productionAreaId: area.id, productionProcessId: process.id, action: "COMPLETE", completedQty: plannedQty, previousQty: 0, note: "区域批次发货条件快速验收样例：已跳过逐工序手工测试", reportedBy: chairman.id, reportedAt: completedAt } });
    }
  }

  const completionSubmission = await prisma.stageSubmission.findFirst({ where: { orderId: order.id, stage: "PRODUCTION", command: "COMPLETE_PRODUCTION" } });
  if (!completionSubmission) await prisma.stageSubmission.create({ data: { orderId: order.id, stage: "PRODUCTION", command: "COMPLETE_PRODUCTION", status: "SUBMITTED", payload: { source: "SHIPMENT_GATE_SAMPLE", completedWorkshops: ["PANEL", "WOOD", "PAINT", "ASSEMBLY"] }, comment: "本生产区域工序已完成，直接用于区域批次发货条件验收", submittedBy: chairman.id, submittedAt: completedAt } });

  const completionEvent = await prisma.orderEvent.findFirst({ where: { orderId: order.id, type: "DEMO_SKIP_TO_SHIPMENT_GATE" } });
  if (!completionEvent) await prisma.orderEvent.create({ data: { orderId: order.id, actorId: chairman.id, type: "DEMO_SKIP_TO_SHIPMENT_GATE", title: "生产区域完成", description: "快速验收样例：历史未分区区域全部工序已完成，订单等待区域发货", fromStage: "PRODUCTION", toStage: "DELIVERY", metadata: { sample: true, productionAreaId: area.id } } });

  await prisma.task.upsert({
    where: { uniqueKey: `${order.id}:DELIVERY` },
    update: { ownerId: orderAdmin.id, department: orderAdmin.department, title: "尾款确认后登记区域发货与本车次安装安排", stage: "DELIVERY", status: "PENDING" },
    create: { orderId: order.id, ownerId: orderAdmin.id, department: orderAdmin.department, title: "尾款确认后登记区域发货与本车次安装安排", stage: "DELIVERY", plannedStartAt: new Date("2026-08-30T09:00:00+08:00"), dueAt: new Date("2026-09-01T17:00:00+08:00"), reminderAt: new Date("2026-08-31T17:00:00+08:00"), uniqueKey: `${order.id}:DELIVERY` },
  });

  const verification = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    include: { productionProcesses: { select: { status: true, completedQty: true, plannedQty: true } } },
  });
  const expectedProcessCount = Object.values(WORKSHOP_PROCESS_TEMPLATES).reduce((total, steps) => total + steps.length, 0);
  const allProcessesComplete = verification.productionProcesses.length === expectedProcessCount
    && verification.productionProcesses.every((process) => process.status === "COMPLETE" && Number(process.completedQty) === Number(process.plannedQty));
  if (verification.stage !== "DELIVERY" || !allProcessesComplete || verification.tailPaymentConfirmed || verification.installationApplied) {
    throw new Error("区域批次发货条件快速验收样例校验失败");
  }

  console.log(`区域批次发货条件快速验收样例已就绪：${order.salesNumber} / ${area.productionNumber} / ${trackingSerial}；${expectedProcessCount} 道工序全部完成；尾款待办理，安装安排将在发货时填写`);
}

seedShipmentGateSample().finally(() => prisma.$disconnect());
