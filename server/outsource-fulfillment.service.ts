import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Employee, Order, Prisma } from "./generated/prisma/client.js";
import { projectFulfillment } from "./domain/fulfillment.js";
import { tailPaymentSatisfied } from "./domain/commercial-policy.js";
import { canManageOutsourceArrivals } from "./domain/outsource-arrival-policy.js";
import { requireOrder } from "./order-access.js";
import { assertCurrentVersion, runMutation, type MutationMeta } from "./mutations.js";
import { PrismaService } from "./prisma.service.js";
import { shanghaiBusinessDate } from "./domain/business-date.js";

type Tx = Prisma.TransactionClient;
type DraftLine = { presetCode?: string | null; name: string; plannedQty: number; unit?: string; usageArea?: string; note?: string };

const ACTIVE_STAGES = ["MATERIALS", "PRODUCTION", "INSTALLATION_APPLICATION", "DELIVERY", "INSTALLATION"];

@Injectable()
export class OutsourceFulfillmentService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async saveDraft(orderId: string, employee: Employee, input: { declaresNone?: boolean; lines?: DraftLine[] }, meta: MutationMeta = {}) {
    if (!["TECHNICAL", "CHAIRMAN"].includes(employee.role)) throw new ForbiddenException("只有技术拆单员可维护外购成品清单");
    const result = await runMutation(this.prisma, employee.id, `orders:${orderId}:outsource-draft`, input, meta, async (tx) => {
      const order = await requireOrder(tx, orderId, employee);
      assertCurrentVersion(order.updatedAt, meta);
      if (order.stage !== "TECHNICAL") throw new BadRequestException("只有技术拆单阶段可修改外购成品清单");
      const lines = normalizeLines(input.lines ?? []);
      const declaresNone = input.declaresNone === true;
      if (declaresNone && lines.length) throw new BadRequestException("“无外购成品”与外购产品清单不能同时提交");
      if (!declaresNone && !lines.length) throw new BadRequestException("请明确选择无外购，或至少添加一项外购产品");
      const existing = await tx.outsourceRequirementVersion.findFirst({ where: { orderId, status: "DRAFT" }, orderBy: { version: "desc" } });
      let versionId: string;
      if (existing) {
        await tx.outsourceProductLine.deleteMany({ where: { requirementVersionId: existing.id } });
        await tx.outsourceRequirementVersion.update({ where: { id: existing.id }, data: { declaresNone, submittedBy: employee.id } });
        versionId = existing.id;
      } else {
        const latest = await tx.outsourceRequirementVersion.findFirst({ where: { orderId }, orderBy: { version: "desc" } });
        const created = await tx.outsourceRequirementVersion.create({ data: { orderId, version: (latest?.version ?? 0) + 1, declaresNone, submittedBy: employee.id } });
        versionId = created.id;
      }
      if (lines.length) await tx.outsourceProductLine.createMany({ data: lines.map((line, index) => ({ orderId, requirementVersionId: versionId, sequence: index + 1, ...line })) });
      await tx.order.update({ where: { id: orderId }, data: { updatedAt: new Date() } });
      return { versionId };
    }, orderId);
    return this.draft(orderId, employee);
  }

  async draft(orderId: string, employee: Employee) {
    await requireOrder(this.prisma, orderId, employee);
    return this.prisma.outsourceRequirementVersion.findFirst({
      where: { orderId, status: "DRAFT" }, include: { lines: { orderBy: { sequence: "asc" } } }, orderBy: { version: "desc" },
    });
  }

  async finalize(tx: Tx, order: Order, submissionSetId: string) {
    const draft = await tx.outsourceRequirementVersion.findFirst({ where: { orderId: order.id, status: "DRAFT" }, include: { lines: true }, orderBy: { version: "desc" } });
    if (!draft && order.outsourceRequirementMode === "LEGACY_EXEMPT") return null;
    if (!draft) throw new BadRequestException("提交整单拆单前，必须明确声明无外购成品或完成外购清单");
    if (!draft.declaresNone && !draft.lines.length) throw new BadRequestException("外购成品清单至少包含一项产品");
    return tx.outsourceRequirementVersion.update({ where: { id: draft.id }, data: { status: "SUBMITTED", submissionSetId, submittedAt: new Date() }, include: { lines: { orderBy: { sequence: "asc" } } } });
  }

  async approve(tx: Tx, orderId: string, submissionSetId: string, employee: Employee, comment?: string) {
    const version = await tx.outsourceRequirementVersion.findUnique({ where: { submissionSetId }, include: { lines: true } });
    if (!version) {
      const order = await tx.order.findUnique({ where: { id: orderId }, select: { outsourceRequirementMode: true } });
      if (order?.outsourceRequirementMode === "LEGACY_EXEMPT") return;
      throw new BadRequestException("整单技术提交缺少外购声明");
    }
    await tx.outsourceRequirementVersion.updateMany({ where: { orderId, status: "APPROVED", id: { not: version.id } }, data: { status: "CANCELLED" } });
    await tx.outsourceRequirementVersion.update({ where: { id: version.id }, data: { status: "APPROVED", reviewedBy: employee.id, reviewedAt: new Date(), reviewComment: comment } });
    await tx.order.update({ where: { id: orderId }, data: { outsourceRequirementMode: version.declaresNone ? "NONE" : "REQUIRED" } });
  }

  async reject(tx: Tx, orderId: string, submissionSetId: string, employee: Employee, reason: string) {
    const version = await tx.outsourceRequirementVersion.findUnique({ where: { submissionSetId } });
    if (version) {
      await tx.outsourceRequirementVersion.update({ where: { id: version.id }, data: { status: "REJECTED", reviewedBy: employee.id, reviewedAt: new Date(), reviewComment: reason } });
      await tx.order.update({ where: { id: orderId }, data: { outsourceRequirementMode: "UNDECLARED" } });
    }
  }

  async addArrival(orderId: string, lineId: string, employee: Employee, input: { quantity: number; arrivedOn: string }, meta: MutationMeta = {}) {
    if (!canManageOutsourceArrivals(employee.role)) throw new ForbiddenException("只有订单管理员或董事长管理员可登记外购到货");
    const quantity = Number(input.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || !input.arrivedOn) throw new BadRequestException("本次到货数量和实际到货日期必填");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.arrivedOn) || Number.isNaN(new Date(`${input.arrivedOn}T00:00:00+08:00`).getTime())) throw new BadRequestException("实际到货日期无效");
    await runMutation(this.prisma, employee.id, `orders:${orderId}:outsource-arrival:${lineId}`, input, meta, async (tx) => {
      const order = await requireOrder(tx, orderId, employee);
      if (!ACTIVE_STAGES.includes(order.stage)) throw new BadRequestException("外购清单尚未通过订单管理员技术审单");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outsource-arrival:${lineId}`}))`;
      const line = await tx.outsourceProductLine.findFirst({ where: { id: lineId, orderId, requirementVersion: { status: "APPROVED" } }, include: { arrivals: true, shipmentLine: true } });
      if (!line) throw new NotFoundException("外购产品不存在或尚未发布");
      if (line.shipmentLine) throw new BadRequestException("该外购产品已发货，不能再登记到货");
      const arrived = line.arrivals.filter((arrival) => !arrival.voidedAt).reduce((sum, arrival) => sum + Number(arrival.quantity), 0);
      if (arrived + quantity > Number(line.plannedQty)) throw new BadRequestException(`本次到货数量超过剩余计划数量 ${Number(line.plannedQty) - arrived} ${line.unit}`);
      const arrival = await tx.outsourceArrival.create({ data: { productLineId: line.id, quantity, arrivedOn: new Date(`${input.arrivedOn}T00:00:00+08:00`), confirmedBy: employee.id } });
      await tx.orderEvent.create({ data: { orderId, actorId: employee.id, type: "OUTSOURCE_ARRIVAL_RECORDED", title: "外购成品到货已登记", description: `${line.name} · ${quantity} ${line.unit}`, fromStage: order.stage, toStage: order.stage, metadata: { lineId, arrivalId: arrival.id, quantity, arrivedOn: input.arrivedOn } } });
      await tx.order.update({ where: { id: orderId }, data: { updatedAt: new Date() } });
      return arrival;
    }, orderId);
    return { ok: true };
  }

  async voidArrival(orderId: string, arrivalId: string, employee: Employee, reason: string, meta: MutationMeta = {}) {
    if (!canManageOutsourceArrivals(employee.role)) throw new ForbiddenException("只有订单管理员或董事长管理员可作废到货记录");
    if (!reason.trim()) throw new BadRequestException("作废原因必填");
    await runMutation(this.prisma, employee.id, `orders:${orderId}:void-outsource-arrival:${arrivalId}`, { reason }, meta, async (tx) => {
      const order = await requireOrder(tx, orderId, employee);
      const arrival = await tx.outsourceArrival.findFirst({ where: { id: arrivalId, voidedAt: null, productLine: { orderId } }, include: { productLine: { include: { shipmentLine: true } } } });
      if (!arrival) throw new NotFoundException("可作废的到货记录不存在");
      if (arrival.productLine.shipmentLine) throw new BadRequestException("该产品已发货，到货记录不能作废");
      await tx.outsourceArrival.update({ where: { id: arrivalId }, data: { voidedAt: new Date(), voidedBy: employee.id, voidReason: reason.trim() } });
      await tx.orderEvent.create({ data: { orderId, actorId: employee.id, type: "OUTSOURCE_ARRIVAL_VOIDED", title: "外购到货记录已作废", description: `${arrival.productLine.name} · ${reason.trim()}`, fromStage: order.stage, toStage: order.stage, metadata: { lineId: arrival.productLineId, arrivalId, reason: reason.trim() } } });
      return { id: arrivalId };
    }, orderId);
    return { ok: true };
  }

  async recordShipment(tx: Tx, order: Order, employee: Employee, payload: Record<string, unknown>) {
    if (!ACTIVE_STAGES.includes(order.stage)) throw new BadRequestException("当前阶段不能办理外购产品发货");
    if (!tailPaymentSatisfied(order)) throw new BadRequestException("外购产品发货前必须通过付款门禁；免费单需先完成商务确认");
    const lineIds = Array.isArray(payload.lineIds) ? payload.lineIds.map(String) : [];
    if (!lineIds.length || new Set(lineIds).size !== lineIds.length) throw new BadRequestException("请选择不重复的已齐套外购产品");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outsource-shipment:${order.id}`}))`;
    const lines = await tx.outsourceProductLine.findMany({ where: { id: { in: lineIds }, orderId: order.id, requirementVersion: { status: "APPROVED" } }, include: { arrivals: true, shipmentLine: true }, orderBy: { sequence: "asc" } });
    if (lines.length !== lineIds.length) throw new BadRequestException("选中的外购产品不属于当前订单或尚未发布");
    for (const line of lines) {
      if (line.shipmentLine) throw new BadRequestException(`${line.name}已发货，不得重复选择`);
      const arrived = line.arrivals.filter((arrival) => !arrival.voidedAt).reduce((sum, arrival) => sum + Number(arrival.quantity), 0);
      if (arrived < Number(line.plannedQty)) throw new BadRequestException(`${line.name}尚未齐套，不能发货`);
    }
    const existingShipmentId = typeof payload.shipmentId === "string" ? payload.shipmentId : null;
    const shipment = existingShipmentId
      ? await tx.shipment.update({ where: { id: existingShipmentId, orderId: order.id }, data: {
          outsourceLines: { create: lines.map((line) => ({ productLineId: line.id, productName: line.name, plannedQty: line.plannedQty, unit: line.unit, usageArea: line.usageArea })) },
        } })
      : await tx.shipment.create({ data: {
          orderId: order.id, kind: "OUTSOURCED", vehicle: String(payload.vehicle), deliveredAt: shanghaiBusinessDate(), pieceCount: null, countBasis: "NOT_RECORDED", submittedBy: employee.id,
          outsourceLines: { create: lines.map((line) => ({ productLineId: line.id, productName: line.name, plannedQty: line.plannedQty, unit: line.unit, usageArea: line.usageArea })) },
        } });
    return { shipment, lines: lines.map((line) => ({ id: line.id, name: line.name, plannedQty: Number(line.plannedQty), unit: line.unit, usageArea: line.usageArea })), pieceCount: 0 };
  }

  async projection(orderId: string) {
    return this.projectionIn(this.prisma, orderId);
  }

  async projectionIn(db: Tx | PrismaService, orderId: string) {
    const order = await db.order.findUnique({ where: { id: orderId }, include: {
      productionAreas: { where: { cancelledAt: null }, include: {
        productionProcesses: true,
        productionRoutes: { where: { cancelledAt: null }, include: { productionProcesses: true, shipmentLines: { include: { shipmentArea: { include: { shipment: true } } }, orderBy: { sequence: "asc" } } } },
        shipmentAreas: { include: { shipment: true } },
      } },
      outsourceRequirementVersions: { where: { status: "APPROVED" }, include: { lines: { include: { arrivals: true, shipmentLine: true }, orderBy: { sequence: "asc" } } }, orderBy: { version: "desc" }, take: 1 },
    } });
    if (!order) throw new NotFoundException("订单不存在");
    const version = order.outsourceRequirementVersions[0];
    return projectFulfillment({
      tailPaymentConfirmed: tailPaymentSatisfied(order), installationApplied: order.installationApplied, outsourceMode: order.outsourceRequirementMode,
      productionAreas: order.productionAreas.map((area) => ({
        id: area.id,
        complete: area.productionProcesses.length > 0 && area.productionProcesses.every((process) => process.status === "COMPLETE"),
        shipped: area.shipmentAreas.some((line) => line.isFinalBatch),
        shipmentBatches: area.shipmentAreas.map((line) => ({ isFinalBatch: line.isFinalBatch, installed: Boolean(line.shipment.installedAt) })),
        routes: area.productionRoutes.map((route) => ({
          id: route.id,
          kind: route.kind,
          complete: route.productionProcesses.length > 0 && route.productionProcesses.every((process) => ["REFERENCE_CONFIRMATION", "PACKAGE_COUNT"].includes(process.metricMode) || process.status === "COMPLETE"),
          shipped: Boolean(route.shippedAt) || route.shipmentLines.some((line) => line.isFinalBatch),
          shipmentInstalled: (Boolean(route.shippedAt) || route.shipmentLines.some((line) => line.isFinalBatch)) && route.shipmentLines.length > 0 && route.shipmentLines.every((line) => Boolean(line.shipmentArea.shipment.installedAt)),
          shipmentBatches: route.shipmentLines.map((line) => ({ isFinalBatch: line.isFinalBatch, installed: Boolean(line.shipmentArea.shipment.installedAt) })),
        })),
      })),
      outsourceLines: (version?.lines ?? []).map((line) => ({ ...line, plannedQty: Number(line.plannedQty), arrivals: line.arrivals.map((arrival) => ({ ...arrival, quantity: Number(arrival.quantity) })) })),
    });
  }
}

function normalizeLines(lines: DraftLine[]) {
  return lines.map((line) => ({ presetCode: line.presetCode?.trim() || null, name: line.name?.trim(), plannedQty: Number(line.plannedQty), unit: line.unit?.trim() || "件", usageArea: line.usageArea?.trim() || null, note: line.note?.trim() || null })).map((line) => {
    if (!line.name) throw new BadRequestException("外购产品名称必填");
    if (!Number.isInteger(line.plannedQty) || line.plannedQty <= 0) throw new BadRequestException(`${line.name}的计划数量必须是大于0的整数`);
    return line;
  });
}
