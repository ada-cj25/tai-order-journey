import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Employee, Prisma } from "./generated/prisma/client.js";
import { resolveWarranty } from "./domain/rules.js";
import type { BusinessType } from "./domain/types.js";
import { PrismaService } from "./prisma.service.js";
import { assertCostEnabled, costEnabled } from "./runtime-config.js";
import { orderScope, requireOrder } from "./order-access.js";
import { assertCurrentVersion, runMutation, type MutationMeta } from "./mutations.js";

const COST_VIEW_ROLES = ["AFTERSALES", "FINANCE", "CHAIRMAN"];
const COST_EDIT_ROLES = ["AFTERSALES", "CHAIRMAN"];

type AfterSalesCostInput = { incurredOn?: string; amount?: number; description?: string; attachmentIds?: string[] };

function parseBusinessDate(value: unknown) {
  const text = String(value ?? "");
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(text)) throw new BadRequestException("售后费用发生日期必填");
  const [year, month, day] = text.split("-").map(Number);
  const exact = new Date(Date.UTC(year!, month! - 1, day!));
  if (exact.getUTCFullYear() !== year || exact.getUTCMonth() !== month! - 1 || exact.getUTCDate() !== day) throw new BadRequestException("售后费用发生日期无效");
  const date = new Date(`${text}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) throw new BadRequestException("售后费用发生日期无效");
  return date;
}

function normalizeCostInput(body: AfterSalesCostInput) {
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException("售后费用必须大于0");
  const description = body.description?.trim();
  if (!description) throw new BadRequestException("售后费用说明必填");
  return {
    amount,
    description,
    incurredOn: parseBusinessDate(body.incurredOn),
    attachmentIds: Array.isArray(body.attachmentIds) ? [...new Set(body.attachmentIds.map(String).filter(Boolean))] : [],
  };
}

@Injectable()
export class AfterSalesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(employee: Employee) {
    const rows = await this.prisma.afterSalesCase.findMany({
      where: employee.role === "AFTERSALES" ? { order: { stage: "BUSINESS_COMPLETE" } } : { order: orderScope(employee) },
      include: {
        order: { select: { id: true, trackingSerial: true, salesNumber: true, productionNumber: true, customerName: true, stage: true } },
        costBatches: { orderBy: { recordedAt: "desc" } },
      },
      orderBy: { createdAt: "desc" },
    });
    const canSeeCosts = costEnabled() && COST_VIEW_ROLES.includes(employee.role);
    const attachmentIds = canSeeCosts ? [...new Set(rows.flatMap((row) => row.costBatches.flatMap((batch) => Array.isArray(batch.attachmentIds) ? batch.attachmentIds.map(String) : [])))] : [];
    const attachments = attachmentIds.length ? await this.prisma.attachment.findMany({ where: { id: { in: attachmentIds } }, select: { id: true, originalName: true, mimeType: true } }) : [];
    const attachmentById = new Map(attachments.map((item) => [item.id, item]));
    return rows.map((row) => {
      const subtotal = row.costBatches.filter((batch) => !batch.voidedAt).reduce((sum, batch) => sum + Number(batch.amount), 0);
      return {
        ...row,
        costSubtotal: canSeeCosts ? Math.round((subtotal + Number.EPSILON) * 100) / 100 : null,
        costStatus: canSeeCosts ? "CUMULATIVE" : null,
        costBatches: canSeeCosts ? row.costBatches.map((batch) => ({ ...batch, amount: Number(batch.amount), attachments: (Array.isArray(batch.attachmentIds) ? batch.attachmentIds.map(String) : []).map((id) => attachmentById.get(id)).filter((item) => Boolean(item)) })) : undefined,
      };
    });
  }

  async create(body: { orderId: string; issueType: string; description: string; incurredOn?: string; amount?: number; attachmentIds?: string[] }, employee: Employee, meta: MutationMeta = {}) {
    if (!COST_EDIT_ROLES.includes(employee.role)) throw new ForbiddenException("只有售后人员或董事长管理员可以登记售后问题及费用");
    assertCostEnabled();
    if (!body.description?.trim() || !body.issueType?.trim()) throw new BadRequestException("售后问题类型和事实描述必填");
    const cost = normalizeCostInput({ ...body, description: `本次问题：${body.description.trim()}` });
    await requireOrder(this.prisma, body.orderId, employee);
    return runMutation(this.prisma, employee.id, "aftersales:create", body, meta, async (tx) => {
      const order = await requireOrder(tx, body.orderId, employee);
      assertCurrentVersion(order.updatedAt, meta);
      if (order.stage !== "BUSINESS_COMPLETE") throw new BadRequestException("订单履约完成后才能登记售后");
      const warranty = resolveWarranty(order.businessType as BusinessType, order.finalAcceptedAt);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('aftersales-number'))`;
      const count = await tx.afterSalesCase.count();
      const now = new Date();
      const result = await tx.afterSalesCase.create({ data: { orderId: order.id, caseNumber: `SH-${now.getFullYear()}-${String(count + 1).padStart(4, "0")}`, issueType: body.issueType.trim(), description: body.description.trim(), warrantyYears: warranty.years, warrantyStartsAt: warranty.startsAt, warrantyExpiresAt: warranty.expiresAt } });
      if (cost.attachmentIds.length) {
        const attachments = await tx.attachment.findMany({ where: { id: { in: cost.attachmentIds }, orderId: order.id, category: "AFTERSALES_COST" } });
        if (attachments.length !== cost.attachmentIds.length) throw new BadRequestException("售后费用附件必须属于当前订单且类别正确");
      }
      const batch = await tx.afterSalesCostBatch.create({ data: { afterSalesId: result.id, orderId: order.id, incurredOn: cost.incurredOn, amount: cost.amount, description: cost.description, attachmentIds: cost.attachmentIds as Prisma.InputJsonArray, recordedBy: employee.id, recordedAt: now } });
      await tx.order.update({ where: { id: order.id }, data: { updatedAt: now } });
      await tx.orderEvent.create({ data: { orderId: order.id, actorId: employee.id, type: "AFTERSALES_CREATED", title: "售后问题已登记", description: body.description.trim(), fromStage: order.stage, toStage: order.stage, metadata: { caseId: result.id, caseNumber: result.caseNumber } } });
      await tx.orderEvent.create({ data: { orderId: order.id, actorId: employee.id, type: "AFTERSALES_COST_ADDED", title: "售后费用已累计", description: `${result.caseNumber} · ¥${cost.amount.toFixed(2)} · ${cost.description}`, fromStage: order.stage, toStage: order.stage, metadata: { caseId: result.id, batchId: batch.id, amount: cost.amount, incurredOn: body.incurredOn } } });
      return { ...result, costSubtotal: cost.amount, costStatus: "CUMULATIVE", costBatches: [{ ...batch, amount: Number(batch.amount) }] };
    }, body.orderId);
  }

  async transition(caseId: string, body: { action?: "START" | "RESOLVE"; resolution?: string }, employee: Employee, meta: MutationMeta = {}) {
    if (!["AFTERSALES", "CHAIRMAN"].includes(employee.role)) throw new ForbiddenException("只有售后人员或董事长管理员可以更新售后状态");
    if (!["START", "RESOLVE"].includes(String(body.action))) throw new BadRequestException("售后状态操作无效");
    const found = await this.prisma.afterSalesCase.findUnique({ where: { id: caseId }, include: { order: true } });
    if (!found) throw new NotFoundException("售后单不存在");
    await requireOrder(this.prisma, found.orderId, employee);
    return runMutation(this.prisma, employee.id, `aftersales:${caseId}:status`, body, meta, async (tx) => {
      const current = await tx.afterSalesCase.findUnique({ where: { id: caseId }, include: { order: true } });
      if (!current) throw new NotFoundException("售后单不存在");
      assertCurrentVersion(current.updatedAt, meta);
      if (current.order.stage !== "BUSINESS_COMPLETE") throw new BadRequestException("只有已履约订单可以处理售后");
      const now = new Date();
      if (body.action === "START") {
        if (current.status !== "OPEN") throw new BadRequestException("只有新问题可以开始处理");
        const result = await tx.afterSalesCase.update({ where: { id: caseId }, data: { status: "IN_PROGRESS", startedAt: now } });
        await tx.order.update({ where: { id: current.orderId }, data: { updatedAt: now } });
        await tx.orderEvent.create({ data: { orderId: current.orderId, actorId: employee.id, type: "AFTERSALES_STARTED", title: "售后问题开始处理", description: current.caseNumber, fromStage: current.order.stage, toStage: current.order.stage, metadata: { caseId } } });
        return result;
      }
      const resolution = body.resolution?.trim();
      if (!resolution) throw new BadRequestException("解决售后问题时必须填写处理结果");
      if (current.status !== "IN_PROGRESS") throw new BadRequestException("售后问题必须先开始处理，再标记已解决");
      const result = await tx.afterSalesCase.update({ where: { id: caseId }, data: { status: "RESOLVED", resolvedAt: now, resolution } });
      await tx.order.update({ where: { id: current.orderId }, data: { updatedAt: now } });
      await tx.orderEvent.create({ data: { orderId: current.orderId, actorId: employee.id, type: "AFTERSALES_RESOLVED", title: "售后问题已解决", description: resolution, fromStage: current.order.stage, toStage: current.order.stage, metadata: { caseId } } });
      return result;
    }, found.orderId);
  }

  async addCostBatch(caseId: string, body: AfterSalesCostInput, employee: Employee, meta: MutationMeta = {}) {
    assertCostEnabled();
    if (!COST_EDIT_ROLES.includes(employee.role)) throw new ForbiddenException("只有售后人员或董事长管理员可以登记售后费用");
    const { amount, description, incurredOn, attachmentIds } = normalizeCostInput(body);
    const found = await this.prisma.afterSalesCase.findUnique({ where: { id: caseId }, include: { order: true } });
    if (!found) throw new NotFoundException("售后单不存在");
    await requireOrder(this.prisma, found.orderId, employee);
    return runMutation(this.prisma, employee.id, `aftersales:${caseId}:cost-batches`, body, meta, async (tx) => {
      const current = await tx.afterSalesCase.findUnique({ where: { id: caseId }, include: { order: true } });
      if (!current) throw new NotFoundException("售后单不存在");
      assertCurrentVersion(current.updatedAt, meta);
      if (current.order.stage !== "BUSINESS_COMPLETE") throw new BadRequestException("订单履约完成后才能登记售后费用");
      if (attachmentIds.length) {
        const attachments = await tx.attachment.findMany({ where: { id: { in: attachmentIds }, orderId: current.orderId, category: "AFTERSALES_COST" } });
        if (attachments.length !== attachmentIds.length) throw new BadRequestException("售后费用附件必须属于当前订单且类别正确");
      }
      const now = new Date();
      const batch = await tx.afterSalesCostBatch.create({ data: { afterSalesId: caseId, orderId: current.orderId, incurredOn, amount, description, attachmentIds: attachmentIds as Prisma.InputJsonArray, recordedBy: employee.id, recordedAt: now } });
      await tx.afterSalesCase.update({ where: { id: caseId }, data: { updatedAt: now } });
      await tx.order.update({ where: { id: current.orderId }, data: { updatedAt: now } });
      await tx.orderEvent.create({ data: { orderId: current.orderId, actorId: employee.id, type: "AFTERSALES_COST_ADDED", title: "售后费用已累计", description: `${current.caseNumber} · ¥${amount.toFixed(2)} · ${description}`, fromStage: current.order.stage, toStage: current.order.stage, metadata: { caseId, batchId: batch.id, amount, incurredOn: body.incurredOn } } });
      return { ...batch, amount: Number(batch.amount) };
    }, found.orderId);
  }

  async voidCostBatch(caseId: string, batchId: string, body: { reason?: string }, employee: Employee, meta: MutationMeta = {}) {
    assertCostEnabled();
    if (!COST_EDIT_ROLES.includes(employee.role)) throw new ForbiddenException("只有售后人员或董事长管理员可以作废售后费用");
    const reason = body.reason?.trim();
    if (!reason) throw new BadRequestException("作废原因必填");
    const found = await this.prisma.afterSalesCase.findUnique({ where: { id: caseId } });
    if (!found) throw new NotFoundException("售后单不存在");
    await requireOrder(this.prisma, found.orderId, employee);
    return runMutation(this.prisma, employee.id, `aftersales:${caseId}:cost-batches:${batchId}:void`, body, meta, async (tx) => {
      const current = await tx.afterSalesCase.findUnique({ where: { id: caseId }, include: { order: true } });
      if (!current) throw new NotFoundException("售后单不存在");
      assertCurrentVersion(current.updatedAt, meta);
      const batch = await tx.afterSalesCostBatch.findFirst({ where: { id: batchId, afterSalesId: caseId } });
      if (!batch || batch.voidedAt) throw new NotFoundException("可作废的售后费用批次不存在");
      const now = new Date();
      await tx.afterSalesCostBatch.update({ where: { id: batch.id }, data: { voidedAt: now, voidedBy: employee.id, voidReason: reason } });
      await tx.afterSalesCase.update({ where: { id: caseId }, data: { updatedAt: now } });
      await tx.order.update({ where: { id: current.orderId }, data: { updatedAt: now } });
      await tx.orderEvent.create({ data: { orderId: current.orderId, actorId: employee.id, type: "AFTERSALES_COST_VOIDED", title: "售后费用已作废", description: `${current.caseNumber} · ¥${Number(batch.amount).toFixed(2)} · ${reason}`, fromStage: current.order.stage, toStage: current.order.stage, metadata: { caseId, batchId, reason } } });
      return { id: batch.id, voidedAt: now, voidReason: reason };
    }, found.orderId);
  }
}
