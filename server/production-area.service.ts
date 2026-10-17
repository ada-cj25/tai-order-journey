import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Employee } from "./generated/prisma/client.js";
import type { BusinessType } from "./domain/types.js";
import { OrderNumberAllocator } from "./number-allocator.service.js";
import { PrismaService } from "./prisma.service.js";
import { requireOrder } from "./order-access.js";
import { runMutation, type MutationMeta } from "./mutations.js";

function requireTechnical(employee: Employee) {
  if (!["TECHNICAL", "CHAIRMAN"].includes(employee.role)) throw new ForbiddenException("只有技术拆单员可以维护生产区域");
}

function normalizeAreaName(value: unknown) {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!name) throw new BadRequestException("请填写生产区域名称");
  if (name.length > 40) throw new BadRequestException("生产区域名称不能超过40个字符");
  return name;
}

@Injectable()
export class ProductionAreaService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OrderNumberAllocator) private readonly allocator: OrderNumberAllocator,
  ) {}

  async create(orderId: string, nameValue: unknown, employee: Employee, meta: MutationMeta = {}) {
    requireTechnical(employee);
    await requireOrder(this.prisma, orderId, employee);
    const name = normalizeAreaName(nameValue);
    return runMutation(this.prisma, employee.id, `orders:${orderId}:areas:create`, { name }, meta, async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { productionAreas: { orderBy: { sequence: "asc" } } } });
      if (!order) throw new NotFoundException("订单不存在");
      if (order.stage !== "TECHNICAL") throw new BadRequestException("只有技术拆单阶段可以创建生产区域");
      if (!order.salesNumber) throw new BadRequestException("订单尚未生成销售编号，不能创建生产区域");
      if (order.productionAreas.some((area) => !area.cancelledAt && area.name === name)) throw new BadRequestException("同一销售订单内不能存在同名生产区域");
      const sequence = Math.max(0, ...order.productionAreas.map((area) => area.sequence)) + 1;
      const productionNumber = order.trackingSerial.startsWith("TEST-")
        ? `TEST-AREA-${order.trackingSerial.replace(/[^A-Za-z0-9-]/g, "-")}-${String(sequence).padStart(2, "0")}`
        : await this.allocator.allocate(tx, order.businessType as BusinessType, new Date());
      const area = await tx.productionArea.create({ data: { orderId, name, sequence, productionNumber, createdBy: employee.id } });
      await tx.orderEvent.create({ data: { orderId, actorId: employee.id, type: "CREATE_PRODUCTION_AREA", title: "生产区域已创建并领号", description: `${name} · ${productionNumber}`, fromStage: "TECHNICAL", toStage: "TECHNICAL", metadata: { productionAreaId: area.id, name, productionNumber } } });
      return area;
    }, orderId);
  }

  async cancel(orderId: string, areaId: string, reasonValue: unknown, employee: Employee, meta: MutationMeta = {}) {
    requireTechnical(employee);
    await requireOrder(this.prisma, orderId, employee);
    const reason = String(reasonValue ?? "").trim();
    if (!reason) throw new BadRequestException("作废生产区域必须填写原因");
    return runMutation(this.prisma, employee.id, `orders:${orderId}:areas:${areaId}:cancel`, { reason }, meta, async (tx) => {
      const area = await tx.productionArea.findFirst({ where: { id: areaId, orderId }, include: { productionProcesses: { select: { id: true } }, shipmentAreas: { select: { id: true } }, materialVersions: { where: { status: { not: "CANCELLED" } }, select: { id: true } } } });
      if (!area) throw new NotFoundException("生产区域不存在");
      if (area.cancelledAt) throw new BadRequestException("该生产区域已经作废");
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (order.stage !== "TECHNICAL") throw new BadRequestException("仅在技术拆单阶段可以作废并重建区域");
      if (area.productionProcesses.length || area.shipmentAreas.length || area.materialVersions.length) throw new BadRequestException("已发布物料、下达生产或发货的区域不能作废，必须走责任处理或补单");
      const now = new Date();
      await tx.productionArea.update({ where: { id: areaId }, data: { status: "CANCELLED", cancelledAt: now, cancelReason: reason } });
      await tx.materialImportBatch.updateMany({ where: { productionAreaId: areaId, status: "DRAFT" }, data: { status: "CANCELLED", cancelledAt: now, cancelledBy: employee.id, cancelReason: reason } });
      await tx.technicalPackageVersion.updateMany({ where: { productionAreaId: areaId, status: { in: ["PREVIEW", "SUBMITTED", "REJECTED"] } }, data: { status: "CANCELLED" } });
      await tx.orderEvent.create({ data: { orderId, actorId: employee.id, type: "CANCEL_PRODUCTION_AREA", title: "生产区域已作废", description: `${area.name} · ${area.productionNumber} · ${reason}`, fromStage: "TECHNICAL", toStage: "TECHNICAL", metadata: { productionAreaId: areaId, productionNumber: area.productionNumber, reason } } });
      return { id: areaId, status: "CANCELLED" };
    }, orderId);
  }
}
