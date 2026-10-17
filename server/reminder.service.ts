import { Inject, Injectable } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { calculateDelayDays } from "./domain/rules.js";
import { PrismaService } from "./prisma.service.js";

@Injectable()
export class ReminderPlanner {
  private lastSuccessAt = 0;
  private readonly startedAt = Date.now();
  private running = false;
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  healthy() { return Date.now() - (this.lastSuccessAt || this.startedAt) < 180_000; }

  @Cron("0 * * * * *")
  async scheduledScan() {
    if (this.running) return;
    this.running = true;
    try { await this.scan(new Date()); this.lastSuccessAt = Date.now(); }
    finally { this.running = false; }
  }

  async scan(now: Date) {
    const due = await this.prisma.task.findMany({
      where: { status: { in: ["PENDING", "OVERDUE"] }, OR: [{ reminderAt: { lte: now } }, { dueAt: { lt: now } }] },
      include: { order: { select: { trackingSerial: true, salesNumber: true, salesId: true, createdById: true } } },
    });
    const chairmen = await this.prisma.employee.findMany({ where: { role: "CHAIRMAN", active: true } });
    for (const candidate of due) {
      await this.prisma.$transaction(async (tx) => {
      // Use the same order lock as workflow submissions: a scan cannot revive a completed task.
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${candidate.orderId} FOR UPDATE`;
      const task = await tx.task.findUnique({ where: { id: candidate.id }, include: { order: { select: { trackingSerial: true, salesNumber: true, salesId: true, createdById: true } } } });
      if (!task || !["PENDING", "OVERDUE"].includes(task.status)) return;
      if (task.dueAt < now) {
        const delayDays = calculateDelayDays(task.dueAt, now);
        await tx.task.update({ where: { id: task.id }, data: { status: "OVERDUE", escalatedAt: task.escalatedAt ?? now, delayDays } });
        const recipients = new Set<string>();
        if (task.ownerId) recipients.add(task.ownerId);
        if (["DESIGN_PENDING", "DESIGN_ACCEPTED"].includes(task.stage ?? "")) {
          const businessOwnerId = task.order.salesId ?? task.order.createdById;
          if (businessOwnerId) recipients.add(businessOwnerId);
        }
        if (["TECHNICAL", "TECH_REVIEW", "MATERIALS", "PRODUCTION"].includes(task.stage ?? "")) chairmen.forEach((chairman) => recipients.add(chairman.id));
        for (const employeeId of recipients) {
          await tx.notification.upsert({
            where: { uniqueKey: `${task.uniqueKey}:OVERDUE:${employeeId}` },
            create: { employeeId, uniqueKey: `${task.uniqueKey}:OVERDUE:${employeeId}`, level: "ERROR", title: `超期 ${delayDays} 天`, body: `${task.order.salesNumber ?? task.order.trackingSerial} · ${task.title}` },
            update: { body: `${task.order.salesNumber ?? task.order.trackingSerial} · ${task.title} · 已延期 ${delayDays} 天` },
          });
        }
      } else if (!task.reminderSentAt && task.ownerId) {
          await tx.notification.upsert({
            where: { uniqueKey: `${task.uniqueKey}:REMINDER` },
            create: { employeeId: task.ownerId, uniqueKey: `${task.uniqueKey}:REMINDER`, level: "WARNING", title: "明日到期提醒", body: `${task.order.salesNumber ?? task.order.trackingSerial} · ${task.title}` },
            update: {},
          });
          await tx.task.update({ where: { id: task.id }, data: { reminderSentAt: now } });
      }
      });
    }
    return { scanned: due.length };
  }
}
