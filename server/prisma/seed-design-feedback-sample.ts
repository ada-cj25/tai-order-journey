import { PrismaService } from "../prisma.service.js";

const prisma = new PrismaService();
const trackingSerial = "TEST-DESIGN-FEEDBACK-20260909";

try {
  const [sales, designer] = await Promise.all([
    prisma.employee.findUniqueOrThrow({ where: { username: "noerlisales1" } }),
    prisma.employee.findUniqueOrThrow({ where: { username: "designer" } }),
  ]);
  const signedAt = new Date("2026-09-09T09:00:00+08:00");
  const promisedAt = new Date("2026-11-09T17:00:00+08:00");
  await prisma.order.upsert({
    where: { trackingSerial },
    update: { stage: "DESIGN_PENDING", currentOwnerLabel: "设计师", nextAction: "设计师下单", designerId: designer.id, depositReported: true, depositConfirmed: true, prepaymentRequired: true, prepaymentReported: true, prepaymentConfirmed: true },
    create: {
      trackingSerial,
      businessType: "NOERLI_FORMAL",
      siteType: "FINISHED",
      customerName: "设计反馈验收样例",
      customerPhone: "TEST-NOT-A-PHONE",
      address: "本地测试数据，不对应真实客户",
      amount: 10000,
      signedAt,
      standardDueAt: promisedAt,
      promisedAt,
      internalDueAt: promisedAt,
      stage: "DESIGN_PENDING",
      currentOwnerLabel: "设计师",
      nextAction: "设计师下单",
      depositReported: true,
      depositConfirmed: true,
      prepaymentRequired: true,
      prepaymentReported: true,
      prepaymentConfirmed: true,
      salesId: sales.id,
      designerId: designer.id,
      events: { create: { actorId: sales.id, type: "TEST_SAMPLE_CREATED", title: "本地设计反馈验收样例", description: "用于检查设计下单命名、无退回入口及紧凑表单", toStage: "DESIGN_PENDING" } },
    },
  });
  console.log(`Ready: ${trackingSerial}`);
} finally {
  await prisma.onModuleDestroy();
}
