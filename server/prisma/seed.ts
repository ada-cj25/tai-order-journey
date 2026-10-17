import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "bcryptjs";
import { PrismaClient, type Role } from "../generated/prisma/client.js";
import { LOCAL_DESIGNERS } from "../domain/local-designer-roster.js";
import { LOCAL_WORKERS } from "../domain/local-worker-roster.js";

if (process.env.NODE_ENV === "production") throw new Error("禁止在生产环境运行演示数据 seed");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL 未配置");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const employees: Array<{ employeeNo: string; username: string; name: string; department: string; role: Role; level?: string; businessUnit?: string; workshop?: string; processCode?: string; processCodes?: string[] }> = [
  { employeeNo: "A001", username: "chairman", name: "董事长管理员", department: "管理层", role: "CHAIRMAN" },
  { employeeNo: "A002", username: "orderadmin", name: "订单管理员", department: "订单中心", role: "ORDER_ADMIN" },
  { employeeNo: "F001", username: "finance", name: "财务王姐", department: "财务部", role: "FINANCE" },
  { employeeNo: "S001", username: "sales", name: "销售郑佳", department: "诺尔丽销售部", role: "SALES", businessUnit: "NOERLI" },
  { employeeNo: "S002", username: "sales2", name: "销售陈珊", department: "诺尔丽销售部", role: "SALES", businessUnit: "NOERLI" },
  { employeeNo: "S010", username: "salesmanager", name: "诺尔丽销售主管", department: "诺尔丽销售部", role: "SALES", level: "SUPERVISOR", businessUnit: "NOERLI" },
  { employeeNo: "S020", username: "aikejumgr", name: "艾可居销售主管", department: "艾可居销售部", role: "SALES", level: "SUPERVISOR", businessUnit: "AIKEJU" },
  { employeeNo: "D001", username: "designer", name: "设计师郑思雁", department: "设计部", role: "DESIGNER" },
  ...LOCAL_DESIGNERS,
  { employeeNo: "T001", username: "technical", name: "技术陈工", department: "技术部", role: "TECHNICAL" },
  { employeeNo: "P001", username: "procurement", name: "采购李姐", department: "采购部", role: "PROCUREMENT" },
  { employeeNo: "W001", username: "workshop", name: "板式车间主管", department: "板式车间", role: "WORKSHOP", level: "SUPERVISOR", workshop: "PANEL" },
  { employeeNo: "W002", username: "woodmanager", name: "木工车间主管", department: "木工车间", role: "WORKSHOP", level: "SUPERVISOR", workshop: "WOOD" },
  { employeeNo: "W003", username: "paintmanager", name: "油漆车间主管", department: "油漆车间", role: "WORKSHOP", level: "SUPERVISOR", workshop: "PAINT" },
  { employeeNo: "W004", username: "assemblymanager", name: "组装车间主管", department: "组装车间", role: "WORKSHOP", level: "SUPERVISOR", workshop: "ASSEMBLY" },
  ...LOCAL_WORKERS,
  { employeeNo: "I001", username: "installer", name: "安装队长", department: "安装部", role: "INSTALLER" },
  { employeeNo: "C001", username: "aftersales", name: "售后客服", department: "售后部", role: "AFTERSALES" },
];

async function seed() {
  const passwordHash = await hash("erp123456", 10);
  await prisma.employee.updateMany({ where: { username: "warehouse" }, data: { active: false } });
  for (const employee of employees) {
    await prisma.employee.upsert({ where: { username: employee.username }, update: employee, create: { ...employee, passwordHash } });
  }
  const sales = await prisma.employee.findUniqueOrThrow({ where: { username: "sales" } });
  const designer = await prisma.employee.findUniqueOrThrow({ where: { username: "designer" } });
  const sample = await prisma.order.upsert({
    where: { trackingSerial: "GD-260801-0001" },
    update: {},
    create: {
      trackingSerial: "GD-260801-0001",
      salesNumber: "TEST-SALES-DELIVERY",
      productionNumber: "TEST-DEMO-DELIVERY",
      legacyOrderNumber: "2201101",
      businessType: "NOERLI_FORMAL",
      siteType: "FINISHED",
      customerName: "李女士",
      customerPhone: "138****6028",
      address: "宁波市鄞州区示例小区 2-1101",
      amount: 286000,
      signedAt: new Date("2026-08-01T10:00:00+08:00"),
      standardDueAt: new Date("2026-09-03T17:00:00+08:00"),
      promisedAt: new Date("2026-09-03T17:00:00+08:00"),
      internalDueAt: new Date("2026-09-03T17:00:00+08:00"),
      stage: "INSTALLATION_APPLICATION",
      currentOwnerLabel: "订单管理员",
      nextAction: "确认尾款后登记发货及本车次安装安排",
      depositConfirmed: true,
      productionReady: true,
      hardwareReady: false,
      outsourceReady: true,
      riskCount: 1,
      salesId: sales.id,
      designerId: designer.id,
      events: {
        create: [
          { actorId: sales.id, type: "ORDER_CREATED", title: "销售签约建单", description: "合同与定金凭证已提交", toStage: "DEPOSIT_PENDING" },
          { actorId: designer.id, type: "SUBMIT_DESIGN", title: "设计师正式提交", description: "演示编号 TEST-DEMO-DELIVERY，不占用正式生产流水", fromStage: "DESIGN_ACCEPTED", toStage: "PRE_REVIEW" },
          { actorId: designer.id, type: "PRODUCTION_COMPLETE", title: "四车间生产完成", description: "板式、木工、油漆、组装已全部完成", fromStage: "PRODUCTION", toStage: "INSTALLATION_APPLICATION" },
        ],
      },
    },
  });
  const sampleArea = await prisma.productionArea.upsert({
    where: { productionNumber: "TEST-DEMO-DELIVERY" },
    update: {},
    create: { orderId: sample.id, name: "历史未分区区域", sequence: 1, productionNumber: "TEST-DEMO-DELIVERY", status: "PRODUCTION_COMPLETE", createdBy: designer.id },
  });
  // Demo identities live outside the formal number pools. Existing samples keep
  // their assigned numbers; never raise or reset a business counter from seed.
  const inventory = [
    { sku: "STD-GLUE-01", name: "环保白胶", unit: "桶", mode: "STOCK_STANDARD" as const, onHand: 6, minimumStock: 10, targetStock: 30, replenishmentLot: 20, approvedStandard: true },
    { sku: "STD-HINGE-01", name: "通用缓冲铰链", unit: "个", mode: "STOCK_STANDARD" as const, onHand: 360, minimumStock: 200, targetStock: 600, replenishmentLot: 200, approvedStandard: true },
    { sku: "ORD-BOARD-22", name: "22mm 环保板材", unit: "张", mode: "ORDER_SPECIFIC" as const, onHand: 18, approvedStandard: false },
  ];
  const noerliStandards = [
    ["挂衣杆的管座", "个"], ["大调整脚+扣子", "套"], ["塑料搁板销", "只"], ["搁板销堵塞", "只"], ["木榫", "只"], ["新款偏心", "只"], ["偏心盖", "只"], ["新款二合一", "只"], ["防撞粒", "只"], ["小角铁", "只"], ["下水管套", "只"], ["80mm长膨胀螺丝", "只"], ["膨胀螺丝盖帽", "只"], ["自攻螺丝（长）", "只"], ["自攻螺丝（短）", "只"], ["变压器150w", "个"], ["杜邦线", "根"], ["人体感应开关", "个"], ["手扫感应开关", "个"], ["双开门门碰感应开关", "个"], ["单开门门碰感应开关", "个"], ["保护膜", "支"], ["软胶", "支"],
  ].map(([name, unit], index) => ({ sku: `NL-STD-${String(index + 1).padStart(3, "0")}`, name: name!, unit: unit!, mode: "STOCK_STANDARD" as const, onHand: 100, minimumStock: 30, targetStock: 100, replenishmentLot: 50, approvedStandard: true }));
  inventory.push(...noerliStandards);
  for (const item of inventory) await prisma.inventoryItem.upsert({ where: { sku: item.sku }, update: item, create: item });
  const suppliers = [
    { code: "SUP-BOARD-01", name: "宁波示例板材供应商", contact: "王经理", phone: "13800000001" },
    { code: "SUP-HARDWARE-01", name: "浙江示例五金供应商", contact: "陈经理", phone: "13800000002" },
  ];
  for (const supplier of suppliers) await prisma.supplier.upsert({ where: { code: supplier.code }, update: supplier, create: supplier });
  const reviewer = await prisma.employee.findUniqueOrThrow({ where: { username: "orderadmin" } });
  const technical = await prisma.employee.findUniqueOrThrow({ where: { username: "technical" } });
  await prisma.task.updateMany({ where: { stage: "TECH_REVIEW", status: { in: ["PENDING", "OVERDUE"] } }, data: { ownerId: reviewer.id, department: reviewer.department, title: "技术三件套复核" } });

  const reviewSample = await prisma.order.upsert({
    where: { trackingSerial: "GD-260829-M001" },
    update: {},
    create: {
      trackingSerial: "GD-260829-M001",
      salesNumber: "TEST-SALES-MATERIAL",
      productionNumber: "TEST-DEMO-MATERIAL",
      businessType: "NOERLI_FORMAL",
      siteType: "FINISHED",
      customerName: "采购联调样例（匿名）",
      customerPhone: "138****0000",
      address: "宁波市匿名测试项目",
      amount: 120000,
      signedAt: new Date("2026-08-20T10:00:00+08:00"),
      standardDueAt: new Date("2026-09-22T17:00:00+08:00"),
      promisedAt: new Date("2026-09-22T17:00:00+08:00"),
      internalDueAt: new Date("2026-09-22T17:00:00+08:00"),
      productionDueAt: new Date("2026-09-22T17:00:00+08:00"),
      stage: "TECH_REVIEW",
      currentOwnerLabel: "订单管理员",
      nextAction: "技术审单并确认生产资料",
      depositConfirmed: true,
      depositReported: true,
      materialSubstatus: "待技术审单",
      salesId: sales.id,
      designerId: designer.id,
      events: {
        create: { actorId: technical.id, type: "SUBMIT_TECHNICAL", title: "拆单三件套已提交", description: "匿名固定样例：海迅单、分解单、物料单 V1", fromStage: "TECHNICAL", toStage: "TECH_REVIEW" },
      },
    },
  });
  const reviewArea = await prisma.productionArea.upsert({
    where: { productionNumber: "TEST-DEMO-MATERIAL" },
    update: {},
    create: { orderId: reviewSample.id, name: "历史未分区区域", sequence: 1, productionNumber: "TEST-DEMO-MATERIAL", status: "TECH_REVIEW_LOCKED", createdBy: technical.id },
  });
  const demoAttachments = [
    { id: "demo-review-haixun", category: "HAIXUN_EXPORT", originalName: "匿名样例-海迅导出.xlsx", storageKey: "seed/demo-review-haixun.xlsx" },
    { id: "demo-review-decomposition", category: "DECOMPOSITION_SHEET", originalName: "匿名样例-分解单.xlsx", storageKey: "seed/demo-review-decomposition.xlsx" },
    { id: "demo-review-material", category: "MATERIAL_SHEET", originalName: "匿名样例-物料单.xlsx", storageKey: "seed/demo-review-material.xlsx" },
  ];
  for (const attachment of demoAttachments) {
    await prisma.attachment.upsert({
      where: { id: attachment.id },
      update: {},
      create: { ...attachment, orderId: reviewSample.id, productionAreaId: reviewArea.id, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 1024, uploadedBy: technical.id },
    });
  }
  const reviewPackage = await prisma.technicalPackageVersion.upsert({
    where: { productionAreaId_version: { productionAreaId: reviewArea.id, version: 1 } },
    update: {},
    create: {
      orderId: reviewSample.id,
      productionAreaId: reviewArea.id,
      version: 1,
      designVersion: "V1",
      haixunAttachmentId: "demo-review-haixun",
      decompositionAttachmentId: "demo-review-decomposition",
      materialAttachmentId: "demo-review-material",
      validationSummary: "固定匿名样例：板材面积和五金数量已校验；无公式错误行。",
      rowCount: 3,
      submittedBy: technical.id,
    },
  });
  const demoMaterialRows = [
    { sourceFileName: "匿名样例-物料单.xlsx", sourceSheet: "物料单", sourceRow: 8, sourceSubRow: "A", templateType: "HARDWARE_MATERIALS", parserVersion: "V2.0", rawName: "柜身厚板", rawSpecification: "18mm 多层板", rawUnit: "m²", rawActualValue: "85", rawPurchaseValue: "100", normalizedName: "柜身厚板", specification: "18mm 多层板", unit: "㎡", category: "BOARD", actualQty: 85, lossRate: 0.85, purchaseQty: 100, calculationSource: "CALCULATED", inventoryMode: "ORDER_SPECIFIC", readinessClass: "PRODUCTION_REQUIRED", needsManualReview: false, manualReason: null },
    { sourceFileName: "匿名样例-物料单.xlsx", sourceSheet: "物料单", sourceRow: 24, sourceSubRow: "A", templateType: "HARDWARE_MATERIALS", parserVersion: "V2.0", rawName: "金属板", rawSpecification: "18mm", rawUnit: "m²", rawActualValue: "9", rawPurchaseValue: "10", normalizedName: "金属板", specification: "18mm", unit: "㎡", category: "METAL_BOARD", actualQty: 9, lossRate: 0.9, purchaseQty: 10, calculationSource: "CALCULATED", inventoryMode: "ORDER_SPECIFIC", readinessClass: "PRODUCTION_REQUIRED", needsManualReview: false, manualReason: null },
    { sourceFileName: "匿名样例-物料单.xlsx", sourceSheet: "物料单", sourceRow: 61, sourceSubRow: "A", templateType: "HARDWARE_MATERIALS", parserVersion: "V2.0", rawName: "木榫", rawSpecification: null, rawUnit: "只", rawActualValue: "40", rawPurchaseValue: "40", normalizedName: "木榫", specification: null, unit: "只", category: "HARDWARE", actualQty: 40, lossRate: null, purchaseQty: 40, calculationSource: "SOURCE_VALUE", inventoryMode: "STOCK_STANDARD", readinessClass: "DELIVERY_READINESS", needsManualReview: false, manualReason: null },
  ];
  for (const templateType of ["HARDWARE_MATERIALS"] as const) await prisma.materialImportBatch.upsert({
    where: { technicalPackageId_templateType: { technicalPackageId: reviewPackage.id, templateType } },
    update: {},
    create: {
      orderId: reviewSample.id,
      productionAreaId: reviewArea.id,
      technicalPackageId: reviewPackage.id,
      templateType,
      fingerprintVersion: "LEGACY-SEED-V2",
      sourceProductionNumber: reviewArea.productionNumber,
      valid: true,
      sourceAttachmentId: "demo-review-material",
      fileName: "匿名样例-物料单.xlsx",
      sheetName: templateType === "HARDWARE_MATERIALS" ? "物料单" : "下料单",
      status: "DRAFT",
      rawRows: [],
      normalizedRows: templateType === "HARDWARE_MATERIALS" ? demoMaterialRows : [],
      errors: [],
      createdBy: technical.id,
    },
  });
  await prisma.task.upsert({
    where: { uniqueKey: `${reviewSample.id}:TECH_REVIEW` },
    update: reviewPackage.status === "SUBMITTED" ? { ownerId: reviewer.id, department: reviewer.department, title: "技术审单", status: "PENDING" } : {},
    create: {
      orderId: reviewSample.id,
      ownerId: reviewer.id,
      department: reviewer.department,
      title: "技术审单",
      stage: "TECH_REVIEW",
      plannedStartAt: new Date("2026-08-29T09:00:00+08:00"),
      dueAt: new Date("2026-08-31T17:00:00+08:00"),
      reminderAt: new Date("2026-08-29T17:00:00+08:00"),
      uniqueKey: `${reviewSample.id}:TECH_REVIEW`,
    },
  });
  console.log(`Seed complete: ${employees.length} employees, samples ${sample.productionNumber} / ${reviewSample.productionNumber}. Password: erp123456`);
}

seed().finally(() => prisma.$disconnect());
