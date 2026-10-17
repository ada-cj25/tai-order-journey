import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Employee, Prisma } from "./generated/prisma/client.js";
import { projectPackageCountAvailability, projectPackageSummary, type PackageCountKind, type PackageCountSourceProjection } from "./domain/package-counting.js";
import { PrismaService } from "./prisma.service.js";
import { assertCurrentVersion, runMutation, type MutationMeta } from "./mutations.js";
import { requireOrder } from "./order-access.js";
import { PRODUCTION_ROUTE_LABELS } from "./domain/route-execution.js";

type Command = "ADD_COUNT" | "FINALIZE_SOURCE" | "CONFIRM_HARDWARE_HANDOFF" | "REOPEN_SOURCE" | "VOID_ENTRY";
type CommandInput = { command: Command; quantity?: number; entryId?: string; reason?: string };

function sourceKey(kind: PackageCountKind, id: string) { return `${kind}:${id}`; }
function isAssembly(employee: Employee) { return employee.role === "CHAIRMAN" || (employee.role === "WORKSHOP" && employee.workshop === "ASSEMBLY"); }

@Injectable()
export class PackageCountService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async context(db: Prisma.TransactionClient | PrismaService, orderId: string) {
    const order = await db.order.findUnique({ where: { id: orderId }, include: {
      productionAreas: { where: { cancelledAt: null }, orderBy: { sequence: "asc" }, include: { productionProcesses: true, productionRoutes: { where: { cancelledAt: null }, include: { productionProcesses: true } } } },
      outsourceRequirementVersions: { where: { status: "APPROVED" }, orderBy: { version: "desc" }, take: 1, include: { lines: { orderBy: { sequence: "asc" }, include: { arrivals: true } } } },
      packageCountSources: { include: { entries: { orderBy: { recordedAt: "asc" } } } },
      stageSubmissions: { where: { command: "SUBMIT_INSTALLATION_APPLICATION", status: { not: "DRAFT" } }, orderBy: { createdAt: "desc" }, take: 1 },
      shipments: { select: { pieceCount: true, countBasis: true } },
    } });
    if (!order) throw new NotFoundException("订单不存在");
    return order;
  }

  async projection(orderId: string, employee?: Employee) {
    if (employee) await requireOrder(this.prisma, orderId, employee);
    const order = await this.context(this.prisma, orderId);
    const stored = new Map(order.packageCountSources.map((source) => [source.sourceKey, source]));
    const blueprints: Array<{ sourceKey: string; kind: PackageCountKind; label: string; productionAreaId?: string; productionRouteId?: string; outsourceProductLineId?: string; prerequisiteComplete?: boolean; arrivedQty?: number; plannedQty?: number; canConfirmHandoff?: boolean }> = [];
    for (const area of order.productionAreas) {
      blueprints.push({ sourceKey: sourceKey("HARDWARE_AREA", area.id), kind: "HARDWARE_AREA", label: `${area.name}·五金包`, productionAreaId: area.id, canConfirmHandoff: true });
      if (area.productionRoutes.length) {
        for (const route of area.productionRoutes) blueprints.push({
          sourceKey: sourceKey("MANUFACTURED_ROUTE", route.id),
          kind: "MANUFACTURED_ROUTE",
          label: `${area.name}·${PRODUCTION_ROUTE_LABELS[route.kind]}·自产成品入库`,
          productionAreaId: area.id,
          productionRouteId: route.id,
          prerequisiteComplete: route.productionProcesses.find((process) => process.processCode === "ASSEMBLY-01")?.status === "COMPLETE",
        });
      } else {
        blueprints.push({ sourceKey: sourceKey("MANUFACTURED_AREA", area.id), kind: "MANUFACTURED_AREA", label: `${area.name}·自产成品入库`, productionAreaId: area.id, prerequisiteComplete: area.productionProcesses.find((process) => process.processCode === "ASSEMBLY-01")?.status === "COMPLETE" });
      }
    }
    for (const line of order.outsourceRequirementVersions[0]?.lines ?? []) {
      const arrived = line.arrivals.filter((arrival) => !arrival.voidedAt).reduce((sum, arrival) => sum + Number(arrival.quantity), 0);
      blueprints.push({ sourceKey: sourceKey("OUTSOURCED_PRODUCT", line.id), kind: "OUTSOURCED_PRODUCT", label: `${line.name}·外购入库`, outsourceProductLineId: line.id, arrivedQty: arrived, plannedQty: Number(line.plannedQty) });
    }
    const sources: PackageCountSourceProjection[] = blueprints.map((blueprint) => {
      const row = stored.get(blueprint.sourceKey);
      const entries = (row?.entries ?? []).map((entry) => ({ ...entry, quantity: Number(entry.quantity) }));
      const total = entries.filter((entry) => !entry.voidedAt).reduce((sum, entry) => sum + entry.quantity, 0);
      const availability = projectPackageCountAvailability({ kind: blueprint.kind, prerequisiteComplete: blueprint.prerequisiteComplete, arrivedQty: blueprint.arrivedQty, plannedQty: blueprint.plannedQty, total });
      return {
        ...blueprint,
        ...availability,
        status: (row?.status === "FINALIZED" ? "FINALIZED" : "OPEN") as "OPEN" | "FINALIZED",
        total,
        handoffConfirmed: Boolean(row?.handoffConfirmedAt),
        entries,
      };
    });
    const payload = order.stageSubmissions[0]?.payload as Record<string, unknown> | undefined;
    const oldEstimate = Number(payload?.pieceCount);
    const legacyShipmentPieceTotal = order.shipments.filter((shipment) => shipment.pieceCount != null && shipment.countBasis === "LEGACY_MANUAL").reduce((sum, shipment) => sum + Number(shipment.pieceCount), 0);
    return projectPackageSummary({ sources, legacyClosed: order.stage === "BUSINESS_COMPLETE" && order.packageCountSources.length === 0, legacyApplicationEstimate: Number.isFinite(oldEstimate) ? oldEstimate : null, legacyShipmentPieceTotal: legacyShipmentPieceTotal || null });
  }

  async command(orderId: string, encodedSourceKey: string, input: CommandInput, employee: Employee, meta: MutationMeta = {}) {
    await requireOrder(this.prisma, orderId, employee);
    const key = decodeURIComponent(encodedSourceKey);
    await runMutation(this.prisma, employee.id, `orders:${orderId}:package-count:${key}`, input, meta, async (tx) => {
      const order = await this.context(tx, orderId);
      assertCurrentVersion(order.updatedAt, meta);
      const [kind, refId] = key.split(":") as [PackageCountKind, string];
      if (!refId || !["HARDWARE_AREA", "MANUFACTURED_AREA", "MANUFACTURED_ROUTE", "OUTSOURCED_PRODUCT"].includes(kind)) throw new BadRequestException("包件统计来源无效");
      const route = kind === "MANUFACTURED_ROUTE" ? order.productionAreas.flatMap((candidate) => candidate.productionRoutes).find((candidate) => candidate.id === refId) : undefined;
      const area = kind === "MANUFACTURED_ROUTE"
        ? order.productionAreas.find((candidate) => candidate.id === route?.productionAreaId)
        : order.productionAreas.find((candidate) => candidate.id === refId);
      const outsourceLine = order.outsourceRequirementVersions[0]?.lines.find((candidate) => candidate.id === refId);
      if ((kind === "OUTSOURCED_PRODUCT" && !outsourceLine) || (kind === "MANUFACTURED_ROUTE" && (!route || !area)) || (!["OUTSOURCED_PRODUCT", "MANUFACTURED_ROUTE"].includes(kind) && !area)) throw new BadRequestException("包件统计来源不属于当前订单");
      const ownsSource = kind === "HARDWARE_AREA" ? ["PROCUREMENT", "CHAIRMAN"].includes(employee.role) : isAssembly(employee);
      if (input.command === "CONFIRM_HARDWARE_HANDOFF") {
        if (kind !== "HARDWARE_AREA" || !isAssembly(employee)) throw new ForbiddenException("只有组装车间可确认领用五金");
      } else if (!ownsSource) throw new ForbiddenException(kind === "HARDWARE_AREA" ? "只有采购可登记五金包数" : "只有组装车间可登记入库包件数");
      const source = await tx.packageCountSource.upsert({ where: { sourceKey: key }, update: {}, create: { orderId, sourceKey: key, kind, productionAreaId: area?.id, productionRouteId: route?.id, outsourceProductLineId: outsourceLine?.id } , include: { entries: true } });
      const total = source.entries.filter((entry) => !entry.voidedAt).reduce((sum, entry) => sum + entry.quantity, 0);
      const now = new Date();
      if (input.command === "ADD_COUNT") {
        const quantity = Number(input.quantity);
        if (source.status === "FINALIZED") throw new BadRequestException("该来源已最终确认，需先重新打开");
        if (!Number.isInteger(quantity) || quantity <= 0) throw new BadRequestException("本次新增包件数必须是大于0的整数");
        if (kind === "OUTSOURCED_PRODUCT" && !outsourceLine!.arrivals.some((arrival) => !arrival.voidedAt)) throw new BadRequestException("外购产品实际到货后才能登记打包入库数");
        if (kind === "MANUFACTURED_AREA" && area!.productionProcesses.find((process) => process.processCode === "ASSEMBLY-01")?.status !== "COMPLETE") throw new BadRequestException("组装车间完成打包后才能登记自产入库包件");
        if (kind === "MANUFACTURED_ROUTE" && route!.productionProcesses.find((process) => process.processCode === "ASSEMBLY-01")?.status !== "COMPLETE") throw new BadRequestException("该路线组装车间完成打包后才能登记自产入库包件");
        await tx.packageCountEntry.create({ data: { sourceId: source.id, quantity, recordedBy: employee.id } });
      } else if (input.command === "FINALIZE_SOURCE") {
        if (source.status === "FINALIZED") throw new BadRequestException("该来源已最终确认");
        if (kind !== "HARDWARE_AREA" && total <= 0) throw new BadRequestException("请先登记实际包件数");
        if (kind === "MANUFACTURED_AREA" && area!.productionProcesses.find((process) => process.processCode === "ASSEMBLY-01")?.status !== "COMPLETE") throw new BadRequestException("组装车间完成打包后才能确认自产入库包件");
        if (kind === "MANUFACTURED_ROUTE" && route!.productionProcesses.find((process) => process.processCode === "ASSEMBLY-01")?.status !== "COMPLETE") throw new BadRequestException("该路线组装车间完成打包后才能确认自产入库包件");
        if (kind === "OUTSOURCED_PRODUCT") {
          const arrived = outsourceLine!.arrivals.filter((arrival) => !arrival.voidedAt).reduce((sum, arrival) => sum + Number(arrival.quantity), 0);
          if (arrived < Number(outsourceLine!.plannedQty)) throw new BadRequestException("外购产品尚未全部到货，可继续累计但不能最终确认");
        }
        await tx.packageCountSource.update({ where: { id: source.id }, data: { status: "FINALIZED", finalizedBy: employee.id, finalizedAt: now } });
        if (["MANUFACTURED_AREA", "MANUFACTURED_ROUTE"].includes(kind)) await tx.productionProcess.updateMany({ where: { orderId, productionAreaId: area!.id, productionRouteId: route?.id, processCode: "ASSEMBLY-03", status: { not: "COMPLETE" } }, data: { plannedQty: 1, completedQty: 1, unit: "项", metricMode: "PACKAGE_COUNT", status: "COMPLETE", completedAt: now, lastReportedAt: now, updatedBy: employee.id } });
      } else if (input.command === "CONFIRM_HARDWARE_HANDOFF") {
        if (source.status !== "FINALIZED") throw new BadRequestException("采购尚未最终确认本区域五金包数");
        if (source.handoffConfirmedAt) throw new BadRequestException("本区域五金包已由组装确认领用");
        await tx.packageCountSource.update({ where: { id: source.id }, data: { handoffConfirmedBy: employee.id, handoffConfirmedAt: now } });
        await tx.productionProcess.updateMany({ where: { orderId, productionAreaId: area!.id, processCode: "ASSEMBLY-02", status: { not: "COMPLETE" } }, data: { plannedQty: 1, completedQty: 1, unit: "项", metricMode: "REFERENCE_CONFIRMATION", status: "COMPLETE", completedAt: now, lastReportedAt: now, updatedBy: employee.id } });
      } else if (input.command === "REOPEN_SOURCE") {
        if (!String(input.reason ?? "").trim()) throw new BadRequestException("重新打开原因必填");
        await tx.packageCountSource.update({ where: { id: source.id }, data: { status: "OPEN", finalizedBy: null, finalizedAt: null, reopenedAt: now, reopenReason: String(input.reason).trim(), ...(kind === "HARDWARE_AREA" ? { handoffConfirmedBy: null, handoffConfirmedAt: null } : {}) } });
      } else if (input.command === "VOID_ENTRY") {
        if (source.status === "FINALIZED") throw new BadRequestException("请先重新打开该来源");
        if (!String(input.reason ?? "").trim()) throw new BadRequestException("作废原因必填");
        const entry = source.entries.find((candidate) => candidate.id === input.entryId && !candidate.voidedAt);
        if (!entry) throw new NotFoundException("可作废的包件记录不存在");
        await tx.packageCountEntry.update({ where: { id: entry.id }, data: { voidedAt: now, voidedBy: employee.id, voidReason: String(input.reason).trim() } });
      }
      await tx.order.update({ where: { id: orderId }, data: { updatedAt: now } });
      const sourceLabel = kind === "HARDWARE_AREA" ? `${area!.name}·五金包`
        : kind === "MANUFACTURED_ROUTE" ? `${area!.name}·${PRODUCTION_ROUTE_LABELS[route!.kind]}`
        : kind === "MANUFACTURED_AREA" ? `${area!.name}·自产成品入库` : `${outsourceLine!.name}·外购入库`;
      const actionLabel: Record<Command, string> = {
        ADD_COUNT: `追加 ${input.quantity} 包件`,
        FINALIZE_SOURCE: "统计完成",
        CONFIRM_HARDWARE_HANDOFF: "组装确认领用五金",
        REOPEN_SOURCE: "重新打开统计",
        VOID_ENTRY: "包件记录已作废",
      };
      await tx.orderEvent.create({ data: { orderId, actorId: employee.id, type: `PACKAGE_COUNT_${input.command}`, title: `${sourceLabel} · ${actionLabel[input.command]}`, description: input.reason ? `原因：${input.reason.trim()}` : "", fromStage: order.stage, toStage: order.stage, metadata: { sourceKey: key, sourceLabel, ...input } as Prisma.InputJsonObject } });
    }, orderId);
    return this.projection(orderId);
  }

  async bulkFinalizeHardware(orderId: string, input: { areas?: Array<{ productionAreaId?: string; total?: number }> }, employee: Employee, meta: MutationMeta = {}) {
    if (!["PROCUREMENT", "CHAIRMAN"].includes(employee.role)) throw new ForbiddenException("只有采购或董事长管理员可以整单确认五金包");
    await requireOrder(this.prisma, orderId, employee);
    await runMutation(this.prisma, employee.id, `orders:${orderId}:package-count:hardware:bulk`, input, meta, async (tx) => {
      const order = await this.context(tx, orderId);
      assertCurrentVersion(order.updatedAt, meta);
      const rows = Array.isArray(input.areas) ? input.areas : [];
      const rowMap = new Map<string, number>();
      for (const row of rows) {
        const areaId = String(row.productionAreaId ?? "");
        const total = Number(row.total);
        if (!areaId || rowMap.has(areaId)) throw new BadRequestException("生产区域不能重复提交");
        if (!Number.isInteger(total) || total < 0) throw new BadRequestException("五金包最终总数必须是大于等于0的整数");
        rowMap.set(areaId, total);
      }
      if (rows.length !== order.productionAreas.length || order.productionAreas.some((area) => !rowMap.has(area.id))) throw new BadRequestException("请一次提交当前订单全部有效生产区域");
      if (order.productionAreas.length > 0 && order.productionAreas.every((area) => order.packageCountSources.find((source) => source.sourceKey === sourceKey("HARDWARE_AREA", area.id))?.status === "FINALIZED")) throw new BadRequestException("全部生产区域的五金包已经最终确认");
      const now = new Date();
      const finalized: Array<{ productionAreaId: string; total: number; appended: number }> = [];
      for (const area of order.productionAreas) {
        const key = sourceKey("HARDWARE_AREA", area.id);
        const stored = order.packageCountSources.find((source) => source.sourceKey === key);
        const current = (stored?.entries ?? []).filter((entry) => !entry.voidedAt).reduce((sum, entry) => sum + entry.quantity, 0);
        const total = rowMap.get(area.id)!;
        if (total < current) throw new BadRequestException(`${area.name}最终总数不能小于当前累计数 ${current}`);
        if (stored?.status === "FINALIZED") {
          if (total !== current) throw new BadRequestException(`${area.name}已最终确认，纠错请先重新打开并说明原因`);
          finalized.push({ productionAreaId: area.id, total, appended: 0 });
          continue;
        }
        const source = await tx.packageCountSource.upsert({ where: { sourceKey: key }, update: {}, create: { orderId, sourceKey: key, kind: "HARDWARE_AREA", productionAreaId: area.id } });
        const appended = total - current;
        if (appended > 0) await tx.packageCountEntry.create({ data: { sourceId: source.id, quantity: appended, recordedBy: employee.id } });
        await tx.packageCountSource.update({ where: { id: source.id }, data: { status: "FINALIZED", finalizedBy: employee.id, finalizedAt: now } });
        finalized.push({ productionAreaId: area.id, total, appended });
      }
      await tx.order.update({ where: { id: orderId }, data: { updatedAt: now } });
      await tx.orderEvent.create({ data: { orderId, actorId: employee.id, type: "PACKAGE_COUNT_HARDWARE_BULK_FINALIZED", title: "整单五金包已一键统计", description: `${finalized.length}个生产区域已原子确认`, fromStage: order.stage, toStage: order.stage, metadata: { areas: finalized } as unknown as Prisma.InputJsonObject } });
      return finalized;
    }, orderId);
    return this.projection(orderId);
  }
}
