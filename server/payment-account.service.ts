import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Employee, Prisma } from "./generated/prisma/client.js";
import { PrismaService } from "./prisma.service.js";
import { normalizePaymentAccountName } from "./domain/payment-account-policy.js";

const publicAccount = {
  id: true, name: true, status: true, requestedById: true, reviewedById: true,
  reviewComment: true, requestedAt: true, reviewedAt: true, createdAt: true, updatedAt: true,
} as const;

@Injectable()
export class PaymentAccountService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(employee: Pick<Employee, "role">) {
    const where = ["FINANCE", "CHAIRMAN"].includes(employee.role) ? {} : { status: "APPROVED" };
    return this.prisma.paymentAccount.findMany({ where, select: publicAccount, orderBy: [{ status: "asc" }, { requestedAt: "desc" }] });
  }

  async request(nameValue: unknown, employee: Pick<Employee, "id" | "role">) {
    if (employee.role !== "FINANCE") throw new ForbiddenException("只有财务可以申请新增收款账户");
    let name: string;
    try { name = normalizePaymentAccountName(nameValue); } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : "收款账户名称无效"); }
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('payment-account-administration'))`;
      if (await tx.paymentAccount.findUnique({ where: { name } })) throw new BadRequestException("该收款账户已存在或已提交审批");
      const account = await tx.paymentAccount.create({ data: { name, requestedById: employee.id }, select: publicAccount });
      const chairmen = await tx.employee.findMany({ where: { active: true, role: "CHAIRMAN" }, select: { id: true } });
      await Promise.all(chairmen.map((chairman) => tx.notification.upsert({
        where: { uniqueKey: `payment-account-request:${account.id}:${chairman.id}` },
        create: { employeeId: chairman.id, uniqueKey: `payment-account-request:${account.id}:${chairman.id}`, level: "WARNING", title: "收款账户待审批", body: `财务申请新增收款账户“${name}”，请审核后决定是否启用。` },
        update: { readAt: null, body: `财务申请新增收款账户“${name}”，请审核后决定是否启用。` },
      })));
      return account;
    });
  }

  async review(id: string, decision: unknown, comment: unknown, employee: Pick<Employee, "id" | "role">) {
    if (employee.role !== "CHAIRMAN") throw new ForbiddenException("只有董事长管理员可以审批收款账户");
    if (!['APPROVE', 'REJECT'].includes(String(decision))) throw new BadRequestException("请选择通过或驳回");
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('payment-account-administration'))`;
      const current = await tx.paymentAccount.findUnique({ where: { id } });
      if (!current) throw new NotFoundException("收款账户申请不存在");
      if (current.status !== "PENDING") throw new BadRequestException("该申请已经审核，不能重复处理");
      const status = decision === "APPROVE" ? "APPROVED" : "REJECTED";
      const account = await tx.paymentAccount.update({ where: { id }, data: { status, reviewedById: employee.id, reviewedAt: new Date(), reviewComment: typeof comment === "string" && comment.trim() ? comment.trim().slice(0, 500) : null }, select: publicAccount });
      if (current.requestedById) await tx.notification.upsert({
        where: { uniqueKey: `payment-account-reviewed:${id}:${current.requestedById}` },
        create: { employeeId: current.requestedById, uniqueKey: `payment-account-reviewed:${id}:${current.requestedById}`, level: status === "APPROVED" ? "WARNING" : "ERROR", title: status === "APPROVED" ? "收款账户已通过" : "收款账户申请被驳回", body: `收款账户“${current.name}”${status === "APPROVED" ? "已启用，可用于后续收款报备。" : "未获批准，请查看审批意见。"}` },
        update: { readAt: null },
      });
      return account;
    });
  }

  async assertApproved(tx: Prisma.TransactionClient, nameValue: unknown) {
    let name: string;
    try { name = normalizePaymentAccountName(nameValue); } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : "收款账户名称无效"); }
    const account = await tx.paymentAccount.findFirst({ where: { name, status: "APPROVED" }, select: { id: true } });
    if (!account) throw new BadRequestException("收款账户尚未获得董事长批准，不能用于收款报备");
  }
}
