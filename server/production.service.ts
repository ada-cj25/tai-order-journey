import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Employee, Prisma } from "./generated/prisma/client.js";
import { assertProductionProcessAvailable, calculateProductionProgress, canReportProductionProcess, normalizeProductionReport, productionWorkshopComplete, WORKSHOP_LABELS, WORKSHOP_PROCESS_TEMPLATES, type ProductionReportAction } from "./domain/production-progress.js";
import { PrismaService } from "./prisma.service.js";
import { TaskScheduler } from "./scheduler.service.js";
import { runMutation, assertCurrentVersion, type MutationMeta } from "./mutations.js";
import { requireOrder, validateOrderAttachments } from "./order-access.js";
import { projectRouteExecution } from "./domain/route-execution.js";
import { tailPaymentSatisfied } from "./domain/commercial-policy.js";

export type ProductionReportInput = {
  processId: string;
  action: ProductionReportAction;
  completedQty?: number;
  note?: string;
  attachmentIds?: string[];
};

@Injectable()
export class ProductionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(TaskScheduler) private readonly scheduler: TaskScheduler) {}

  async release(orderId: string, plans: Record<string, number>, employee: Employee) {
    if (!["ORDER_ADMIN", "CHAIRMAN"].includes(employee.role)) throw new ForbiddenException("只有订单管理员可在采购方案完成后下达车间工序");
    return this.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { productionProcesses: { select: { id: true } }, productionAreas: { where: { cancelledAt: null }, orderBy: { sequence: "asc" } } } });
    if (!order) throw new NotFoundException("订单不存在");
    if (order.stage !== "PRODUCTION") throw new BadRequestException("只有生产执行阶段可以补录车间计划");
    if (order.productionProcesses.length) throw new BadRequestException("该订单已存在生产工序，不能重复下达");
    if (order.productionAreas.length !== 1) throw new BadRequestException("兼容补录仅适用于已有且唯一的生产区域；多区域工序由整单采购完成自动释放");
    const productionAreaId = order.productionAreas[0]!.id;
    const quantities = { PANEL: Number(plans.PANEL), WOOD: Number(plans.WOOD), PAINT: Number(plans.PAINT), ASSEMBLY: Number(plans.ASSEMBLY) };
    if (Object.values(quantities).some((value) => !Number.isFinite(value) || value <= 0)) throw new BadRequestException("四个车间的计划面积必须大于0");
      for (const [workshop, steps] of Object.entries(WORKSHOP_PROCESS_TEMPLATES)) {
        await tx.productionProcess.createMany({ data: steps.map((processName, index) => {
          const assemblyMode = workshop === "ASSEMBLY" && index > 0;
          return { orderId, productionAreaId, workshop, workshopLabel: WORKSHOP_LABELS[workshop as keyof typeof WORKSHOP_LABELS], processCode: `${workshop}-${String(index + 1).padStart(2, "0")}`, processName, sequence: index + 1, plannedQty: assemblyMode ? 1 : quantities[workshop as keyof typeof quantities], unit: assemblyMode ? "项" : "㎡", metricMode: workshop !== "ASSEMBLY" || index === 0 ? "AREA_QUANTITY" : index === 1 ? "REFERENCE_CONFIRMATION" : index === 2 ? "PACKAGE_COUNT" : "MILESTONE" };
        }) });
      }
      await tx.orderEvent.create({ data: { orderId, actorId: employee.id, type: "PRODUCTION_PLAN_BACKFILLED", title: "四车间计划面积已补录", description: `板式 ${quantities.PANEL}㎡、木工 ${quantities.WOOD}㎡、油漆 ${quantities.PAINT}㎡、组装 ${quantities.ASSEMBLY}㎡`, fromStage: "PRODUCTION", toStage: "PRODUCTION", metadata: quantities } });
    });
  }

  async report(orderId: string, input: ProductionReportInput, employee: Employee, meta: MutationMeta = {}) {
    if (!["WORKSHOP", "CHAIRMAN"].includes(employee.role)) throw new ForbiddenException("只有对应工序负责人、所属车间主管或董事长管理员可以报工");
    await requireOrder(this.prisma, orderId, employee);
    return runMutation(this.prisma, employee.id, `orders:${orderId}:production`, input, meta, async (tx) => {
    const order = await requireOrder(tx, orderId, employee);
    assertCurrentVersion(order.updatedAt, meta);
    await validateOrderAttachments(tx, orderId, input, employee);
    if (!["PRODUCTION", "DELIVERY", "INSTALLATION"].includes(order.stage)) throw new BadRequestException("当前订单阶段不能报工");
    if (!["START", "PROGRESS", "COMPLETE", "ISSUE"].includes(input.action)) throw new BadRequestException("报工动作无效");
    const process = await tx.productionProcess.findFirst({ where: { id: input.processId, orderId }, include: { productionRoute: true } });
    if (!process) throw new NotFoundException("生产工序不存在");
    if (!canReportProductionProcess(employee, process)) throw new ForbiddenException("当前账号不是该工序负责人，也不是该车间主管");
    if (process.status === "COMPLETE") throw new BadRequestException("该工序已经完成，修改需走更正记录");
    if (["REFERENCE_CONFIRMATION", "PACKAGE_COUNT"].includes(process.metricMode)) throw new BadRequestException(process.metricMode === "REFERENCE_CONFIRMATION" ? "领五金请在包件统计中确认采购提供的五金包数" : "入库请在包件统计中累计实际包件数");
    if (process.metricMode === "MILESTONE" && !["COMPLETE", "ISSUE"].includes(input.action)) throw new BadRequestException("订单生产完成只记录最终确认或异常");
    const areaProcessesForLock = await tx.productionProcess.findMany({ where: process.productionRouteId ? { orderId, productionRouteId: process.productionRouteId } : { orderId, productionAreaId: process.productionAreaId }, select: { workshop: true, processCode: true, sequence: true, status: true, metricMode: true } });
    assertProductionProcessAvailable(areaProcessesForLock, { ...process, productionRouteReleasedAt: process.productionRoute ? process.productionRoute.releasedAt : undefined });
    const previousQty = Number(process.completedQty);
    const requestedQty = process.metricMode === "MILESTONE" && input.action === "COMPLETE" ? 1 : input.action === "COMPLETE" ? Number(process.plannedQty) : input.completedQty ?? previousQty;
    if (requestedQty < previousQty) throw new BadRequestException("累计完成数量不能小于已报工数量；数量修正需保留更正记录");
    if (input.action === "ISSUE" && !input.note?.trim()) throw new BadRequestException("报异常必须填写问题说明");
    const normalized = normalizeProductionReport({ plannedQty: Number(process.plannedQty), completedQty: requestedQty, action: input.action });
    const now = new Date();

      await tx.productionProcess.update({
        where: { id: process.id },
        data: {
          completedQty: normalized.completedQty,
          status: normalized.status,
          startedAt: process.startedAt ?? (input.action === "START" || normalized.completedQty > 0 ? now : undefined),
          completedAt: normalized.status === "COMPLETE" ? now : null,
          lastReportedAt: now,
          note: input.note?.trim() || process.note,
          updatedBy: employee.id,
        },
      });
      await tx.productionReport.create({
        data: {
          orderId,
          productionAreaId: process.productionAreaId,
          productionProcessId: process.id,
          action: input.action,
          completedQty: normalized.completedQty,
          previousQty,
          note: input.note?.trim() || null,
          attachmentIds: input.attachmentIds as Prisma.InputJsonArray | undefined,
          reportedBy: employee.id,
          reportedAt: now,
        },
      });
      const processes = await tx.productionProcess.findMany({ where: process.productionRouteId ? { orderId, productionRouteId: process.productionRouteId } : { orderId, productionAreaId: process.productionAreaId }, orderBy: [{ workshop: "asc" }, { sequence: "asc" }] });
      const progress = calculateProductionProgress(processes.map((item) => ({ workshop: item.workshop, plannedQty: Number(item.plannedQty), completedQty: Number(item.completedQty), status: item.status, metricMode: item.metricMode })));
      const workshopLabel = WORKSHOP_LABELS[process.workshop as keyof typeof WORKSHOP_LABELS] ?? process.workshopLabel;
      const description = `${workshopLabel} · ${process.processName}：${normalized.completedQty}/${normalized.plannedQty}${process.unit}`;
      if (productionWorkshopComplete(processes.map((item) => ({ workshop: item.workshop, plannedQty: Number(item.plannedQty), completedQty: Number(item.completedQty), status: item.status, metricMode: item.metricMode })), process.workshop)) {
        await this.scheduler.completeProductionWorkshop(orderId, process.productionRouteId, process.workshop, now, tx);
      }

      if (process.productionRouteId && process.productionRoute) {
        if (progress.complete) {
          await tx.productionRoute.update({ where: { id: process.productionRouteId }, data: { productionCompletedAt: now } });
          await tx.task.updateMany({ where: { uniqueKey: { startsWith: `${orderId}:PRODUCTION:${process.productionRouteId}:` }, status: { in: ["PENDING", "OVERDUE"] } }, data: { status: "COMPLETE", completedAt: now } });
        }
        const activeAreas = await tx.productionArea.findMany({
          where: { orderId, cancelledAt: null },
          include: { productionRoutes: { where: { cancelledAt: null }, include: { productionProcesses: true } } },
          orderBy: { sequence: "asc" },
        });
        const projection = projectRouteExecution({
          tailPaymentConfirmed: tailPaymentSatisfied(order),
          areas: activeAreas.map((area) => ({
            id: area.id,
            name: area.name,
            productionNumber: area.productionNumber,
            routes: area.productionRoutes.map((route) => ({
              id: route.id,
              productionAreaId: area.id,
              kind: route.kind,
              assemblyPlanQty: Number(route.assemblyPlanQty),
              releasedAt: route.releasedAt,
              productionCompletedAt: route.productionCompletedAt,
              shippedAt: route.shippedAt,
              processes: route.productionProcesses.map((item) => ({ workshop: item.workshop, processCode: item.processCode, plannedQty: Number(item.plannedQty), completedQty: Number(item.completedQty), status: item.status, metricMode: item.metricMode })),
            })),
          })),
        });
        for (const area of projection.areas.filter((candidate) => candidate.complete)) {
          const storedArea = activeAreas.find((candidate) => candidate.id === area.id);
          await tx.productionArea.update({ where: { id: area.id }, data: { status: "PRODUCTION_COMPLETE", productionCompletedAt: storedArea?.productionCompletedAt ?? now } });
          if (!storedArea?.productionCompletedAt) await tx.orderEvent.create({ data: { orderId, actorId: employee.id, type: "COMPLETE_AREA_ROUTES", title: `${area.name ?? "生产区域"}全部路线完工`, description: `${area.routes.length}条适用路线均已完成生产`, fromStage: order.stage, toStage: order.stage, metadata: { productionAreaId: area.id, productionRouteIds: area.routes.map((route) => route.id) } } });
        }
        const route = projection.routes.find((candidate) => candidate.id === process.productionRouteId)!;
        const area = projection.areas.find((candidate) => candidate.id === process.productionAreaId);
        const nextStage = projection.allProductionComplete ? projection.allProductionShipped ? "INSTALLATION" : "DELIVERY" : "PRODUCTION";
        const nextAction = projection.allProductionComplete
          ? projection.allProductionShipped ? "所有生产路线已发货，继续逐批完成安装" : "所有生产路线已完工，可登记剩余路线发货"
          : route.complete
            ? `${area?.name ?? "当前区域"}·${route.label}已完工；尾款确认后可发货，其他路线继续生产`
            : input.action === "ISSUE"
              ? `处理 ${process.processName} 异常`
              : `继续 ${process.processName} 报工（${normalized.completedQty}/${normalized.plannedQty}${process.unit}）`;
        await tx.order.update({ where: { id: orderId }, data: { stage: nextStage, currentOwnerLabel: route.complete ? "生产车间与订单管理员" : workshopLabel, nextAction } });
        await tx.orderEvent.create({ data: {
          orderId,
          actorId: employee.id,
          type: route.complete ? "COMPLETE_PRODUCTION_ROUTE" : `PRODUCTION_${input.action}`,
          title: route.complete ? `${area?.name ?? "生产区域"}·${route.label}生产完成` : input.action === "ISSUE" ? "车间工序异常" : "车间部分报工",
          description: route.complete ? `${description}；该路线全部生产工序已完成` : description,
          fromStage: order.stage,
          toStage: nextStage,
          metadata: { productionAreaId: process.productionAreaId, productionRouteId: route.id, processId: process.id, routeProgress: progress, orderProductionPercent: projection.productionPercent, note: input.note ?? null } as unknown as Prisma.InputJsonObject,
        } });
        if (route.complete) {
          await tx.stageSubmission.create({ data: { orderId, stage: "PRODUCTION", command: "COMPLETE_PRODUCTION_ROUTE", status: "SUBMITTED", payload: { productionAreaId: process.productionAreaId, productionRouteId: route.id, ...progress } as unknown as Prisma.InputJsonObject, submittedBy: employee.id } });
          await this.scheduler.planStage(orderId, "DELIVERY", now, tx);
        }
        return { ...progress, orderProductionPercent: projection.productionPercent, routeId: route.id };
      }

      if (progress.complete) {
        if (process.productionAreaId) await tx.productionArea.update({ where: { id: process.productionAreaId }, data: { status: "PRODUCTION_COMPLETE", productionCompletedAt: now } });
      }
      const activeAreas = await tx.productionArea.findMany({ where: { orderId, cancelledAt: null }, include: { productionProcesses: true, shipmentAreas: true }, orderBy: { sequence: "asc" } });
      const areaStates = activeAreas.map((area) => ({
        id: area.id,
        name: area.name,
        productionNumber: area.productionNumber,
        shipped: area.shipmentAreas.some((line) => line.isFinalBatch),
        progress: calculateProductionProgress(area.productionProcesses.map((item) => ({ workshop: item.workshop, plannedQty: Number(item.plannedQty), completedQty: Number(item.completedQty), status: item.status, metricMode: item.metricMode }))),
      }));
      const allAreasComplete = areaStates.length > 0 && areaStates.every((area) => area.progress.complete);
      const allAreasFinalShipped = areaStates.length > 0 && areaStates.every((area) => area.shipped);
      const nextStage = allAreasComplete ? allAreasFinalShipped ? "INSTALLATION" : "DELIVERY" : "PRODUCTION";
      const area = areaStates.find((item) => item.id === process.productionAreaId);
      const nextAction = allAreasComplete
        ? allAreasFinalShipped ? "所有生产区域已完工并登记末批，继续逐批完成安装" : "所有生产区域已完工，继续按区域登记发货批次"
        : progress.complete
          ? `${area?.name ?? "当前区域"}已完工；继续完成其余生产区域`
          : input.action === "ISSUE"
            ? `处理 ${process.processName} 异常`
            : `继续 ${process.processName} 报工（${normalized.completedQty}/${normalized.plannedQty}${process.unit}）`;
      await tx.order.update({ where: { id: orderId }, data: { stage: nextStage, productionReady: allAreasComplete, currentOwnerLabel: allAreasComplete ? "订单管理员" : workshopLabel, nextAction } });
      await tx.orderEvent.create({
        data: {
          orderId,
          actorId: employee.id,
          type: progress.complete ? "COMPLETE_PRODUCTION_AREA" : `PRODUCTION_${input.action}`,
          title: progress.complete ? `${area?.name ?? "生产区域"}生产完成` : input.action === "ISSUE" ? "车间工序异常" : "车间部分报工",
          description: progress.complete ? `${description}；该区域全部已创建工序达到计划数量` : description,
          fromStage: "PRODUCTION",
          toStage: nextStage,
          metadata: { productionAreaId: process.productionAreaId, processId: process.id, areaProgress: progress, allAreasComplete, note: input.note ?? null } as unknown as Prisma.InputJsonObject,
        },
      });
      if (progress.complete) await tx.stageSubmission.create({ data: { orderId, stage: "PRODUCTION", command: "COMPLETE_PRODUCTION_AREA", status: "SUBMITTED", payload: { productionAreaId: process.productionAreaId, ...progress } as unknown as Prisma.InputJsonObject, submittedBy: employee.id } });
      if (allAreasComplete) {
        await this.scheduler.completeStage(orderId, "PRODUCTION", now, tx);
        await this.scheduler.planStage(orderId, nextStage, now, tx);
      }
      return progress;
    }, orderId);
  }

  async bulkComplete(orderId: string, input: { productionAreaId: string; productionRouteId?: string; workshop?: string }, employee: Employee, meta: MutationMeta = {}) {
    if (employee.role !== "CHAIRMAN" && !(employee.role === "WORKSHOP" && employee.level === "SUPERVISOR" && employee.workshop)) throw new ForbiddenException("只有对应车间主管或董事长管理员可以一键报工");
    await requireOrder(this.prisma, orderId, employee);
    return runMutation(this.prisma, employee.id, `orders:${orderId}:production:bulk`, input, meta, async (tx) => {
      const order = await requireOrder(tx, orderId, employee);
      assertCurrentVersion(order.updatedAt, meta);
      if (!["PRODUCTION", "DELIVERY", "INSTALLATION"].includes(order.stage)) throw new BadRequestException("当前订单阶段不能一键报工");
      const workshop = employee.role === "CHAIRMAN" ? String(input.workshop ?? "") : String(employee.workshop);
      if (!Object.keys(WORKSHOP_PROCESS_TEMPLATES).includes(workshop)) throw new BadRequestException("请选择要完成的车间");
      const area = await tx.productionArea.findFirst({ where: { id: input.productionAreaId, orderId, cancelledAt: null } });
      if (!area) throw new NotFoundException("生产区域不存在");
      if (input.productionRouteId) {
        const route = await tx.productionRoute.findFirst({ where: { id: input.productionRouteId, orderId, productionAreaId: area.id, cancelledAt: null } });
        if (!route) throw new BadRequestException("生产路线不属于当前区域");
      }
      const scope = input.productionRouteId ? { orderId, productionRouteId: input.productionRouteId } : { orderId, productionAreaId: area.id, productionRouteId: null };
      const processes = await tx.productionProcess.findMany({ where: scope, include: { productionRoute: true }, orderBy: [{ workshop: "asc" }, { sequence: "asc" }] });
      if (processes.some((process) => process.status === "ISSUE")) throw new BadRequestException("当前区域或路线存在未处理异常，不能一键完成");
      const targets = processes.filter((process) => process.workshop === workshop && process.status !== "COMPLETE" && !["REFERENCE_CONFIRMATION", "PACKAGE_COUNT"].includes(process.metricMode));
      if (!targets.length) throw new BadRequestException("当前车间没有可一键完成的普通工序");
      const now = new Date();
      const mutable = processes.map((process) => ({ ...process }));
      const completed: string[] = [];
      let advanced = true;
      while (advanced) {
        advanced = false;
        for (const target of targets) {
          if (completed.includes(target.id)) continue;
          const current = mutable.find((process) => process.id === target.id)!;
          const availability = (() => {
            try {
              assertProductionProcessAvailable(mutable, { ...current, productionRouteReleasedAt: current.productionRoute ? current.productionRoute.releasedAt : undefined });
              return true;
            } catch { return false; }
          })();
          if (!availability) continue;
          const previousQty = Number(current.completedQty);
          await tx.productionProcess.update({ where: { id: current.id }, data: { completedQty: current.plannedQty, status: "COMPLETE", startedAt: current.startedAt ?? now, completedAt: now, lastReportedAt: now, updatedBy: employee.id } });
          await tx.productionReport.create({ data: { orderId, productionAreaId: area.id, productionProcessId: current.id, action: "COMPLETE", completedQty: current.plannedQty, previousQty, note: "车间主管一键报工", reportedBy: employee.id, reportedAt: now } });
          current.completedQty = current.plannedQty;
          current.status = "COMPLETE";
          completed.push(current.id);
          advanced = true;
        }
      }
      if (!completed.length || completed.length !== targets.length) throw new BadRequestException("仍有前序工序未完成，无法完成当前车间全部工序");
      const refreshed = await tx.productionProcess.findMany({ where: scope, orderBy: [{ workshop: "asc" }, { sequence: "asc" }] });
      const progress = calculateProductionProgress(refreshed.map((item) => ({ workshop: item.workshop, plannedQty: Number(item.plannedQty), completedQty: Number(item.completedQty), status: item.status, metricMode: item.metricMode })));
      if (progress.workshops[workshop]?.complete) await this.scheduler.completeProductionWorkshop(orderId, input.productionRouteId ?? null, workshop, now, tx);
      if (input.productionRouteId && progress.complete) {
        await tx.productionRoute.update({ where: { id: input.productionRouteId }, data: { productionCompletedAt: now } });
        await tx.task.updateMany({ where: { uniqueKey: { startsWith: `${orderId}:PRODUCTION:${input.productionRouteId}:` }, status: { in: ["PENDING", "OVERDUE"] } }, data: { status: "COMPLETE", completedAt: now } });
      }
      if (!input.productionRouteId && progress.complete) await tx.productionArea.update({ where: { id: area.id }, data: { status: "PRODUCTION_COMPLETE", productionCompletedAt: now } });
      const activeAreas = await tx.productionArea.findMany({ where: { orderId, cancelledAt: null }, include: { productionProcesses: true, shipmentAreas: true, productionRoutes: { where: { cancelledAt: null }, include: { productionProcesses: true } } } });
      const summarize = (rows: typeof refreshed) => calculateProductionProgress(rows.map((item) => ({ workshop: item.workshop, plannedQty: Number(item.plannedQty), completedQty: Number(item.completedQty), status: item.status, metricMode: item.metricMode })));
      const allProductionComplete = activeAreas.length > 0 && activeAreas.every((candidate) => candidate.productionRoutes.length
        ? candidate.productionRoutes.every((route) => summarize(route.productionProcesses).complete)
        : summarize(candidate.productionProcesses).complete);
      const allShipped = activeAreas.length > 0 && activeAreas.every((candidate) => candidate.productionRoutes.length ? candidate.productionRoutes.every((route) => route.shippedAt) : candidate.shipmentAreas.some((line) => line.isFinalBatch));
      const nextStage = allProductionComplete ? allShipped ? "INSTALLATION" : "DELIVERY" : order.stage;
      await tx.order.update({ where: { id: orderId }, data: { stage: nextStage, productionReady: allProductionComplete, currentOwnerLabel: allProductionComplete ? "订单管理员" : "生产车间", nextAction: allProductionComplete ? (allShipped ? "继续逐批完成安装" : "生产已完成，可登记发货") : "继续其他车间报工", updatedAt: now } });
      if (progress.complete) await tx.stageSubmission.create({ data: { orderId, stage: "PRODUCTION", command: input.productionRouteId ? "COMPLETE_PRODUCTION_ROUTE" : "COMPLETE_PRODUCTION_AREA", status: "SUBMITTED", payload: { productionAreaId: area.id, productionRouteId: input.productionRouteId ?? null, bulk: true, ...progress } as unknown as Prisma.InputJsonObject, submittedBy: employee.id } });
      if (input.productionRouteId && progress.complete) await this.scheduler.planStage(orderId, "DELIVERY", now, tx);
      if (allProductionComplete) {
        await this.scheduler.completeStage(orderId, "PRODUCTION", now, tx);
        await this.scheduler.planStage(orderId, nextStage, now, tx);
      }
      await tx.orderEvent.create({ data: { orderId, actorId: employee.id, type: "PRODUCTION_BULK_COMPLETE", title: `${WORKSHOP_LABELS[workshop as keyof typeof WORKSHOP_LABELS]}一键报工完成`, description: `${area.name}·完成${completed.length}道工序`, fromStage: order.stage, toStage: nextStage, metadata: { productionAreaId: area.id, productionRouteId: input.productionRouteId ?? null, workshop, processIds: completed } as Prisma.InputJsonObject } });
      return { completedProcessIds: completed, progress };
    }, orderId);
  }
}
