import { Inject, Injectable } from "@nestjs/common";
import { addCalendarDays, addInternalWorkingDays, calculateDelayDays, calculateSchedule, calculateTechnicalCapacitySlot, previousInternalWorkday } from "./domain/rules.js";
import type { SiteType, WorkflowStage } from "./domain/types.js";
import { PrismaService } from "./prisma.service.js";
import type { Prisma } from "./generated/prisma/client.js";
import { shanghaiBusinessDeadline } from "./domain/business-date.js";

type StagePlan = { department: string; title: string; days: number; role?: string };

@Injectable()
export class TaskScheduler {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  schedule(signedAt: Date, siteType: SiteType, rushPromisedAt?: Date | null) {
    return calculateSchedule(signedAt, siteType, rushPromisedAt);
  }

  async planDesign(orderId: string, acceptedAt: Date, leadDays: number, db: Prisma.TransactionClient = this.prisma) {
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    const dueAt = addInternalWorkingDays(acceptedAt, leadDays);
    await this.planDesignSubmission(orderId, dueAt, order.designAssignmentVersion, "设计提交", db);
    return dueAt;
  }

  async planDesignIntake(orderId: string, availableAt: Date, assignmentVersion: number, db: Prisma.TransactionClient = this.prisma) {
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    if (!order.designerId) return null;
    const dueAt = addCalendarDays(availableAt, 7);
    await this.upsertTask({ orderId, ownerId: order.designerId, stage: "DESIGN_PENDING", department: "设计部", title: "设计下单", dueAt, uniqueKey: `${orderId}:DESIGN_PENDING:v${assignmentVersion}` }, db);
    return dueAt;
  }

  async planDesignSubmission(orderId: string, dueAt: Date, assignmentVersion: number, title = "设计提交", db: Prisma.TransactionClient = this.prisma) {
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    if (!order.designerId) return null;
    return this.upsertTask({ orderId, ownerId: order.designerId, stage: "DESIGN_ACCEPTED", department: "设计部", title, dueAt, uniqueKey: `${orderId}:DESIGN_ACCEPTED:v${assignmentVersion}` }, db);
  }

  async cancelStage(orderId: string, stage: WorkflowStage, cancelledAt = new Date(), db: Prisma.TransactionClient = this.prisma) {
    const tasks = await db.task.findMany({ where: { orderId, stage, status: { in: ["PENDING", "OVERDUE"] } } });
    for (const task of tasks) {
      await db.task.update({ where: { id: task.id }, data: { status: "CANCELLED", completedAt: cancelledAt } });
      await db.notification.updateMany({ where: { uniqueKey: { startsWith: `${task.uniqueKey}:` }, readAt: null }, data: { readAt: cancelledAt } });
    }
    return { count: tasks.length };
  }

  async completeStage(orderId: string, stage: WorkflowStage, completedAt = new Date(), db: Prisma.TransactionClient = this.prisma) {
    const tasks = await db.task.findMany({ where: { orderId, stage, status: { in: ["PENDING", "OVERDUE"] } } });
    for (const task of tasks) {
      await db.task.update({ where: { id: task.id }, data: { status: "COMPLETE", completedAt, delayDays: calculateDelayDays(task.dueAt, completedAt) } });
      await db.notification.updateMany({ where: { uniqueKey: { startsWith: `${task.uniqueKey}:` }, readAt: null }, data: { readAt: completedAt } });
    }
    return { count: tasks.length };
  }

  async completeShipmentInstallation(orderId: string, shipmentId: string, completedAt = new Date(), db: Prisma.TransactionClient = this.prisma) {
    const uniqueKey = `${orderId}:INSTALLATION:${shipmentId}`;
    const task = await db.task.findUnique({ where: { uniqueKey } });
    if (!task || !["PENDING", "OVERDUE"].includes(task.status)) return { count: 0 };
    await db.task.update({ where: { id: task.id }, data: { status: "COMPLETE", completedAt, delayDays: calculateDelayDays(task.dueAt, completedAt) } });
    await db.notification.updateMany({ where: { uniqueKey: { startsWith: `${task.uniqueKey}:` }, readAt: null }, data: { readAt: completedAt } });
    return { count: 1 };
  }

  async completeProductionWorkshop(orderId: string, productionRouteId: string | null, workshop: string, completedAt = new Date(), db: Prisma.TransactionClient = this.prisma) {
    const uniqueKey = productionRouteId
      ? `${orderId}:PRODUCTION:${productionRouteId}:${workshop}`
      : `${orderId}:PRODUCTION:${workshop}`;
    const task = await db.task.findUnique({ where: { uniqueKey } });
    if (!task || !["PENDING", "OVERDUE"].includes(task.status)) return { count: 0 };
    await db.task.update({ where: { id: task.id }, data: { status: "COMPLETE", completedAt, delayDays: calculateDelayDays(task.dueAt, completedAt) } });
    await db.notification.updateMany({ where: { uniqueKey: { startsWith: `${task.uniqueKey}:` }, readAt: null }, data: { readAt: completedAt } });
    return { count: 1 };
  }

  async planProductionRoutes(orderId: string, routeIds: string[], db: Prisma.TransactionClient = this.prisma) {
    if (!routeIds.length) return;
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    const routes = await db.productionRoute.findMany({ where: { id: { in: routeIds }, orderId }, include: { productionProcesses: { select: { workshop: true } } } });
    const supervisors = await db.employee.findMany({ where: { role: "WORKSHOP", level: "SUPERVISOR", active: true, workshop: { not: null } } });
    const dueAt = order.productionDueAt ?? order.internalDueAt;
    for (const route of routes) {
      const workshops = new Set(route.productionProcesses.map((process) => process.workshop));
      for (const supervisor of supervisors.filter((candidate) => candidate.workshop && workshops.has(candidate.workshop))) {
        await this.upsertTask({ orderId, ownerId: supervisor.id, stage: "PRODUCTION", workshop: supervisor.workshop, department: supervisor.department, title: `${route.kind === "PANEL" ? "板式路线" : "实木油漆路线"}·${supervisor.department}生产`, dueAt, uniqueKey: `${orderId}:PRODUCTION:${route.id}:${supervisor.workshop}` }, db);
      }
    }
  }

  async planStage(orderId: string, stage: WorkflowStage, startedAt = new Date(), transaction?: Prisma.TransactionClient) {
    const db = transaction ?? this.prisma;
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    if (stage === "DESIGN_PENDING") {
      if (order.designerId && order.designIntakeAvailableAt) {
        const dueAt = order.designIntakeDueAt ?? addCalendarDays(order.designIntakeAvailableAt, 7);
        await this.upsertTask({ orderId, ownerId: order.designerId, stage, department: "设计部", title: "设计下单", dueAt, uniqueKey: `${orderId}:DESIGN_PENDING:v${order.designAssignmentVersion}` }, db);
      }
      return;
    }
    if (stage === "DESIGN_ACCEPTED") {
      const dueAt = order.designDueAt ?? order.internalDueAt;
      await this.planDesignSubmission(orderId, dueAt, order.designAssignmentVersion, "设计提交修订版本", db);
      return;
    }
    if (["DEPOSIT_PENDING", "BUSINESS_COMPLETE"].includes(stage)) return;
    if (stage === "MATERIALS" && order.productionExecutionMode === "ROUTE_V2") {
      const owner = await db.employee.findFirst({ where: { role: "PROCUREMENT", active: true }, orderBy: { employeeNo: "asc" } });
      const gates = await db.procurementRouteGate.findMany({ where: { orderId, completedAt: null }, orderBy: { kind: "asc" } });
      for (const gate of gates) {
        const label = gate.kind === "PANEL" ? "板式路线" : "实木油漆路线";
        await this.upsertTask({ orderId, ownerId: owner?.id ?? null, stage, department: "采购部", title: `完成${label}采购`, dueAt: gate.dueAt, uniqueKey: `${orderId}:MATERIALS:${gate.kind}` }, db);
      }
      return;
    }
    if (stage === "PRODUCTION") {
      const days = (order.finishType === "PAINT" ? 12 : 7) + (order.leatherDoor ? 5 : 0) + Math.max(0, order.villaFloors) * 10;
      const supervisors = await db.employee.findMany({ where: { role: "WORKSHOP", level: "SUPERVISOR", active: true, workshop: { not: null } } });
      for (const supervisor of supervisors) {
        await this.upsertTask({ orderId, ownerId: supervisor.id, stage, workshop: supervisor.workshop, department: supervisor.department, title: `${supervisor.department}生产`, dueAt: addInternalWorkingDays(startedAt, days), uniqueKey: `${orderId}:${stage}:${supervisor.workshop}` }, db);
      }
      return;
    }
    if (stage === "INSTALLATION") {
      const shipments = await db.shipment.findMany({
        where: { orderId, kind: "MANUFACTURED", installedAt: null, plannedInstallationAt: { not: null } },
        include: { areas: { select: { areaName: true, sequence: true } } },
        orderBy: { deliveredAt: "asc" },
      });
      if (shipments.length) {
        for (const shipment of shipments) {
          const areaLabel = shipment.areas.map((area) => `${area.areaName}第${area.sequence}车次`).join("、");
          await this.upsertTask({
            orderId,
            ownerId: shipment.assignedInstallerId,
            stage,
            department: "安装部",
            title: `${areaLabel || shipment.vehicle}安装`,
            dueAt: shanghaiBusinessDeadline(shipment.plannedInstallationAt!),
            uniqueKey: `${orderId}:INSTALLATION:${shipment.id}`,
          }, db);
        }
        return;
      }
    }
    if (stage === "ACCEPTANCE") {
      const shipment = await db.shipment.findFirst({ where: { orderId, kind: "MANUFACTURED", assignedInstallerId: { not: null } }, orderBy: { deliveredAt: "desc" }, select: { assignedInstallerId: true } });
      if (shipment?.assignedInstallerId) {
        await this.upsertTask({ orderId, ownerId: shipment.assignedInstallerId, stage, department: "安装部", title: "客户最终验收", dueAt: addInternalWorkingDays(startedAt, 1), uniqueKey: `${orderId}:ACCEPTANCE` }, db);
        return;
      }
    }
    const plans: Partial<Record<WorkflowStage, StagePlan>> = {
      PRE_REVIEW: { department: "订单中心", title: "前置审单", days: 1, role: "ORDER_ADMIN" },
      TECH_REVIEW: { department: "订单中心", title: "技术审单", days: 1, role: "ORDER_ADMIN" },
      MATERIALS: { department: "采购部", title: "完成全部采购", days: 15, role: "PROCUREMENT" },
      INSTALLATION_APPLICATION: { department: "订单中心", title: "历史发货安排", days: 1, role: "ORDER_ADMIN" },
      DELIVERY: { department: "订单中心", title: "区域发货批次", days: 3, role: "ORDER_ADMIN" },
      INSTALLATION: { department: "安装部", title: "发货批次安装", days: 3, role: "INSTALLER" },
      ACCEPTANCE: { department: "安装部", title: "客户验收", days: 1, role: "INSTALLER" },
    };
    if (stage === "TECHNICAL") {
      const owner = await db.employee.findFirst({ where: { role: "TECHNICAL", active: true }, orderBy: { employeeNo: "asc" } });
      if (!owner) return;
      const uniqueKey = `${orderId}:${stage}`;
      const allocate = async (tx: Prisma.TransactionClient) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`technical-capacity:${owner.id}`}))`;
        const lastTask = await tx.task.findFirst({
          where: {
            ownerId: owner.id,
            stage: "TECHNICAL",
            uniqueKey: { not: uniqueKey },
            status: { in: ["PENDING", "OVERDUE"] },
          },
          orderBy: { dueAt: "desc" },
        });
        const slot = calculateTechnicalCapacitySlot(startedAt, Number(order.amount), lastTask?.dueAt);
        const reminderAt = previousInternalWorkday(slot.dueAt);
        reminderAt.setHours(17, 0, 0, 0);
        await tx.task.upsert({
          where: { uniqueKey },
          create: {
            orderId,
            ownerId: owner.id,
            stage,
            department: "技术部",
            title: "技术拆单",
            dueAt: slot.dueAt,
            plannedStartAt: slot.plannedStartAt,
            workloadDays: slot.workloadDays,
            reminderAt,
            uniqueKey,
          },
          update: {
            ownerId: owner.id,
            dueAt: slot.dueAt,
            plannedStartAt: slot.plannedStartAt,
            workloadDays: slot.workloadDays,
            reminderAt,
            status: "PENDING",
            completedAt: null,
            reminderSentAt: null,
            escalatedAt: null,
            delayDays: 0,
          },
        });
      };
      if (transaction) await allocate(transaction); else await this.prisma.$transaction(allocate);
      return;
    }
    const plan = plans[stage];
    if (!plan) return;
    const owner = plan.role ? await db.employee.findFirst({ where: { role: plan.role as never, active: true }, orderBy: { employeeNo: "asc" } }) : null;
    await this.upsertTask({ orderId, ownerId: owner?.id ?? null, stage, department: plan.department, title: plan.title, dueAt: addInternalWorkingDays(startedAt, plan.days), uniqueKey: `${orderId}:${stage}` }, db);
  }

  private async upsertTask(input: { orderId: string; ownerId?: string | null; stage: WorkflowStage; workshop?: string | null; department: string; title: string; dueAt: Date; uniqueKey: string }, db: Prisma.TransactionClient = this.prisma) {
    const reminderAt = previousInternalWorkday(input.dueAt);
    reminderAt.setHours(17, 0, 0, 0);
    const now = new Date();
    const overdue = input.dueAt < now;
    const taskState = { status: overdue ? "OVERDUE" as const : "PENDING" as const, completedAt: null, reminderSentAt: null, escalatedAt: overdue ? now : null, delayDays: overdue ? calculateDelayDays(input.dueAt, now) : 0 };
    return db.task.upsert({ where: { uniqueKey: input.uniqueKey }, create: { ...input, reminderAt, ...taskState }, update: { ownerId: input.ownerId, department: input.department, title: input.title, workshop: input.workshop, dueAt: input.dueAt, reminderAt, ...taskState } });
  }
}
