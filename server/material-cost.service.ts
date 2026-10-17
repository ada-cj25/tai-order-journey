import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Employee, MaterialLine, Prisma } from "./generated/prisma/client.js";
import { addInternalWorkingDays, businessTypeLabels } from "./domain/rules.js";
import { WORKSHOP_LABELS, WORKSHOP_PROCESS_TEMPLATES } from "./domain/production-progress.js";
import { materialCostIdentity } from "./domain/material-cost-identity.js";
import { PrismaService } from "./prisma.service.js";
import { TaskScheduler } from "./scheduler.service.js";
import { assertCostEnabled, costEnabled } from "./runtime-config.js";
import { redactOrderCosts, redactOrderFinancialAmounts } from "./order-access.js";
import { runMutation, assertCurrentVersion, type MutationMeta } from "./mutations.js";
import { calculateWorkshopCostLines, summarizeAfterSalesCosts, summarizeInstallationCosts, summarizeOutsourceCosts, WORKSHOP_COST_LABELS, type WorkshopCostCode } from "./domain/cost-accounting.js";
import { PRODUCTION_ROUTE_LABELS, type ProductionRouteKind } from "./domain/route-execution.js";
import { isInternalException, tailPaymentSatisfied } from "./domain/commercial-policy.js";

type Tx = Prisma.TransactionClient;

const PROCUREMENT_VIEW_ROLES = ["PROCUREMENT", "FINANCE", "CHAIRMAN"];
const COST_ROLES = ["FINANCE", "CHAIRMAN"];
const PRICE_EDIT_ROLES = ["FINANCE", "CHAIRMAN"];
const PROCUREMENT_COMPLETE_ROLES = ["PROCUREMENT", "CHAIRMAN"];
const WORKSHOP_CODES = Object.keys(WORKSHOP_COST_LABELS) as WorkshopCostCode[];

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

@Injectable()
export class MaterialCostService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(TaskScheduler) private readonly scheduler: TaskScheduler) {}

  canSee(employee: Employee) {
    return costEnabled() && COST_ROLES.includes(employee.role);
  }

  async listOrders(employee: Employee) {
    if (!PROCUREMENT_VIEW_ROLES.includes(employee.role)) throw new ForbiddenException("当前角色无权查看采购订单");
    const orders = await this.prisma.order.findMany({
      include: {
        procurementCompletion: true,
        procurementRouteGates: { orderBy: { kind: "asc" } },
        productionAreas: { where: { cancelledAt: null }, include: { productionRoutes: { where: { cancelledAt: null }, select: { id: true, kind: true, procurementRouteGateId: true, releasedAt: true } }, materialCostVersions: { orderBy: { version: "desc" }, take: 1 }, workshopCostVersions: { orderBy: { version: "desc" }, take: 1 }, materialVersions: { where: { status: { in: ["PUBLISHED", "WAREHOUSE_RELEASED"] } }, orderBy: { version: "desc" }, take: 1, select: { id: true, version: true, releasedAt: true } } }, orderBy: { sequence: "asc" } },
        shipments: { where: { kind: "MANUFACTURED" }, include: { areas: true }, orderBy: { deliveredAt: "asc" } },
        aftersales: { include: { costBatches: true } },
        outsourceRequirementVersions: { where: { status: "APPROVED" }, include: { lines: { include: { arrivals: { orderBy: { arrivedOn: "desc" } }, shipmentLine: true }, orderBy: { sequence: "asc" } } }, orderBy: { version: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
    });
    const outsourcePrices = this.canSee(employee) ? await this.prisma.outsourceProductCostVersion.findMany({
      where: { productLine: { orderId: { in: orders.map((order) => order.id) } } },
      orderBy: { version: "desc" },
    }) : [];
    const latestOutsourcePrice = new Map<string, number>();
    for (const price of outsourcePrices) if (!latestOutsourcePrice.has(price.productLineId)) latestOutsourcePrice.set(price.productLineId, Number(price.unitPrice));
    const now = new Date();
    return orders.map((order) => {
      const costs = order.productionAreas.map((area) => area.materialCostVersions[0]).filter(Boolean);
      const missingPriceCount = costs.reduce((sum, cost) => sum + (cost?.missingPriceCount ?? 0), 0);
      const subtotal = costs.reduce((sum, cost) => sum + Number(cost?.pricedSubtotal ?? 0), 0);
      const allComplete = costs.length === order.productionAreas.length && costs.every((cost) => cost?.status === "COMPLETE");
      const workshopTotal = round2(order.productionAreas.reduce((sum, area) => sum + Number(area.workshopCostVersions[0]?.totalCost ?? 0), 0));
      const workshopComplete = order.productionAreas.length > 0 && order.productionAreas.every((area) => Boolean(area.workshopCostVersions[0]));
      const installation = summarizeInstallationCosts(order.shipments, order.productionAreas.map((area) => area.id));
      const afterSalesCostSubtotal = summarizeAfterSalesCosts(order.aftersales.flatMap((caseItem) => caseItem.costBatches)).subtotal;
      const outsourceCost = summarizeOutsourceCosts((order.outsourceRequirementVersions[0]?.lines ?? []).map((line) => ({ plannedQty: line.plannedQty, unitPrice: latestOutsourcePrice.get(line.id) ?? null })));
      const knownCostSubtotal = round2(subtotal + workshopTotal + installation.subtotal + afterSalesCostSubtotal + outsourceCost.subtotal);
      const fullCostComplete = allComplete && workshopComplete && installation.complete && outsourceCost.complete;
      const dueAt = order.procurementDueAt;
      const completedAt = order.procurementCompletedAt;
      const remainingHours = dueAt ? (dueAt.getTime() - now.getTime()) / 3_600_000 : null;
      const procurementStatus = completedAt
        ? order.procurementDelayDays > 0 ? "COMPLETED_LATE" : "COMPLETED_ON_TIME"
        : !dueAt ? "NOT_STARTED" : remainingHours! < 0 ? "OVERDUE" : remainingHours! <= 48 ? "DUE_SOON" : "PENDING";
      const { aftersales: _aftersales, ...orderWithoutAfterSales } = order;
      return {
        ...redactOrderFinancialAmounts(redactOrderCosts(orderWithoutAfterSales, employee.role), employee, order),
        productionAreas: order.productionAreas.map((area) => ({ id: area.id, name: area.name, productionNumber: area.productionNumber, materialVersion: area.materialVersions[0] ?? null, routes: area.productionRoutes })),
        procurementRoutes: order.procurementRouteGates.map((gate) => ({
          ...gate,
          routes: order.productionAreas.flatMap((area) => area.productionRoutes.filter((route) => route.procurementRouteGateId === gate.id).map((route) => ({ ...route, productionAreaId: area.id, productionArea: { id: area.id, name: area.name, productionNumber: area.productionNumber } }))),
          affectedProductionNumbers: order.productionAreas.filter((area) => area.productionRoutes.some((route) => route.procurementRouteGateId === gate.id)).map((area) => area.productionNumber),
        })),
        materialVersion: order.productionAreas[0]?.materialVersions[0] ?? null,
        businessTypeLabel: businessTypeLabels[order.businessType],
        costStatus: this.canSee(employee) ? (!costs.length ? "NOT_PARSED" : !allComplete ? "WAITING_PRICE" : !outsourceCost.complete ? "WAITING_OUTSOURCE_PRICE" : fullCostComplete ? "COMPLETE" : "INSTALLATION_PENDING") : "FINANCE_MANAGED",
        costSubtotal: this.canSee(employee) ? knownCostSubtotal : null,
        costTotal: this.canSee(employee) && fullCostComplete ? knownCostSubtotal : null,
        materialCostTotal: this.canSee(employee) && allComplete ? round2(subtotal) : null,
        workshopCostTotal: this.canSee(employee) && workshopComplete ? workshopTotal : null,
        installationCostSubtotal: this.canSee(employee) ? installation.subtotal : null,
        afterSalesCostSubtotal: this.canSee(employee) ? afterSalesCostSubtotal : null,
        outsourceCostSubtotal: this.canSee(employee) ? outsourceCost.subtotal : null,
        missingOutsourcePriceCount: this.canSee(employee) ? outsourceCost.missingPriceCount : null,
        afterSalesCostStatus: this.canSee(employee) ? "CUMULATIVE" : null,
        missingPriceCount: this.canSee(employee) ? missingPriceCount : null,
        procurementStatus,
        outsourceRequirement: order.outsourceRequirementVersions[0] ? {
          ...order.outsourceRequirementVersions[0],
          lines: order.outsourceRequirementVersions[0].lines.map((line) => ({ ...line, plannedQty: Number(line.plannedQty), arrivals: line.arrivals.map((arrival) => ({ ...arrival, quantity: Number(arrival.quantity) })) })),
        } : null,
      };
    });
  }

  async listItems(employee: Employee) {
    assertCostEnabled();
    if (!this.canSee(employee)) throw new ForbiddenException("当前角色无权查看物料成本");
    const items = await this.prisma.materialCostItem.findMany({
      include: {
        priceVersions: { orderBy: { version: "desc" }, take: 20 },
        _count: { select: { orderLines: true } },
      },
      orderBy: [{ status: "desc" }, { lastSeenAt: "desc" }],
    });
    return items.map((item) => ({
      ...item,
      currentPrice: item.priceVersions[0] ? Number(item.priceVersions[0].unitPrice) : null,
      referenceCount: item._count.orderLines,
      priceVersions: item.priceVersions.map((price) => ({ ...price, unitPrice: Number(price.unitPrice) })),
      _count: undefined,
    })).sort((left, right) => {
      if (left.status !== right.status) return left.status === "WAITING_PRICE" ? -1 : 1;
      return right.lastSeenAt.getTime() - left.lastSeenAt.getTime();
    });
  }

  async listWorkshopRates(employee: Employee) {
    assertCostEnabled();
    if (!this.canSee(employee)) throw new ForbiddenException("当前角色无权查看车间综合单价");
    const rows = await this.prisma.workshopCostRateVersion.findMany({ orderBy: [{ workshop: "asc" }, { version: "desc" }] });
    return WORKSHOP_CODES.map((workshop) => {
      const versions = rows.filter((row) => row.workshop === workshop);
      return {
        workshop,
        workshopLabel: WORKSHOP_COST_LABELS[workshop],
        currentPrice: versions[0] ? Number(versions[0].unitPrice) : null,
        priceVersions: versions.map((row) => ({ ...row, unitPrice: Number(row.unitPrice) })),
      };
    });
  }

  async addWorkshopRate(workshop: string, employee: Employee, input: { unitPrice: number; note?: string }) {
    assertCostEnabled();
    if (!PRICE_EDIT_ROLES.includes(employee.role)) throw new ForbiddenException("只有财务或董事长管理员可以维护车间综合单价");
    if (!WORKSHOP_CODES.includes(workshop as WorkshopCostCode)) throw new BadRequestException("车间类型无效");
    const unitPrice = Number(input.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw new BadRequestException("车间综合单价必须大于0");
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workshop-cost-rate:${workshop}`}))`;
      const latest = await tx.workshopCostRateVersion.findFirst({ where: { workshop }, orderBy: { version: "desc" } });
      return tx.workshopCostRateVersion.create({ data: { workshop, version: (latest?.version ?? 0) + 1, unitPrice, createdBy: employee.id, note: input.note?.trim() || null } });
    });
  }

  async addOutsourceCostPrice(orderId: string, lineId: string, employee: Employee, input: { unitPrice: number; note?: string }) {
    assertCostEnabled();
    if (!PRICE_EDIT_ROLES.includes(employee.role)) throw new ForbiddenException("只有财务或董事长管理员可以维护外购成本");
    const unitPrice = Number(input.unitPrice);
    if (typeof input.unitPrice !== "number" || !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 999999999999.9999 || Number(unitPrice.toFixed(4)) !== unitPrice) throw new BadRequestException("外购单位成本需为不超过四位小数的非负金额");
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outsource-cost:${lineId}`}))`;
      const line = await tx.outsourceProductLine.findFirst({ where: { id: lineId, orderId, requirementVersion: { status: "APPROVED" } } });
      if (!line) throw new NotFoundException("当前已审批的外购产品不存在");
      const latest = await tx.outsourceProductCostVersion.findFirst({ where: { productLineId: lineId }, orderBy: { version: "desc" } });
      const note = input.note?.trim() || null;
      if (latest && !note) throw new BadRequestException("调整外购成本时请填写原因");
      const price = await tx.outsourceProductCostVersion.create({ data: { productLineId: lineId, version: (latest?.version ?? 0) + 1, unitPrice, createdBy: employee.id, note } });
      await tx.orderEvent.create({ data: { orderId, actorId: employee.id, type: "UPDATE_OUTSOURCE_COST", title: "外购产品成本已更新", description: `财务已更新${line.name}的成本版本`, metadata: { productLineId: lineId, costVersionId: price.id, version: price.version } } });
      return { id: price.id, version: price.version };
    });
  }

  async orderCost(orderId: string, employee: Employee) {
    assertCostEnabled();
    if (!this.canSee(employee)) return null;
    const commercial = await this.prisma.order.findUnique({ where: { id: orderId }, select: { amount: true, creationMode: true, chargeMode: true, commercialConfirmedAt: true } });
    if (!commercial) throw new NotFoundException("订单不存在");
    const areas = await this.prisma.productionArea.findMany({
      where: { orderId, cancelledAt: null },
      include: {
        materialCostVersions: { include: { lines: { include: { costItem: true }, orderBy: { costItem: { normalizedName: "asc" } } }, materialVersion: true }, orderBy: { version: "desc" }, take: 1 },
        workshopCostVersions: { include: { lines: { orderBy: { workshop: "asc" } } }, orderBy: { version: "desc" }, take: 1 },
      },
      orderBy: { sequence: "asc" },
    });
    const versions = areas.map((area) => ({ area, version: area.materialCostVersions[0] })).filter((entry) => Boolean(entry.version));
    if (!versions.length) return null;
    const missingPriceCount = versions.reduce((sum, entry) => sum + entry.version!.missingPriceCount, 0);
    const pricedSubtotal = round2(versions.reduce((sum, entry) => sum + Number(entry.version!.pricedSubtotal), 0));
    const complete = versions.length === areas.length && versions.every((entry) => entry.version!.status === "COMPLETE");
    const workshopVersions = areas.map((area) => ({ area, version: area.workshopCostVersions[0] })).filter((entry) => Boolean(entry.version));
    const workshopTotal = round2(workshopVersions.reduce((sum, entry) => sum + Number(entry.version!.totalCost), 0));
    const workshopComplete = areas.length > 0 && workshopVersions.length === areas.length;
    const shipments = await this.prisma.shipment.findMany({ where: { orderId, kind: "MANUFACTURED" }, include: { areas: true }, orderBy: { deliveredAt: "asc" } });
    const installation = summarizeInstallationCosts(shipments, areas.map((area) => area.id));
    const afterSalesCases = await this.prisma.afterSalesCase.findMany({ where: { orderId }, include: { costBatches: { orderBy: { recordedAt: "desc" } } }, orderBy: { createdAt: "desc" } });
    const afterSalesBatches = afterSalesCases.flatMap((caseItem) => caseItem.costBatches.map((batch) => ({ ...batch, caseId: caseItem.id, caseNumber: caseItem.caseNumber, amount: Number(batch.amount) })));
    const afterSalesSubtotal = summarizeAfterSalesCosts(afterSalesBatches).subtotal;
    const outsourceVersion = await this.prisma.outsourceRequirementVersion.findFirst({ where: { orderId, status: "APPROVED" }, include: { lines: { include: { costVersions: { orderBy: { version: "desc" }, take: 20 } }, orderBy: { sequence: "asc" } } }, orderBy: { version: "desc" } });
    const outsourceLines = outsourceVersion?.lines.map((line) => {
      const latest = line.costVersions[0];
      return { id: line.id, name: line.name, usageArea: line.usageArea, plannedQty: Number(line.plannedQty), unit: line.unit, unitPrice: latest ? Number(latest.unitPrice) : null, lineTotal: latest ? round2(Number(line.plannedQty) * Number(latest.unitPrice)) : null, priceVersions: line.costVersions.map((price) => ({ id: price.id, version: price.version, unitPrice: Number(price.unitPrice), createdAt: price.createdAt, note: price.note })) };
    }) ?? [];
    const outsourceCost = summarizeOutsourceCosts(outsourceLines);
    const knownSubtotal = round2(pricedSubtotal + workshopTotal + installation.subtotal + afterSalesSubtotal + outsourceCost.subtotal);
    const baseCostComplete = complete && workshopComplete && installation.complete && outsourceCost.complete;
    const grandTotal = baseCostComplete ? knownSubtotal : null;
    const marginApplicable = commercial.amount != null && !(commercial.creationMode === "INTERNAL_EXCEPTION" && commercial.chargeMode === "FREE" && commercial.commercialConfirmedAt);
    const revenue = marginApplicable ? Number(commercial.amount) : null;
    const grossProfit = revenue != null && grandTotal != null ? round2(revenue - grandTotal) : null;
    const grossMarginRate = grossProfit != null && revenue != null && revenue > 0 ? Math.round((grossProfit / revenue) * 10_000) / 100 : null;
    const material = {
      status: complete ? "COMPLETE" : "WAITING_PRICE",
      pricedSubtotal,
      totalCost: complete ? pricedSubtotal : null,
      missingPriceCount,
    };
    return {
      id: `order:${orderId}:aggregate`,
      version: Math.max(...versions.map((entry) => entry.version!.version)),
      status: complete ? "COMPLETE" : "WAITING_PRICE",
      pricedSubtotal,
      totalCost: complete ? pricedSubtotal : null,
      missingPriceCount,
      material,
      workshop: {
        status: workshopComplete ? "COMPLETE" : "PENDING",
        totalCost: workshopComplete ? workshopTotal : null,
        areas: workshopVersions.map(({ area, version }) => ({ id: area.id, name: area.name, productionNumber: area.productionNumber, costVersionId: version!.id, totalCost: Number(version!.totalCost), lines: version!.lines.map((line) => ({ ...line, quantity: Number(line.quantity), unitPriceSnapshot: Number(line.unitPriceSnapshot), lineTotal: Number(line.lineTotal) })) })),
      },
      installation: {
        status: installation.complete ? "COMPLETE" : shipments.length ? "IN_PROGRESS" : "NOT_STARTED",
        ...installation,
        batches: shipments.map((shipment, index) => ({ ...shipment, batchNo: index + 1, transportCost: shipment.transportCost == null ? null : Number(shipment.transportCost), areas: shipment.areas.map((line) => ({ ...line, installationFee: line.installationFee == null ? null : Number(line.installationFee) })) })),
      },
      aftersales: { status: "CUMULATIVE", subtotal: afterSalesSubtotal, batches: afterSalesBatches },
      outsource: { status: outsourceCost.complete ? "COMPLETE" : "WAITING_PRICE", ...outsourceCost, lines: outsourceLines },
      knownSubtotal,
      grandTotal,
      marginApplicable,
      marginStatus: marginApplicable ? grossProfit == null ? "WAITING_COST" : "AVAILABLE" : "NOT_APPLICABLE",
      revenue,
      grossProfit,
      grossMarginRate,
      overallStatus: !complete ? "WAITING_MATERIAL_PRICE" : !workshopComplete ? "WAITING_WORKSHOP_COST" : !outsourceCost.complete ? "WAITING_OUTSOURCE_PRICE" : installation.complete ? "COMPLETE" : "WAITING_INSTALLATION_COST",
      areas: versions.map((entry) => ({ id: entry.area.id, name: entry.area.name, productionNumber: entry.area.productionNumber, costVersionId: entry.version!.id })),
      lines: versions.flatMap(({ area, version }) => version!.lines.map((line) => ({
        ...line,
        productionArea: { id: area.id, name: area.name, productionNumber: area.productionNumber },
        quantity: Number(line.quantity),
        unitPriceSnapshot: line.unitPriceSnapshot == null ? null : Number(line.unitPriceSnapshot),
        lineTotal: line.lineTotal == null ? null : Number(line.lineTotal),
      }))),
    };
  }

  async createWorkshopForTechnicalPackage(tx: Tx, orderId: string, productionAreaId: string, technicalPackage: { id: string; panelEnabled: boolean; woodPaintEnabled: boolean; panelPlanQty: unknown; woodPlanQty: unknown; paintPlanQty: unknown; assemblyPlanQty: unknown; panelAssemblyPlanQty?: unknown; woodPaintAssemblyPlanQty?: unknown }) {
    const rateRows = await tx.workshopCostRateVersion.findMany({ orderBy: [{ workshop: "asc" }, { version: "desc" }] });
    const currentRates = WORKSHOP_CODES.map((workshop) => rateRows.find((row) => row.workshop === workshop)).filter(Boolean).map((row) => ({ id: row!.id, workshop: row!.workshop, version: row!.version, unitPrice: Number(row!.unitPrice) }));
    let lines;
    try {
      lines = calculateWorkshopCostLines({ panelEnabled: technicalPackage.panelEnabled, woodPaintEnabled: technicalPackage.woodPaintEnabled, panelPlanQty: Number(technicalPackage.panelPlanQty), woodPlanQty: Number(technicalPackage.woodPlanQty), paintPlanQty: Number(technicalPackage.paintPlanQty), assemblyPlanQty: Number(technicalPackage.assemblyPlanQty) }, currentRates);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "车间成本无法计算");
    }
    const latest = await tx.orderWorkshopCostVersion.findFirst({ where: { productionAreaId }, orderBy: { version: "desc" } });
    const version = await tx.orderWorkshopCostVersion.create({ data: { orderId, productionAreaId, technicalPackageId: technicalPackage.id, version: (latest?.version ?? 0) + 1, totalCost: round2(lines.reduce((sum, line) => sum + line.lineTotal, 0)) } });
    const assemblyBreakdown = [
      ...(technicalPackage.panelEnabled ? [{ route: "板式路线", quantity: Number(technicalPackage.panelAssemblyPlanQty ?? 0), unit: "㎡" }] : []),
      ...(technicalPackage.woodPaintEnabled ? [{ route: "实木油漆路线", quantity: Number(technicalPackage.woodPaintAssemblyPlanQty ?? 0), unit: "㎡" }] : []),
    ];
    await tx.orderWorkshopCostLine.createMany({ data: lines.map((line) => ({ costVersionId: version.id, workshop: line.workshop, workshopLabel: line.workshopLabel, quantity: line.quantity, unit: line.unit, unitPriceSnapshot: line.unitPriceSnapshot, rateVersionId: line.rateVersionId, lineTotal: line.lineTotal, routeBreakdown: line.workshop === "ASSEMBLY" && assemblyBreakdown.some((entry) => entry.quantity > 0) ? assemblyBreakdown : undefined })) });
    return version;
  }

  async createForMaterialVersion(tx: Tx, orderId: string, productionAreaId: string, materialVersionId: string, lines: MaterialLine[]) {
    const latest = await tx.orderMaterialCostVersion.findFirst({ where: { productionAreaId }, orderBy: { version: "desc" } });
    const costVersion = await tx.orderMaterialCostVersion.create({ data: { orderId, productionAreaId, materialVersionId, version: (latest?.version ?? 0) + 1 } });
    const grouped = new Map<string, { line: MaterialLine; identity: ReturnType<typeof materialCostIdentity>; quantity: number; sources: Array<Record<string, unknown>> }>();
    for (const line of lines) {
      const identity = materialCostIdentity(line.normalizedName, line.specification, line.unit);
      const key = `${identity.normalizedName.toLowerCase()}|${identity.specificationKey}|${identity.unit}`;
      const source = { templateType: line.templateType, fileName: line.sourceFileName, sheet: line.sourceSheet, row: line.sourceRow, subRow: line.sourceSubRow, rawName: line.rawName, calculationSource: line.calculationSource };
      const current = grouped.get(key);
      if (current) { current.quantity += Number(line.purchaseQty); current.sources.push(source); }
      else grouped.set(key, { line, identity, quantity: Number(line.purchaseQty), sources: [source] });
    }
    let subtotal = 0;
    let missing = 0;
    for (const group of grouped.values()) {
      const { normalizedName, specification, specificationKey, unit } = group.identity;
      const item = await tx.materialCostItem.upsert({
        where: { normalizedName_specificationKey_unit: { normalizedName, specificationKey, unit } },
        create: { normalizedName, specification, specificationKey, unit, category: group.line.category, firstSource: `${group.line.templateType} · ${group.line.sourceFileName}`, status: "WAITING_PRICE" },
        update: { lastSeenAt: new Date() },
      });
      const price = await tx.materialCostPriceVersion.findFirst({ where: { itemId: item.id }, orderBy: { version: "desc" } });
      const lineTotal = price ? round2(group.quantity * Number(price.unitPrice)) : null;
      if (lineTotal == null) missing += 1; else subtotal += lineTotal;
      await tx.orderMaterialCostLine.create({
        data: { costVersionId: costVersion.id, costItemId: item.id, quantity: group.quantity, unit, unitPriceSnapshot: price?.unitPrice, priceVersionId: price?.id, lineTotal, sourceRefs: group.sources as Prisma.InputJsonArray },
      });
    }
    const status = missing ? "WAITING_PRICE" : "COMPLETE";
    await tx.orderMaterialCostVersion.update({ where: { id: costVersion.id }, data: { status, pricedSubtotal: round2(subtotal), totalCost: missing ? null : round2(subtotal), missingPriceCount: missing } });
    await this.refreshOrderCostAggregate(tx, orderId);
    return costVersion;
  }

  async addPrice(itemId: string, employee: Employee, input: { unitPrice: number; note?: string }) {
    assertCostEnabled();
    if (!PRICE_EDIT_ROLES.includes(employee.role)) throw new ForbiddenException("只有财务人员可以维护物料单位成本");
    const unitPrice = Number(input.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw new BadRequestException("单位成本必须大于0");
    const result = await this.prisma.$transaction(async (tx) => {
      const item = await tx.materialCostItem.findUnique({ where: { id: itemId } });
      if (!item) throw new NotFoundException("物料成本项不存在");
      const latest = await tx.materialCostPriceVersion.findFirst({ where: { itemId }, orderBy: { version: "desc" } });
      const price = await tx.materialCostPriceVersion.create({ data: { itemId, version: (latest?.version ?? 0) + 1, unitPrice, createdBy: employee.id, note: input.note?.trim() || null } });
      await tx.materialCostItem.update({ where: { id: itemId }, data: { status: "COMPLETE", lastPriceAt: price.effectiveAt } });
      const unpriced = await tx.orderMaterialCostLine.findMany({ where: { costItemId: itemId, unitPriceSnapshot: null }, select: { id: true, quantity: true, costVersionId: true } });
      for (const line of unpriced) await tx.orderMaterialCostLine.update({ where: { id: line.id }, data: { unitPriceSnapshot: unitPrice, priceVersionId: price.id, lineTotal: round2(Number(line.quantity) * unitPrice) } });
      for (const versionId of new Set(unpriced.map((line) => line.costVersionId))) await this.recompute(tx, versionId);
      return price;
    });
    return result;
  }

  async recalculate(orderId: string, employee: Employee) {
    assertCostEnabled();
    if (!PRICE_EDIT_ROLES.includes(employee.role)) throw new ForbiddenException("只有财务人员可以重新核算订单成本");
    const result = await this.prisma.$transaction(async (tx) => {
      const areas = await tx.productionArea.findMany({ where: { orderId, cancelledAt: null }, include: { materialCostVersions: { include: { lines: true }, orderBy: { version: "desc" }, take: 1 } }, orderBy: { sequence: "asc" } });
      const versions = areas.map((area) => ({ area, version: area.materialCostVersions[0] })).filter((entry) => Boolean(entry.version));
      if (!versions.length) throw new NotFoundException("订单尚无物料成本版本");
      for (const { version } of versions) {
        for (const line of version!.lines) {
          const price = await tx.materialCostPriceVersion.findFirst({ where: { itemId: line.costItemId }, orderBy: { version: "desc" } });
          await tx.orderMaterialCostLine.update({ where: { id: line.id }, data: { unitPriceSnapshot: price?.unitPrice ?? null, priceVersionId: price?.id ?? null, lineTotal: price ? round2(Number(line.quantity) * Number(price.unitPrice)) : null } });
        }
        await tx.orderMaterialCostVersion.update({ where: { id: version!.id }, data: { recalculatedBy: employee.id, recalculatedAt: new Date() } });
        await this.recompute(tx, version!.id);
      }
      await tx.orderEvent.create({ data: { orderId, actorId: employee.id, type: "RECALCULATE_MATERIAL_COST", title: "订单物料成本已按最新单价重算", description: `${versions.length}个生产区域的当前成本版本已重算`, metadata: { costVersionIds: versions.map(({ version }) => version!.id) } } });
      return { recalculatedAreas: versions.length, costVersionIds: versions.map(({ version }) => version!.id) };
    });
    return result;
  }

  async completeProcurementRoute(orderId: string, kind: ProductionRouteKind, employee: Employee, attested: boolean, meta: MutationMeta = {}, overrideReason?: string, productionAreaId?: string) {
    if (!PROCUREMENT_COMPLETE_ROLES.includes(employee.role)) throw new ForbiddenException("只有采购人员可以确认路线采购完成");
    if (!(["PANEL", "WOOD_PAINT"] as string[]).includes(kind)) throw new BadRequestException("生产路线无效");
    if (!attested) throw new BadRequestException(`请确认已完成${PRODUCTION_ROUTE_LABELS[kind]}当前需求的采购`);
    const now = new Date();
    const auditedOverrideReason = employee.role === "CHAIRMAN" ? String(overrideReason ?? "").trim() : null;
    const requestedAreaId = String(productionAreaId ?? "").trim() || null;
    return runMutation(this.prisma, employee.id, `orders:${orderId}:complete-procurement-route:${kind}:${requestedAreaId ?? "ALL"}`, { attested, kind, productionAreaId: requestedAreaId, overrideReason: auditedOverrideReason }, meta, async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id: orderId }, include: {
        procurementCompletion: true,
        procurementRouteGates: { include: { routes: { where: { cancelledAt: null }, include: { productionProcesses: true, productionArea: { select: { id: true, name: true, productionNumber: true } } } } }, orderBy: { kind: "asc" } },
        productionAreas: { where: { cancelledAt: null }, include: { materialVersions: { where: { status: { in: ["PUBLISHED", "WAREHOUSE_RELEASED"] } }, orderBy: { version: "desc" }, take: 1 } }, orderBy: { sequence: "asc" } },
      } });
      if (!order) throw new NotFoundException("订单不存在");
      assertCurrentVersion(order.updatedAt, meta);
      if (order.productionExecutionMode !== "ROUTE_V2") throw new BadRequestException("历史区域模式订单请使用“完成全部采购”");
      const gate = order.procurementRouteGates.find((candidate) => candidate.kind === kind);
      if (!gate) throw new BadRequestException(`本订单未启用${PRODUCTION_ROUTE_LABELS[kind]}`);
      if (!gate.routes.length) throw new BadRequestException(`${PRODUCTION_ROUTE_LABELS[kind]}没有可释放的生产区域`);
      const matchingRoutes = requestedAreaId ? gate.routes.filter((route) => route.productionAreaId === requestedAreaId) : gate.routes;
      if (requestedAreaId && !matchingRoutes.length) throw new BadRequestException(`所选生产区域未启用${PRODUCTION_ROUTE_LABELS[kind]}`);
      const pendingRoutes = matchingRoutes.filter((route) => !route.releasedAt);
      if (!pendingRoutes.length) throw new BadRequestException(requestedAreaId ? `该生产区域的${PRODUCTION_ROUTE_LABELS[kind]}采购已经确认完成` : `${PRODUCTION_ROUTE_LABELS[kind]}采购已经全部确认完成`);
      const delayDays = workingDelayDays(gate.dueAt, now);
      const releasedRouteIds = pendingRoutes.map((route) => route.id);
      await tx.productionRoute.updateMany({ where: { id: { in: releasedRouteIds }, releasedAt: null }, data: { releasedAt: now } });
      await this.scheduler.planProductionRoutes(orderId, releasedRouteIds, tx);

      const gateComplete = gate.routes.every((route) => Boolean(route.releasedAt) || releasedRouteIds.includes(route.id));
      if (gateComplete && !gate.completedAt) {
        await tx.procurementRouteGate.update({ where: { id: gate.id }, data: { completedAt: now, completedBy: employee.id, delayDays, attested: true } });
        await tx.task.updateMany({ where: { uniqueKey: `${orderId}:MATERIALS:${kind}`, status: { in: ["PENDING", "OVERDUE"] } }, data: { status: "COMPLETE", completedAt: now, delayDays } });
      }

      const allRoutes = order.procurementRouteGates.flatMap((candidate) => candidate.routes);
      const allComplete = allRoutes.length > 0 && allRoutes.every((route) => Boolean(route.releasedAt) || releasedRouteIds.includes(route.id));
      let completionId: string | null = order.procurementCompletion?.id ?? null;
      if (allComplete && !order.procurementCompletion) {
        if (order.productionAreas.some((area) => !area.materialVersions[0])) throw new BadRequestException("有效生产区域缺少正式物料版");
        const costs = await tx.orderMaterialCostVersion.findMany({ where: { orderId } });
        const costComplete = costs.length >= order.productionAreas.length && costs.every((cost) => cost.status === "COMPLETE");
        const completion = await tx.procurementCompletion.create({ data: {
          orderId,
          startedAt: order.procurementStartedAt ?? gate.startedAt,
          dueAt: order.procurementDueAt ?? gate.dueAt,
          completedAt: now,
          completedBy: employee.id,
          delayDays: workingDelayDays(order.procurementDueAt ?? gate.dueAt, now),
          attested: true,
          costComplete,
          areas: { create: order.productionAreas.map((area) => ({ productionAreaId: area.id, materialVersionId: area.materialVersions[0]!.id })) },
        } });
        completionId = completion.id;
      }
      const nextStage = order.stage === "MATERIALS" ? "PRODUCTION" : order.stage;
      const readyUnshipped = order.procurementRouteGates.flatMap((candidate) => candidate.routes).filter((route) => !route.shippedAt && route.productionProcesses.some((process) => !["REFERENCE_CONFIRMATION", "PACKAGE_COUNT"].includes(process.metricMode)) && route.productionProcesses.filter((process) => !["REFERENCE_CONFIRMATION", "PACKAGE_COUNT"].includes(process.metricMode)).every((process) => process.status === "COMPLETE"));
      const paymentReady = tailPaymentSatisfied(order);
      const owners = ["生产车间", ...(!allComplete ? ["采购部"] : []), ...(readyUnshipped.length ? ["订单管理员"] : []), ...(readyUnshipped.length && !paymentReady ? [order.tailPaymentReported ? "财务部" : isInternalException(order) ? "订单管理员" : "所属销售"] : [])];
      const confirmedRouteCount = allRoutes.filter((route) => Boolean(route.releasedAt) || releasedRouteIds.includes(route.id)).length;
      await tx.order.update({ where: { id: orderId }, data: {
        stage: nextStage,
        procurementCompletedAt: allComplete ? now : null,
        procurementCompletedBy: allComplete ? employee.id : null,
        procurementDelayDays: allComplete ? workingDelayDays(order.procurementDueAt ?? gate.dueAt, now) : 0,
        materialSubstatus: allComplete ? "全部区域路线采购已完成" : `区域路线采购 ${confirmedRouteCount}/${allRoutes.length} 已确认`,
        currentOwnerLabel: owners.join(" · "),
        nextAction: [allComplete ? "全部区域采购路线已开放" : "继续按生产区域确认采购", "已释放路线可继续报工", ...(readyUnshipped.length ? [paymentReady ? `${readyUnshipped.length}条路线可发货` : `${readyUnshipped.length}条路线待确认尾款`] : [])].join(" · "),
      } });
      const scopeLabel = requestedAreaId ? `${pendingRoutes[0]!.productionArea.name}·${pendingRoutes[0]!.productionArea.productionNumber}` : `${pendingRoutes.length}个生产区域`;
      await tx.orderEvent.create({ data: { orderId, actorId: employee.id, type: "COMPLETE_ROUTE_PROCUREMENT", title: `${scopeLabel}·${PRODUCTION_ROUTE_LABELS[kind]}采购${delayDays ? `延期${delayDays}天` : "已完成"}`, description: `${auditedOverrideReason ? `董事长覆盖：${auditedOverrideReason}；` : ""}已释放${scopeLabel}的${PRODUCTION_ROUTE_LABELS[kind]}`, fromStage: order.stage, toStage: nextStage, metadata: { kind, productionAreaId: requestedAreaId, routeIds: releasedRouteIds, gateId: gate.id, gateComplete, delayDays, overrideReason: auditedOverrideReason } } });
      if (allComplete) await tx.orderEvent.create({ data: { orderId, actorId: employee.id, type: "COMPLETE_ALL_ROUTE_PROCUREMENT", title: "全部路线采购自动收口", description: "所有适用生产路线均已确认采购完成", fromStage: nextStage, toStage: nextStage, metadata: { procurementCompletionId: completionId } } });
      return { kind, productionAreaId: requestedAreaId, completedAt: now, delayDays, releasedRouteIds, gateComplete, allProcurementComplete: allComplete };
    }, orderId);
  }

  async completeProcurement(orderId: string, employee: Employee, attested: boolean, meta: MutationMeta = {}) {
    if (!PROCUREMENT_COMPLETE_ROLES.includes(employee.role)) throw new ForbiddenException("只有采购人员可以确认完成全部采购");
    if (!attested) throw new BadRequestException("请确认已在线下完成本订单全部采购");
    const now = new Date();
    const result = await runMutation(this.prisma, employee.id, `orders:${orderId}:complete-procurement`, { attested }, meta, async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { procurementCompletion: true, productionAreas: { where: { cancelledAt: null }, include: { materialVersions: { where: { status: { in: ["PUBLISHED", "WAREHOUSE_RELEASED"] } }, orderBy: { version: "desc" }, take: 1 }, technicalPackages: { where: { status: "APPROVED" }, orderBy: { version: "desc" }, take: 1 } }, orderBy: { sequence: "asc" } } } });
      if (!order) throw new NotFoundException("订单不存在");
      assertCurrentVersion(order.updatedAt, meta);
      if (order.productionExecutionMode === "ROUTE_V2") throw new BadRequestException("新路线模式请分别确认板式路线与实木油漆路线采购");
      if (order.procurementCompletion) throw new BadRequestException("该订单已经确认完成全部采购");
      if (order.stage !== "MATERIALS" || !order.productionAreas.length || order.productionAreas.some((area) => !area.materialVersions[0] || !area.technicalPackages[0])) throw new BadRequestException("只有所有有效区域均已发布正式物料版的采购阶段订单可以完成采购");
      const startedAt = order.procurementStartedAt ?? order.productionAreas.map((area) => area.materialVersions[0]!.releasedAt).sort((a, b) => a.getTime() - b.getTime())[0]!;
      const dueAt = order.procurementDueAt ?? addInternalWorkingDays(startedAt, 15);
      const delayDays = workingDelayDays(dueAt, now);
      const costs = await tx.orderMaterialCostVersion.findMany({ where: { orderId } });
      const costComplete = costs.length >= order.productionAreas.length && costs.every((cost) => cost.status === "COMPLETE");
      const completion = await tx.procurementCompletion.create({ data: { orderId, startedAt, dueAt, completedAt: now, completedBy: employee.id, delayDays, attested: true, costComplete, areas: { create: order.productionAreas.map((area) => ({ productionAreaId: area.id, materialVersionId: area.materialVersions[0]!.id })) } } });
      const areaPlans: Array<Record<string, unknown>> = [];
      for (const area of order.productionAreas) {
        const plan = area.technicalPackages[0]!;
        const quantities = { PANEL: Number(plan.panelPlanQty), WOOD: Number(plan.woodPlanQty), PAINT: Number(plan.paintPlanQty), ASSEMBLY: Number(plan.assemblyPlanQty) };
        const enabledWorkshops = [plan.panelEnabled ? "PANEL" : null, plan.woodPaintEnabled ? "WOOD" : null, plan.woodPaintEnabled ? "PAINT" : null, "ASSEMBLY"].filter((value): value is keyof typeof WORKSHOP_PROCESS_TEMPLATES => Boolean(value));
        if (!plan.panelEnabled && !plan.woodPaintEnabled) throw new BadRequestException(`${area.name}未选择生产路线`);
        if (enabledWorkshops.some((workshop) => !Number.isFinite(quantities[workshop]) || quantities[workshop] <= 0)) throw new BadRequestException(`${area.name}的已选车间计划面积不完整`);
        for (const workshop of enabledWorkshops) {
          const steps = workshop === "WOOD" && !plan.veneerRequired
            ? WORKSHOP_PROCESS_TEMPLATES.WOOD.filter((_, index) => index !== 2)
            : WORKSHOP_PROCESS_TEMPLATES[workshop];
          await tx.productionProcess.createMany({ data: steps.map((processName, index) => {
            const templateIndex = workshop === "WOOD"
              ? WORKSHOP_PROCESS_TEMPLATES.WOOD.indexOf(processName as (typeof WORKSHOP_PROCESS_TEMPLATES.WOOD)[number])
              : index;
            const assemblyMode = workshop === "ASSEMBLY" && index > 0;
            return { orderId, productionAreaId: area.id, workshop, workshopLabel: WORKSHOP_LABELS[workshop], processCode: `${workshop}-${String(templateIndex + 1).padStart(2, "0")}`, processName, sequence: templateIndex + 1, plannedQty: assemblyMode ? 1 : quantities[workshop], unit: assemblyMode ? "项" : "㎡", metricMode: workshop !== "ASSEMBLY" || index === 0 ? "AREA_QUANTITY" : index === 1 ? "REFERENCE_CONFIRMATION" : index === 2 ? "PACKAGE_COUNT" : "MILESTONE" };
          }), skipDuplicates: true });
        }
        await tx.productionArea.update({ where: { id: area.id }, data: { status: "PRODUCTION" } });
        areaPlans.push({ productionAreaId: area.id, productionNumber: area.productionNumber, name: area.name, panelEnabled: plan.panelEnabled, woodPaintEnabled: plan.woodPaintEnabled, quantities });
      }
      await tx.order.update({ where: { id: orderId }, data: { stage: "PRODUCTION", procurementPlanned: true, productionReady: false, procurementCompletedAt: now, procurementCompletedBy: employee.id, procurementDelayDays: delayDays, materialSubstatus: "全部采购已完成", currentOwnerLabel: "四车间生产", nextAction: "按生产区域逐项报工；可并行办理尾款，自产发货时填写本车次安装安排" } });
      await tx.task.updateMany({ where: { orderId, stage: "MATERIALS", status: { in: ["PENDING", "OVERDUE"] } }, data: { status: "COMPLETE", completedAt: now, delayDays } });
      await tx.orderEvent.create({ data: { orderId, actorId: employee.id, type: "COMPLETE_ALL_PROCUREMENT", title: delayDays ? `全部采购延期完成 · 延期${delayDays}天` : "全部采购按时完成", description: `整单${order.productionAreas.length}个生产区域已释放；成本核算${costComplete ? "已完成" : "仍可继续，不阻断生产"}`, fromStage: "MATERIALS", toStage: "PRODUCTION", metadata: { procurementCompletionId: completion.id, dueAt: dueAt.toISOString(), completedAt: now.toISOString(), delayDays, costComplete, areas: areaPlans } as unknown as Prisma.InputJsonObject } });
      await this.scheduler.planStage(orderId, "PRODUCTION", now, tx);
      return { completedAt: now, dueAt, delayDays, costComplete };
    }, orderId);
    return result;
  }

  private async recompute(tx: Tx, versionId: string) {
    const version = await tx.orderMaterialCostVersion.findUniqueOrThrow({ where: { id: versionId }, include: { lines: true } });
    const missing = version.lines.filter((line) => line.lineTotal == null).length;
    const subtotal = round2(version.lines.reduce((sum, line) => sum + Number(line.lineTotal ?? 0), 0));
    const status = missing ? "WAITING_PRICE" : "COMPLETE";
    await tx.orderMaterialCostVersion.update({ where: { id: versionId }, data: { status, missingPriceCount: missing, pricedSubtotal: subtotal, totalCost: missing ? null : subtotal } });
    await this.refreshOrderCostAggregate(tx, version.orderId);
  }

  private async refreshOrderCostAggregate(tx: Tx, orderId: string) {
    const areas = await tx.productionArea.findMany({ where: { orderId, cancelledAt: null }, include: { materialCostVersions: { orderBy: { version: "desc" }, take: 1 } } });
    const versions = areas.map((area) => area.materialCostVersions[0]).filter(Boolean);
    const subtotal = round2(versions.reduce((sum, version) => sum + Number(version?.pricedSubtotal ?? 0), 0));
    const complete = areas.length > 0 && versions.length === areas.length && versions.every((version) => version?.status === "COMPLETE");
    await tx.order.update({ where: { id: orderId }, data: { materialCostStatus: complete ? "COMPLETE" : "WAITING_PRICE", materialCostSubtotal: subtotal, materialCostTotal: complete ? subtotal : null } });
  }
}

function workingDelayDays(dueAt: Date, completedAt: Date) {
  if (completedAt <= dueAt) return 0;
  let days = 0;
  const cursor = new Date(dueAt);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(completedAt);
  end.setHours(0, 0, 0, 0);
  while (cursor < end) { cursor.setDate(cursor.getDate() + 1); if (cursor.getDay() !== 0) days += 1; }
  return Math.max(1, days);
}
