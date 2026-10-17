import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../server/generated/prisma/client.js";
import { hash } from "bcryptjs";
import { customerDemoEnabled } from "../server/runtime-config.js";

if (!customerDemoEnabled()) throw new Error("只允许向本地隔离客服 Demo 数据库写入虚构样本");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const passwordHash = await hash("customer-demo-123", 10);

try {
  const admin = await prisma.employee.upsert({
    where: { username: "customer_demo_admin" },
    update: {},
    create: {
      employeeNo: "TEST-DEMO-ADMIN", username: "customer_demo_admin", name: "客服演示管理员",
      department: "订单中心", role: "ORDER_ADMIN", passwordHash,
    },
  });
  const sales = await prisma.employee.upsert({
    where: { username: "customer_demo_sales" },
    update: {},
    create: {
      employeeNo: "TEST-DEMO-SALES", username: "customer_demo_sales", name: "客服演示销售",
      department: "诺尔丽销售部", role: "SALES", businessUnit: "NOERLI", passwordHash,
    },
  });
  const cases = [
    { suffix: "01", phone: "13800000001", customer: "测试客户甲", stage: "PRODUCTION" as const, area: "客厅柜", completed: false },
    { suffix: "02", phone: "13800000002", customer: "测试客户乙", stage: "DELIVERY" as const, area: "卧室柜", completed: true },
    { suffix: "03", phone: "13800000001", customer: "测试客户甲", stage: "DESIGN_PENDING" as const, area: null, completed: false },
  ];
  for (const sample of cases) {
    const trackingSerial = "TEST-DEMO-CUSTOMER-" + sample.suffix;
    const order = await prisma.order.upsert({
      where: { trackingSerial },
      update: {},
      create: {
        trackingSerial,
        salesNumber: "TEST-SALES-CUSTOMER-" + sample.suffix,
        businessType: "NOERLI_FORMAL",
        siteType: "FINISHED",
        customerName: sample.customer,
        customerPhone: sample.phone,
        address: "本地虚构小区 " + sample.suffix + " 号",
        signedAt: new Date("2026-10-01T10:00:00+08:00"),
        standardDueAt: new Date("2026-11-30T17:00:00+08:00"),
        promisedAt: new Date("2026-11-30T17:00:00+08:00"),
        internalDueAt: new Date("2026-11-20T17:00:00+08:00"),
        stage: sample.stage,
        currentOwnerLabel: "本地虚构演示",
        nextAction: "仅供客服功能测试",
        salesId: sales.id,
      },
    });
    if (sample.area) {
      await prisma.productionArea.upsert({
        where: { productionNumber: "TEST-DEMO-AREA-" + sample.suffix },
        update: {},
        create: {
          orderId: order.id, name: sample.area, sequence: 1,
          productionNumber: "TEST-DEMO-AREA-" + sample.suffix,
          createdBy: admin.id, status: "APPROVED",
          productionCompletedAt: sample.completed ? new Date("2026-10-10T15:00:00+08:00") : null,
          shippedAt: sample.completed ? new Date("2026-10-12T15:00:00+08:00") : null,
        },
      });
    }
    if (sample.suffix === "02" && !await prisma.shipment.findFirst({ where: { orderId: order.id } })) {
      await prisma.shipment.create({
        data: {
          orderId: order.id, kind: "MANUFACTURED", vehicle: "TEST-DEMO-VEHICLE",
          deliveredAt: new Date("2026-10-12T12:00:00+08:00"),
          submittedBy: admin.id,
        },
      });
    }
    if (sample.suffix !== "03") {
      const customer = await prisma.customerAccount.upsert({ where: { phone: sample.phone }, update: {}, create: { phone: sample.phone } });
      await prisma.customerOrderGrant.upsert({
        where: { customerId_orderId: { customerId: customer.id, orderId: order.id } },
        update: {},
        create: { customerId: customer.id, orderId: order.id, approvedById: admin.id, reason: "本地虚构样本预授权" },
      });
    }
  }
  console.log("客服 Demo 样本已就绪：两笔已授权订单、一笔待绑定订单。重复运行不会覆盖现有样本。");
} finally {
  await prisma.$disconnect();
}
