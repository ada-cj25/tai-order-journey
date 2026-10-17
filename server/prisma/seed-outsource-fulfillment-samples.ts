import "dotenv/config";
import { PrismaService } from "../prisma.service.js";
import { localTestAccountsEnabled } from "../runtime-config.js";
import { WORKSHOP_LABELS, WORKSHOP_PROCESS_TEMPLATES } from "../domain/workshop-processes.js";

if (!localTestAccountsEnabled()) throw new Error("此样例仅允许写入本地非生产数据库");

const db = new PrismaService();
const now = new Date();

type Stage = "PRODUCTION" | "DELIVERY" | "INSTALLATION";
type Mode = "NONE" | "REQUIRED";

async function createOrder(input: {
  trackingSerial: string;
  salesNumber: string;
  customerName: string;
  stage: Stage;
  mode: Mode;
  salesId: string;
  designerId: string;
  chairmanId: string;
  installationApplied: boolean;
}) {
  return db.order.create({ data: {
    trackingSerial: input.trackingSerial,
    salesNumber: input.salesNumber,
    businessType: "NOERLI_FORMAL",
    siteType: "FINISHED",
    customerName: input.customerName,
    customerPhone: "LOCAL-TEST-ONLY",
    address: "本地外购履约验收样例（无真实客户数据）",
    amount: 128000,
    signedAt: now,
    standardDueAt: new Date("2026-10-20T17:00:00+08:00"),
    promisedAt: new Date("2026-10-20T17:00:00+08:00"),
    internalDueAt: new Date("2026-10-20T17:00:00+08:00"),
    productionDueAt: new Date("2026-10-15T17:00:00+08:00"),
    stage: input.stage,
    currentOwnerLabel: input.stage === "INSTALLATION" ? "安装部" : input.stage === "DELIVERY" ? "订单管理员" : "生产车间",
    nextAction: input.stage === "INSTALLATION" ? "继续现场施工；外购产品全部发货后完成安装" : input.stage === "DELIVERY" ? "登记定制产品区域发货批次" : "继续四车间生产",
    depositReported: true,
    depositConfirmed: true,
    prepaymentRequired: false,
    tailPaymentReported: true,
    tailPaymentConfirmed: true,
    installationApplied: input.installationApplied,
    procurementPlanned: true,
    procurementStartedAt: new Date("2026-09-01T09:00:00+08:00"),
    procurementDueAt: new Date("2026-09-18T17:00:00+08:00"),
    procurementCompletedAt: now,
    procurementCompletedBy: input.chairmanId,
    materialSubstatus: "外购履约验收样例 · 全部采购已完成",
    salesId: input.salesId,
    designerId: input.designerId,
    outsourceRequirementMode: input.mode,
  } });
}

async function createArea(orderId: string, chairmanId: string, productionNumber: string, complete: boolean) {
  const area = await db.productionArea.create({ data: {
    orderId,
    name: "客厅",
    sequence: 1,
    productionNumber,
    status: complete ? "PRODUCTION_COMPLETE" : "PRODUCTION",
    productionCompletedAt: complete ? now : null,
    createdBy: chairmanId,
  } });
  for (const workshop of ["PANEL", "ASSEMBLY"] as const) {
    for (const [index, processName] of WORKSHOP_PROCESS_TEMPLATES[workshop].entries()) {
      const done = complete;
      await db.productionProcess.create({ data: {
        orderId,
        productionAreaId: area.id,
        workshop,
        workshopLabel: WORKSHOP_LABELS[workshop],
        processCode: `${workshop}-${String(index + 1).padStart(2, "0")}`,
        processName,
        sequence: index + 1,
        plannedQty: 10,
        completedQty: done ? 10 : workshop === "PANEL" && index === 0 ? 4 : 0,
        status: done ? "COMPLETE" : workshop === "PANEL" && index === 0 ? "IN_PROGRESS" : "PENDING",
        startedAt: done || (workshop === "PANEL" && index === 0) ? now : null,
        completedAt: done ? now : null,
        lastReportedAt: done || (workshop === "PANEL" && index === 0) ? now : null,
        updatedBy: done || (workshop === "PANEL" && index === 0) ? chairmanId : null,
      } });
    }
  }
  return area;
}

async function createRequirement(orderId: string, technicalId: string, reviewerId: string, lines: Array<{ name: string; plannedQty: number; usageArea?: string }>) {
  const version = await db.outsourceRequirementVersion.create({ data: {
    orderId,
    version: 1,
    status: "APPROVED",
    declaresNone: false,
    submittedBy: technicalId,
    submittedAt: now,
    reviewedBy: reviewerId,
    reviewedAt: now,
  } });
  const created = [];
  for (const [index, line] of lines.entries()) {
    created.push(await db.outsourceProductLine.create({ data: {
      orderId,
      requirementVersionId: version.id,
      name: line.name,
      plannedQty: line.plannedQty,
      unit: "件",
      usageArea: line.usageArea ?? null,
      sequence: index + 1,
    } }));
  }
  return created;
}

async function recordArrival(lineId: string, quantity: number, arrivedOn: string, procurementId: string) {
  return db.outsourceArrival.create({ data: { productLineId: lineId, quantity, arrivedOn: new Date(`${arrivedOn}T00:00:00+08:00`), confirmedBy: procurementId } });
}

async function shipOutsource(orderId: string, line: { id: string; name: string; plannedQty: unknown; unit: string; usageArea: string | null }, adminId: string) {
  return db.shipment.create({ data: {
    orderId,
    kind: "OUTSOURCED",
    vehicle: "浙B·TEST / 张师傅",
    deliveredAt: now,
    pieceCount: Number(line.plannedQty),
    submittedBy: adminId,
    outsourceLines: { create: { productLineId: line.id, productName: line.name, plannedQty: Number(line.plannedQty), unit: line.unit, usageArea: line.usageArea } },
  } });
}

async function shipManufactured(orderId: string, area: { id: string; name: string; productionNumber: string }, adminId: string) {
  await db.shipment.create({ data: {
    orderId,
    kind: "MANUFACTURED",
    vehicle: "浙B·CUSTOM / 李师傅",
    deliveredAt: now,
    pieceCount: 10,
    submittedBy: adminId,
    areas: { create: { productionAreaId: area.id, productionNumber: area.productionNumber, areaName: area.name } },
  } });
  await db.productionArea.update({ where: { id: area.id }, data: { status: "SHIPPED", shippedAt: now } });
}

async function seed() {
  const [sales, designer, chairman, technical, orderAdmin, procurement, installer] = await Promise.all([
    db.employee.findUniqueOrThrow({ where: { username: "sales" } }),
    db.employee.findUniqueOrThrow({ where: { username: "designer" } }),
    db.employee.findUniqueOrThrow({ where: { username: "chairman" } }),
    db.employee.findUniqueOrThrow({ where: { username: "technical" } }),
    db.employee.findUniqueOrThrow({ where: { username: "orderadmin" } }),
    db.employee.findUniqueOrThrow({ where: { username: "procurement" } }),
    db.employee.findUniqueOrThrow({ where: { username: "installer" } }),
  ]);

  const common = { salesId: sales.id, designerId: designer.id, chairmanId: chairman.id };

  if (!await db.order.findUnique({ where: { trackingSerial: "TEST-OUTSOURCE-NONE-20260909" } })) {
    const order = await createOrder({ ...common, trackingSerial: "TEST-OUTSOURCE-NONE-20260909", salesNumber: "TEST-SALES-OUTSOURCE-NONE", customerName: "无外购原流程验收样例", stage: "DELIVERY", mode: "NONE", installationApplied: true });
    await createArea(order.id, chairman.id, "TEST-AREA-OUTSOURCE-NONE-01", true);
  }

  if (!await db.order.findUnique({ where: { trackingSerial: "TEST-OUTSOURCE-SPLIT-20260909" } })) {
    const order = await createOrder({ ...common, trackingSerial: "TEST-OUTSOURCE-SPLIT-20260909", salesNumber: "TEST-SALES-OUTSOURCE-SPLIT", customerName: "两种外购分次到货验收样例", stage: "PRODUCTION", mode: "REQUIRED", installationApplied: false });
    await createArea(order.id, chairman.id, "TEST-AREA-OUTSOURCE-SPLIT-01", false);
    const [door, cabinet] = await createRequirement(order.id, technical.id, orderAdmin.id, [{ name: "铝框玻璃门", plannedQty: 4, usageArea: "客厅" }, { name: "铝蜂窝柜", plannedQty: 2, usageArea: "阳台" }]);
    await recordArrival(door!.id, 2, "2026-09-08", procurement.id);
    await recordArrival(door!.id, 2, "2026-09-09", procurement.id);
    await recordArrival(cabinet!.id, 1, "2026-09-09", procurement.id);
  }

  if (!await db.order.findUnique({ where: { trackingSerial: "TEST-OUTSOURCE-FIRST-20260909" } })) {
    const order = await createOrder({ ...common, trackingSerial: "TEST-OUTSOURCE-FIRST-20260909", salesNumber: "TEST-SALES-OUTSOURCE-FIRST", customerName: "外购先于定制发货验收样例", stage: "PRODUCTION", mode: "REQUIRED", installationApplied: false });
    await createArea(order.id, chairman.id, "TEST-AREA-OUTSOURCE-FIRST-01", false);
    const [door] = await createRequirement(order.id, technical.id, reviewer.id, [{ name: "外购爱格门", plannedQty: 3, usageArea: "主卧" }]);
    await recordArrival(door!.id, 3, "2026-09-08", procurement.id);
    await shipOutsource(order.id, door!, orderAdmin.id);
  }

  if (!await db.order.findUnique({ where: { trackingSerial: "TEST-OUTSOURCE-INSTALL-BLOCK-20260909" } })) {
    const order = await createOrder({ ...common, trackingSerial: "TEST-OUTSOURCE-INSTALL-BLOCK-20260909", salesNumber: "TEST-SALES-OUTSOURCE-INSTALL-BLOCK", customerName: "外购未发阻止安装完成样例", stage: "INSTALLATION", mode: "REQUIRED", installationApplied: true });
    const area = await createArea(order.id, chairman.id, "TEST-AREA-OUTSOURCE-INSTALL-01", true);
    await shipManufactured(order.id, area, orderAdmin.id);
    const [door] = await createRequirement(order.id, technical.id, reviewer.id, [{ name: "涂料门", plannedQty: 2, usageArea: "儿童房" }]);
    await recordArrival(door!.id, 2, "2026-09-09", procurement.id);
  }

  const installationOrder = await db.order.findUniqueOrThrow({ where: { trackingSerial: "TEST-OUTSOURCE-INSTALL-BLOCK-20260909" } });
  await db.task.upsert({
    where: { uniqueKey: `${installationOrder.id}:INSTALLATION:OUTSOURCE-SAMPLE` },
    update: { ownerId: installer.id, department: installer.department, title: "安装验收样例", stage: "INSTALLATION", status: "PENDING" },
    create: { orderId: installationOrder.id, ownerId: installer.id, department: installer.department, title: "安装验收样例", stage: "INSTALLATION", status: "PENDING", dueAt: new Date("2026-10-20T17:00:00+08:00"), reminderAt: new Date("2026-10-19T17:00:00+08:00"), uniqueKey: `${installationOrder.id}:INSTALLATION:OUTSOURCE-SAMPLE` },
  });

  console.log("外购履约验收样例已就绪：无外购、分次到货、外购先发、外购阻止安装完成。");
}

seed().finally(() => db.$disconnect());
