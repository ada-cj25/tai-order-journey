import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { salesBusinessTypes } from "./domain/sales-policy.js";
import { randomInt } from "node:crypto";
import type { Employee, Prisma } from "./generated/prisma/client.js";
import { addCalendarDays, assertTransition, validateManufacturedShipmentLines, businessTypeLabels, calculateProductionWindow, nextInternalWorkday, resolveWarranty, shipmentAllowed } from "./domain/rules.js";
import { inheritTechnicalSupportingFiles, validateEvidence } from "./domain/evidence.js";
import { normalizeUploadFilename } from "./domain/filenames.js";
import { deriveOrderRisks } from "./domain/order-risks.js";
import { projectFulfillment } from "./domain/fulfillment.js";
import { PRODUCTION_ROUTE_LABELS, projectProductionRoute, projectRouteExecution } from "./domain/route-execution.js";
import { isAreaFinalAfterRouteBatch, validateRouteShipmentBatches } from "./domain/route-shipment.js";
import { calculateProductionProgress, canReportProductionProcess, productionProcessAvailability, WORKSHOP_LABELS, WORKSHOP_PROCESS_TEMPLATES } from "./domain/production-progress.js";
import { paymentSummary } from "./domain/payment-summary.js";
import { canExecuteOrderCommand } from "./domain/order-command-permissions.js";
import { BUSINESS_TYPES, type BusinessType, type OrderCommandType, type SiteType, type WorkflowStage } from "./domain/types.js";
import { MaterialPackageService } from "./material-package.service.js";
import { OrderNumberAllocator } from "./number-allocator.service.js";
import { PrismaService } from "./prisma.service.js";
import { TaskScheduler } from "./scheduler.service.js";
import { orderScope, redactOrderCosts, redactOrderFinancialAmounts, canReadFinancialEvidence, canReadContractAmount, canReadAttachment, redactPaymentReceiptReferences, validateOrderAttachments } from "./order-access.js";
import { runMutation, assertCurrentVersion, type MutationMeta } from "./mutations.js";
import { PaymentAccountService } from "./payment-account.service.js";
import { OutsourceFulfillmentService } from "./outsource-fulfillment.service.js";
import { PackageCountService } from "./package-count.service.js";
import { parseShanghaiBusinessDate, shanghaiBusinessDate } from "./domain/business-date.js";
import { costEnabled } from "./runtime-config.js";
import { allowedCreationModes, canCreateLinkedSupplement, canReportPayment, effectiveCreationMode, isCommerciallyConfirmedFree, isInternalException, tailPaymentSatisfied, type ChargeMode, type CreationMode } from "./domain/commercial-policy.js";

function serializeOutsourceRequirement(version: any) {
  if (!version) return null;
  return {
    ...version,
    lines: (version.lines ?? []).map((line: any) => ({
      ...line,
      plannedQty: Number(line.plannedQty),
      arrivals: (line.arrivals ?? []).map((arrival: any) => ({ ...arrival, quantity: Number(arrival.quantity) })),
    })),
  };
}

const STAGE_LABELS: Record<string, string> = {
  DEPOSIT_PENDING: "签订合同",
  DESIGN_PENDING: "待设计下单",
  DESIGN_ACCEPTED: "设计中",
  PRE_REVIEW: "前置审单",
  TECHNICAL: "技术拆单",
  TECH_REVIEW: "订单管理员技术审单",
  MATERIALS: "物料与采购",
  PRODUCTION: "四车间生产",
  INSTALLATION_APPLICATION: "发货",
  DELIVERY: "发货",
  INSTALLATION: "现场安装",
  ACCEPTANCE: "客户验收",
  BUSINESS_COMPLETE: "履约完成",
};

const STAGE_OWNER: Record<string, string> = {
  DEPOSIT_PENDING: "财务部",
  DESIGN_PENDING: "设计师",
  DESIGN_ACCEPTED: "设计师",
  PRE_REVIEW: "订单管理员",
  TECHNICAL: "技术部",
  TECH_REVIEW: "订单管理员",
  MATERIALS: "采购部",
  PRODUCTION: "生产车间",
  INSTALLATION_APPLICATION: "订单管理员",
  DELIVERY: "订单管理员",
  INSTALLATION: "安装部",
  ACCEPTANCE: "安装部",
  BUSINESS_COMPLETE: "财务部",
};

function projectedStageLabel(stage: string, _shipmentCount: number, creationMode?: string) {
  if (stage === "DEPOSIT_PENDING" && creationMode === "INTERNAL_EXCEPTION") return "商务确认";
  return STAGE_LABELS[stage] ?? stage;
}

export type CreateOrderInput = {
  businessType: BusinessType;
  siteType: SiteType;
  customerName: string;
  customerPhone: string;
  address: string;
  amount?: number;
  creationMode?: CreationMode;
  proposedChargeMode?: ChargeMode;
  exceptionReason?: string;
  freeReason?: string;
  salesId?: string;
  signedAt: string;
  designerId?: string;
  parentOrderId?: string;
  supplementType?: string;
  responsibilityType?: string;
  supplementReason?: string;
  rush?: boolean;
  rushReason?: string;
  rushPromisedAt?: string;
  promisedAt: string;
  finishType?: "MELAMINE" | "PAINT";
  leatherDoor?: boolean;
  villaFloors?: number;
};

function orderFamily(type: BusinessType) {
  return type.replace(/_(FORMAL|SUPPLEMENT)$/, "");
}

@Injectable()
export class OrdersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OrderNumberAllocator) private readonly allocator: OrderNumberAllocator,
    @Inject(TaskScheduler) private readonly scheduler: TaskScheduler,
    @Inject(MaterialPackageService) private readonly materialPackages: MaterialPackageService,
    @Inject(PaymentAccountService) private readonly paymentAccounts: PaymentAccountService,
    @Inject(OutsourceFulfillmentService) private readonly outsource: OutsourceFulfillmentService,
    @Inject(PackageCountService) private readonly packageCounts: PackageCountService,
  ) {}

  private scope(employee: Employee): Prisma.OrderWhereInput {
    return orderScope(employee);
  }

  async list(employee: Employee, query: Record<string, string | undefined>) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(query.pageSize) || 20));
    const where: Prisma.OrderWhereInput = {
      ...this.scope(employee),
      ...(query.stage ? { stage: query.stage as WorkflowStage } : {}),
      ...(query.search
        ? {
            OR: [
              { trackingSerial: { contains: query.search, mode: "insensitive" } },
              { salesNumber: { contains: query.search, mode: "insensitive" } },
              { productionNumber: { contains: query.search, mode: "insensitive" } },
              { productionAreas: { some: { productionNumber: { contains: query.search, mode: "insensitive" } } } },
              { customerName: { contains: query.search, mode: "insensitive" } },
              { address: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: {
          sales: { select: { id: true, name: true } },
          designer: { select: { id: true, name: true } },
          creator: { select: { id: true, name: true, role: true } },
          commercialConfirmer: { select: { id: true, name: true } },
          productionAreas: { where: { cancelledAt: null }, include: {
            productionProcesses: true,
            productionRoutes: { where: { cancelledAt: null }, include: { productionProcesses: true, shipmentLines: { include: { shipmentArea: { include: { shipment: true } } }, orderBy: { sequence: "asc" } } } },
            shipmentAreas: { include: { shipment: true } },
          }, orderBy: { sequence: "asc" } },
          outsourceRequirementVersions: { where: { status: "APPROVED" }, include: { lines: { include: { arrivals: true, shipmentLine: true }, orderBy: { sequence: "asc" } } }, orderBy: { version: "desc" }, take: 1 },
          shipments: { include: { areas: true, outsourceLines: true }, orderBy: [{ deliveredAt: "desc" }, { createdAt: "desc" }] },
          tasks: { where: { status: "OVERDUE" }, select: { id: true, title: true, status: true, department: true, dueAt: true } },
          productionReports: { include: { process: { select: { workshopLabel: true, processName: true, productionArea: { select: { name: true } }, productionRoute: { select: { kind: true } } } } }, orderBy: { reportedAt: "desc" } },
          aftersales: { select: { id: true } },
        },
        orderBy: [{ riskCount: "desc" }, { updatedAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items: items.map((order) => {
      const outsourceVersion = order.outsourceRequirementVersions[0];
      const fulfillmentTracks = projectFulfillment({
        tailPaymentConfirmed: tailPaymentSatisfied(order),
        installationApplied: order.installationApplied,
        outsourceMode: order.outsourceRequirementMode,
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
        outsourceLines: (outsourceVersion?.lines ?? []).map((line) => ({
          ...line,
          plannedQty: Number(line.plannedQty),
          arrivals: line.arrivals.map((arrival) => ({ ...arrival, quantity: Number(arrival.quantity) })),
        })),
      });
      const risks = deriveOrderRisks({ ...order, tailPaymentConfirmed: tailPaymentSatisfied(order), fulfillmentTracks });
      const projected = this.project(order, employee);
      delete projected.tasks;
      delete projected.productionReports;
      delete projected.outsourceRequirementVersions;
      return { ...projected, stageLabel: projectedStageLabel(order.stage, order.shipments.length, order.creationMode), riskCount: risks.length };
    }), total, page, pageSize };
  }

  async detail(id: string, employee: Employee) {
    const order = await this.prisma.order.findFirst({
      where: { id, ...this.scope(employee) },
      include: {
        sales: { select: { id: true, name: true } },
        designer: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true, role: true } },
        commercialConfirmer: { select: { id: true, name: true } },
        parent: { select: { id: true, salesNumber: true, productionNumber: true, trackingSerial: true } },
        supplements: { select: { id: true, salesNumber: true, productionNumber: true, trackingSerial: true, stage: true } },
        tasks: { orderBy: { createdAt: "desc" } },
        stageSubmissions: { orderBy: { createdAt: "desc" } },
        attachments: { select: { id: true, productionAreaId: true, category: true, originalName: true, mimeType: true, size: true, createdAt: true }, orderBy: { createdAt: "desc" } },
        procurementRouteGates: { orderBy: { kind: "asc" } },
        productionAreas: { where: { cancelledAt: null }, include: {
          technicalPackages: { include: { materialImports: true, materialVersion: { include: { lines: { include: { item: true }, orderBy: [{ templateType: "asc" }, { sourceRow: "asc" }, { sourceSubRow: "asc" }] } } } }, orderBy: { version: "desc" }, take: 1 },
          productionProcesses: { orderBy: [{ workshop: "asc" }, { sequence: "asc" }] },
          productionRoutes: { where: { cancelledAt: null }, include: { productionProcesses: { orderBy: [{ workshop: "asc" }, { sequence: "asc" }] }, shipmentLines: { include: { shipmentArea: { include: { shipment: true } } }, orderBy: { sequence: "asc" } } }, orderBy: { kind: "asc" } },
          shipmentAreas: { include: { shipment: true, routeLines: true } },
        }, orderBy: { sequence: "asc" } },
        outsourceRequirementVersions: { include: { lines: { include: { arrivals: { orderBy: { arrivedOn: "desc" } }, shipmentLine: { include: { shipment: true } } }, orderBy: { sequence: "asc" } } }, orderBy: { version: "desc" }, take: 3 },
        shipments: { include: { assignedInstaller: { select: { id: true, name: true, department: true } }, areas: { include: { routeLines: true } }, outsourceLines: true }, orderBy: [{ deliveredAt: "desc" }, { createdAt: "desc" }] },
        productionProcesses: { include: { productionRoute: true }, orderBy: [{ workshop: "asc" }, { sequence: "asc" }] },
        productionReports: { include: { process: { select: { workshopLabel: true, processName: true, productionArea: { select: { name: true } }, productionRoute: { select: { kind: true } } } } }, orderBy: { reportedAt: "desc" } },
        aftersales: { select: { id: true } },
      },
    });
    if (!order) throw new NotFoundException("订单不存在或无权查看");
    const hidesFinancialEvidence = !canReadFinancialEvidence(employee, order);
    const paymentReports = hidesFinancialEvidence ? [] : await this.prisma.stageSubmission.findMany({
      where: { orderId: id, command: { in: ["REPORT_DEPOSIT", "REPORT_PREPAYMENT"] }, status: { not: "DRAFT" } },
      select: { command: true, status: true, payload: true },
      orderBy: { createdAt: "desc" },
    });
    const productionProcesses = order.productionProcesses.map((process) => {
      const areaProcesses = order.productionProcesses.filter((candidate) => process.productionRouteId
        ? candidate.productionRouteId === process.productionRouteId
        : candidate.productionAreaId === process.productionAreaId);
      const availability = productionProcessAvailability(areaProcesses, { ...process, productionRouteReleasedAt: process.productionRoute?.releasedAt });
      return {
        ...process,
        plannedQty: Number(process.plannedQty),
        completedQty: Number(process.completedQty),
        canReport: !["REFERENCE_CONFIRMATION", "PACKAGE_COUNT"].includes(process.metricMode) && canReportProductionProcess(employee, process),
        available: availability.available,
        lockedReason: availability.reason,
      };
    });
    const canReadPaymentReceipts = canReadAttachment(employee, "DEPOSIT_RECEIPT", order);
    const visibleStageSubmissions = hidesFinancialEvidence
      ? order.stageSubmissions.filter((submission) => !["REPORT_DEPOSIT", "REPORT_PREPAYMENT", "CONFIRM_DEPOSIT", "CONFIRM_INITIAL_PAYMENTS", "REPORT_TAIL_PAYMENT", "CONFIRM_TAIL_PAYMENT"].includes(submission.command))
      : order.stageSubmissions;
    const stageSubmissions = canReadPaymentReceipts ? visibleStageSubmissions : visibleStageSubmissions.map((submission) => (
      ["REPORT_DEPOSIT", "REPORT_PREPAYMENT", "REPORT_TAIL_PAYMENT"].includes(submission.command)
        ? { ...submission, payload: redactPaymentReceiptReferences(submission.payload) as Prisma.JsonValue }
        : submission
    ));
    const payments = hidesFinancialEvidence ? null
      : isInternalException(order) && !order.commercialConfirmedAt ? { applicable: false, reason: "COMMERCIAL_PENDING" }
        : isCommerciallyConfirmedFree(order) ? { applicable: false, reason: "FREE_ORDER" }
          : { applicable: true, ...paymentSummary({ contractAmount: order.amount, depositReported: order.depositReported, depositConfirmed: order.depositConfirmed, prepaymentRequired: order.prepaymentRequired, prepaymentReported: order.prepaymentReported, prepaymentConfirmed: order.prepaymentConfirmed, submissions: paymentReports }) };
    const attachments = order.attachments
      .filter((attachment) => canReadAttachment(employee, attachment.category, order))
      .map((attachment) => ({ ...attachment, originalName: normalizeUploadFilename(attachment.originalName) }));
    const currentTask = order.tasks.find((task) => task.stage === order.stage && ["PENDING", "OVERDUE"].includes(task.status));
    const fulfillmentTracks = await this.outsource.projection(id);
    const packageSummary = await this.packageCounts.projection(id);
    const risks = deriveOrderRisks({ ...order, tailPaymentConfirmed: tailPaymentSatisfied(order), fulfillmentTracks });
    const technicalPackage = await this.materialPackages.detail(id);
    const routeExecution = order.productionExecutionMode === "ROUTE_V2" ? projectRouteExecution({
      tailPaymentConfirmed: tailPaymentSatisfied(order),
      areas: order.productionAreas.map((area) => ({
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
          processes: route.productionProcesses.map((process) => ({
            workshop: process.workshop,
            processCode: process.processCode,
            plannedQty: Number(process.plannedQty),
            completedQty: Number(process.completedQty),
            status: process.status,
            metricMode: process.metricMode,
          })),
        })),
      })),
    }) : null;
    const productionAreas = order.productionAreas.map((area) => {
      const processes = productionProcesses.filter((process) => process.productionAreaId === area.id);
      const technical = area.technicalPackages[0] ?? null;
      const projectedArea = routeExecution?.areas.find((candidate) => candidate.id === area.id);
      return {
        ...area,
        productionProcesses: undefined,
        technicalPackages: undefined,
        shipmentAreas: undefined,
        route: technical
          ? { panelEnabled: technical.panelEnabled, woodPaintEnabled: technical.woodPaintEnabled }
          : processes.length
            ? { panelEnabled: processes.some((process) => process.workshop === "PANEL"), woodPaintEnabled: processes.some((process) => process.workshop === "WOOD" || process.workshop === "PAINT") }
            : null,
        technicalPackage: technical,
        production: routeExecution && projectedArea
          ? { percent: projectedArea.percent, complete: projectedArea.complete, processes }
          : { ...calculateProductionProgress(processes), processes },
        routes: projectedArea?.routes.map((route) => ({
          ...route,
          assemblyPlanQty: Number(route.assemblyPlanQty),
          shipmentBatches: area.productionRoutes.find((candidate) => candidate.id === route.id)?.shipmentLines.map((line) => ({
            id: line.id,
            sequence: line.sequence,
            isFinalBatch: line.isFinalBatch,
            shipmentAreaSequence: line.shipmentArea.sequence,
            shipment: line.shipmentArea.shipment,
          })) ?? [],
          processes: processes.filter((process) => process.productionRouteId === route.id),
          production: {
            ...calculateProductionProgress(processes.filter((process) => process.productionRouteId === route.id)),
            percent: route.percent,
            complete: route.complete,
            processes: processes.filter((process) => process.productionRouteId === route.id),
          },
        })) ?? [],
        shipment: area.shipmentAreas.at(-1)?.shipment ?? null,
        shipmentBatches: area.shipmentAreas.map((line) => ({ ...line, installationFee: line.installationFee == null ? null : Number(line.installationFee), shipment: { ...line.shipment, transportCost: line.shipment.transportCost == null ? null : Number(line.shipment.transportCost) } })),
        shipped: area.shipmentAreas.some((line) => line.isFinalBatch),
      };
    });
    const allProductionAreasComplete = productionAreas.length > 0 && productionAreas.every((area) => area.production.complete);
    return redactOrderCosts({
      ...this.project(order, employee),
      riskCount: risks.length,
      risks,
      stageLabel: projectedStageLabel(order.stage, order.shipments.length, order.creationMode),
      shipmentGate: {
        allowed: fulfillmentTracks.manufactured.allowed,
        tailPaymentConfirmed: tailPaymentSatisfied(order),
        installationApplied: order.installationApplied,
        allProductionAreasComplete,
        allowedProductionRouteIds: routeExecution?.allowedProductionRouteIds ?? [],
      },
      procurementRoutes: order.procurementRouteGates.map((gate) => ({ ...gate, affectedRouteIds: order.productionAreas.flatMap((area) => area.productionRoutes).filter((route) => route.procurementRouteGateId === gate.id).map((route) => route.id) })),
      workflowProgress: routeExecution ? { steps: routeExecution.steps, productionPercent: routeExecution.productionPercent, procurementPercent: routeExecution.procurementPercent, shipmentPercent: routeExecution.shipmentPercent } : null,
      fulfillmentTracks,
      packageSummary,
      warranty: resolveWarranty(order.businessType as BusinessType, order.finalAcceptedAt),
      tasks: order.tasks,
      currentTask: currentTask ? {
        id: currentTask.id,
        title: currentTask.title,
        plannedStartAt: currentTask.plannedStartAt,
        workloadDays: currentTask.workloadDays,
        dueAt: currentTask.dueAt,
        status: currentTask.status,
        delayDays: currentTask.delayDays,
      } : null,
      parent: order.parent,
      supplements: order.supplements,
      stageSubmissions,
      paymentSummary: payments,
      attachments,
      permissions: {
        canReleaseProduction: ["CHAIRMAN", "ORDER_ADMIN"].includes(employee.role),
        workshop: employee.workshop,
        processCode: employee.processCode,
        processCodes: employee.processCodes,
        level: employee.level,
      },
      production: {
        ...(routeExecution ? { percent: routeExecution.productionPercent, complete: routeExecution.allProductionComplete } : calculateProductionProgress(productionProcesses)),
        processes: productionProcesses,
      },
      productionAreas,
      outsourceRequirement: serializeOutsourceRequirement(order.outsourceRequirementVersions.find((version) => version.status === "APPROVED") ?? order.outsourceRequirementVersions[0] ?? null),
      shipments: order.shipments,
      areaSummary: {
        total: productionAreas.length,
        completed: productionAreas.filter((area) => area.production.complete).length,
        shipped: productionAreas.filter((area) => area.shipped).length,
        percent: routeExecution?.productionPercent ?? (productionAreas.length ? Math.round(productionAreas.reduce((sum, area) => sum + area.production.percent, 0) / productionAreas.length) : 0),
      },
      technicalPackage,
      materialVersion: technicalPackage?.materialVersion ?? null,
    }, employee.role);
  }

  async timeline(id: string, employee: Employee) {
    const order = await this.assertVisible(id, employee);
    const events = await this.prisma.orderEvent.findMany({
      where: { orderId: id, ...(!canReadFinancialEvidence(employee, order) ? { type: { notIn: ["REPORT_DEPOSIT", "REPORT_PREPAYMENT", "REPORT_TAIL_PAYMENT", "CONFIRM_DEPOSIT", "CONFIRM_INITIAL_PAYMENTS", "CONFIRM_TAIL_PAYMENT", "EXCEPTION_COMMERCIAL_CONFIRMED"] } } : {}) },
      include: { actor: { select: { name: true, department: true } } },
      orderBy: { createdAt: "desc" },
    });
    const canReadPaymentReceipts = canReadAttachment(employee, "DEPOSIT_RECEIPT", order);
    return events.filter((event) => {
      if (event.type === "CONTRACT_AMOUNT_UPDATED" && !canReadContractAmount(employee)) return false;
      if (event.type.startsWith("AFTERSALES_COST_") && (!costEnabled() || !["AFTERSALES", "FINANCE", "CHAIRMAN"].includes(employee.role))) return false;
      return true;
    }).map((event) => {
      const visible = redactOrderFinancialAmounts(redactOrderCosts(event, employee.role), employee, order);
      return canReadPaymentReceipts || !["REPORT_DEPOSIT", "REPORT_PREPAYMENT", "REPORT_TAIL_PAYMENT"].includes(event.type)
        ? visible
        : { ...visible, metadata: redactPaymentReceiptReferences(visible.metadata) };
    });
  }

  async create(input: CreateOrderInput, employee: Employee, meta: MutationMeta = {}) {
    const result = await runMutation(this.prisma, employee.id, "orders:create", input, meta, async (tx) => {
    if (!BUSINESS_TYPES.includes(input.businessType)) throw new BadRequestException("订单类型无效");
    const isSupplement = input.businessType.endsWith("SUPPLEMENT");
    const requestedCreationMode = input.creationMode ?? (employee.role === "SALES" ? "SALES_STANDARD" : "INTERNAL_EXCEPTION");
    if (isSupplement ? !canCreateLinkedSupplement(employee.role) : !allowedCreationModes(employee.role).includes(requestedCreationMode)) throw new ForbiddenException("当前岗位不能使用所选建单模式");
    if (employee.role === "SALES" && !salesBusinessTypes(employee.businessUnit).includes(input.businessType)) throw new ForbiddenException("销售只能创建所属品牌的正单或补单");
    if (isSupplement && !input.parentOrderId) throw new BadRequestException("补单必须关联正单");
    if (isSupplement && (!input.supplementType || !input.responsibilityType || !input.supplementReason)) {
      throw new BadRequestException("补单必须填写来源类型、责任/收费类型和事实原因");
    }
    const parent = isSupplement
      ? await tx.order.findFirst({ where: { id: input.parentOrderId, ...this.scope(employee) } })
      : null;
    if (isSupplement && !parent) throw new BadRequestException("关联正单不存在或无权查看");
    if (parent?.businessType.endsWith("SUPPLEMENT")) throw new BadRequestException("补单必须直接关联正单，不能关联另一张补单");
    if (parent && orderFamily(parent.businessType as BusinessType) !== orderFamily(input.businessType)) {
      throw new BadRequestException("补单品牌/业务分类必须与关联正单一致");
    }
    const creationMode = effectiveCreationMode(requestedCreationMode, parent?.creationMode as CreationMode | null | undefined, employee.role);
    const internal = creationMode === "INTERNAL_EXCEPTION";
    if (!input.signedAt) throw new BadRequestException(internal ? "业务约定日期必填" : "签约日期必填");
    if (!input.promisedAt) throw new BadRequestException("客户约定交期必填，由销售根据与客户的约定录入");
    if (!isSupplement && (!input.customerName || !input.customerPhone || !input.address)) throw new BadRequestException("客户、电话和地址必填");
    if (internal && input.amount != null) throw new BadRequestException("非常规订单建单时不得提交合同金额，由订单管理员商务确认");
    if (!internal && (!Number.isFinite(Number(input.amount)) || (isSupplement ? Number(input.amount) < 0 : Number(input.amount) <= 0))) {
      throw new BadRequestException(isSupplement ? "补单金额不能小于0" : "合同金额必须大于0");
    }
    if (internal && !["CHARGED", "FREE"].includes(String(input.proposedChargeMode))) throw new BadRequestException("非常规订单必须选择预计收费或预计免费");
    if (internal && !input.exceptionReason?.trim()) throw new BadRequestException("非常规建单原因必填");
    if (internal && input.proposedChargeMode === "FREE" && !input.freeReason?.trim()) throw new BadRequestException("预计免费时必须填写免费原因");
    if (input.rush && (!input.rushReason || !input.rushPromisedAt)) throw new BadRequestException("加急订单必须填写原因和客户承诺日期");
    const assignedDesignerId = parent?.designerId ?? (employee.role === "DESIGNER" ? employee.id : input.designerId);
    if (!assignedDesignerId) throw new BadRequestException("签约建单前必须分配设计师");
    const assignedDesigner = await tx.employee.findFirst({ where: { id: assignedDesignerId, role: "DESIGNER", active: true }, select: { id: true, name: true } });
    if (!assignedDesigner) throw new BadRequestException("只能分配启用状态的设计师");
    let assignedSalesId: string | null = null;
    if (!internal) {
      assignedSalesId = parent?.salesId ?? (employee.role === "SALES" ? employee.id : input.salesId ?? null);
      if (!assignedSalesId) throw new BadRequestException("常规订单必须分配所属销售");
      const assignedSales = await tx.employee.findFirst({ where: { id: assignedSalesId, role: "SALES", active: true }, select: { id: true, businessUnit: true } });
      if (!assignedSales || !salesBusinessTypes(assignedSales.businessUnit).includes(input.businessType)) throw new BadRequestException("只能分配与订单品牌一致的启用销售");
    }
    const signedAt = new Date(input.signedAt);
    const rushPromisedAt = input.rushPromisedAt ? new Date(input.rushPromisedAt) : null;
    const promisedAt = new Date(input.promisedAt);
    promisedAt.setHours(17, 0, 0, 0);
    const effectiveSiteType = (parent?.siteType ?? input.siteType) as SiteType;
    const customerDueSunday = promisedAt.getDay() === 0;
    const internalDueAt = customerDueSunday ? nextInternalWorkday(promisedAt) : new Date(promisedAt);
    internalDueAt.setHours(17, 0, 0, 0);
    const datePart = `${String(signedAt.getFullYear()).slice(-2)}${String(signedAt.getMonth() + 1).padStart(2, "0")}${String(signedAt.getDate()).padStart(2, "0")}`;
    const trackingSerial = `GD-${datePart}-${randomInt(100_000_000, 1_000_000_000)}`;
    const designerAssignedAt = new Date();
    const order = await tx.order.create({
      data: {
        trackingSerial,
        businessType: input.businessType,
        siteType: effectiveSiteType,
        customerName: parent?.customerName ?? input.customerName,
        customerPhone: parent?.customerPhone ?? input.customerPhone,
        address: parent?.address ?? input.address,
        amount: internal ? null : input.amount,
        signedAt,
        standardDueAt: promisedAt,
        promisedAt,
        internalDueAt,
        finishType: parent?.finishType ?? (input.finishType === "PAINT" ? "PAINT" : "MELAMINE"),
        leatherDoor: parent?.leatherDoor ?? Boolean(input.leatherDoor),
        villaFloors: parent?.villaFloors ?? Math.max(0, Number(input.villaFloors ?? 0)),
        rush: Boolean(input.rush),
        rushReason: input.rushReason,
        rushPromisedAt,
        sundayRisk: customerDueSunday,
        creationMode,
        chargeMode: internal ? input.proposedChargeMode! : "CHARGED",
        createdById: employee.id,
        exceptionReason: internal ? input.exceptionReason!.trim() : null,
        freeReason: internal && input.proposedChargeMode === "FREE" ? input.freeReason!.trim() : null,
        currentOwnerLabel: internal ? "订单管理员" : "所属销售",
        nextAction: internal ? "确认非常规订单商务方式" : isSupplement ? "报备定金收款信息" : "报备签约定金与预付款",
        prepaymentRequired: internal ? false : !isSupplement,
        salesId: assignedSalesId,
        designerId: assignedDesigner.id,
        designerAssignedAt,
        designAssignmentVersion: 1,
        parentOrderId: input.parentOrderId || null,
        supplementType: input.supplementType,
        responsibilityType: input.responsibilityType,
        supplementReason: input.supplementReason,
        events: {
          create: [{
            actorId: employee.id,
            type: "ORDER_CREATED",
            title: internal ? "非常规订单已创建" : "合同已签订",
            description: parent
              ? `补单已关联正单 ${parent.salesNumber ?? parent.productionNumber ?? parent.trackingSerial}，生成跟单流水号 ${trackingSerial}`
              : `生成跟单流水号 ${trackingSerial}，销售编号将在设计正式提交时生成`,
            toStage: "DEPOSIT_PENDING",
          }, {
            actorId: employee.id,
            type: "ASSIGN_DESIGNER_INITIAL",
            title: internal ? "创建时分配设计师" : "销售初次分配设计师",
            description: `已分配给${assignedDesigner.name}`,
            toStage: "DEPOSIT_PENDING",
            metadata: { toDesignerId: assignedDesigner.id, assignedAt: designerAssignedAt.toISOString(), assignmentVersion: 1 },
          }],
        },
      },
    });
    return { id: order.id };
    });
    return this.detail(result.id, employee);
  }

  async updateContractAmount(id: string, input: { amount: number }, employee: Employee, meta: MutationMeta = {}) {
    if (!["ORDER_ADMIN", "CHAIRMAN"].includes(employee.role)) throw new ForbiddenException("只有订单管理员或董事长管理员可以修改合同金额");
    await runMutation(this.prisma, employee.id, `orders:${id}:contract-amount`, input, meta, async (tx) => {
      const current = await tx.order.findFirst({
        where: { id, ...this.scope(employee) },
        include: {
          stageSubmissions: { where: { command: { in: ["REPORT_DEPOSIT", "REPORT_PREPAYMENT"] }, status: { not: "DRAFT" } } },
          _count: { select: { shipments: true } },
        },
      });
      if (!current) throw new NotFoundException("订单不存在或无权处理");
      assertCurrentVersion(current.updatedAt, meta);
      if (isInternalException(current) && !current.commercialConfirmedAt) throw new BadRequestException("非常规订单必须先完成商务确认，不能提前修改合同金额");
      if (isCommerciallyConfirmedFree(current)) throw new BadRequestException("免费单不能通过合同改额切换为收费单");
      if (current._count.shipments > 0) throw new BadRequestException("订单已经产生首批发货记录，合同金额不得再修改");
      if (current.tailPaymentReported || current.tailPaymentConfirmed) throw new BadRequestException("尾款已经报备或核验，合同金额不得再修改");
      const amount = Number(input.amount);
      const isSupplement = current.businessType.endsWith("SUPPLEMENT");
      if (!Number.isFinite(amount) || (isSupplement ? amount < 0 : amount <= 0)) throw new BadRequestException(isSupplement ? "补单金额不能小于0" : "合同金额必须大于0");
      const summary = paymentSummary({
        contractAmount: current.amount,
        depositReported: current.depositReported,
        depositConfirmed: current.depositConfirmed,
        prepaymentRequired: current.prepaymentRequired,
        prepaymentReported: current.prepaymentReported,
        prepaymentConfirmed: current.prepaymentConfirmed,
        submissions: current.stageSubmissions,
      });
      if (summary.initialPaymentTotal != null && amount < summary.initialPaymentTotal) throw new BadRequestException("新合同金额不能低于财务已确认的定金与预付款合计");
      const previousAmount = Number(current.amount);
      if (amount === previousAmount) throw new BadRequestException("新合同金额与当前金额相同，无需修改");
      const now = new Date();
      await tx.order.update({ where: { id }, data: { amount, updatedAt: now } });
      await tx.orderEvent.create({
        data: {
          orderId: id,
          actorId: employee.id,
          type: "CONTRACT_AMOUNT_UPDATED",
          title: isSupplement ? "补单金额已修改" : "合同总金额已修改",
          description: `由 ¥${previousAmount.toFixed(2)} 修改为 ¥${amount.toFixed(2)}`,
          fromStage: current.stage,
          toStage: current.stage,
          metadata: { previousAmount, amount, changedAt: now.toISOString() },
        },
      });
      return { id };
    }, id);
    return this.detail(id, employee);
  }

  async reviewExceptionCommercial(
    id: string,
    input: { chargeMode?: ChargeMode; amount?: number; deposit?: { amount?: number; receivedAt?: string; account?: string; receiptAttachmentIds?: string[] }; freeReason?: string; reviewComment?: string },
    employee: Employee,
    meta: MutationMeta = {},
  ) {
    if (employee.role !== "ORDER_ADMIN") throw new ForbiddenException("只有订单管理员可以确认非常规订单商务方式");
    await runMutation(this.prisma, employee.id, `orders:${id}:exception-commercial-review`, input, meta, async (tx) => {
      const current = await tx.order.findFirst({ where: { id, ...this.scope(employee) } });
      if (!current) throw new NotFoundException("订单不存在或无权处理");
      assertCurrentVersion(current.updatedAt, meta);
      if (!isInternalException(current)) throw new BadRequestException("常规销售订单不适用非常规商务确认");
      if (current.stage !== "DEPOSIT_PENDING" || current.commercialConfirmedAt) throw new BadRequestException("商务方式已经确认或订单已离开商务确认阶段");
      if (!["CHARGED", "FREE"].includes(String(input.chargeMode))) throw new BadRequestException("请选择最终收费方式");
      const now = new Date();
      const reviewComment = input.reviewComment?.trim() || null;

      if (input.chargeMode === "FREE") {
        const freeReason = input.freeReason?.trim();
        if (!freeReason) throw new BadRequestException("免费单必须填写最终免费原因");
        const designIntakeDueAt = addCalendarDays(now, 7);
        await tx.order.update({
          where: { id },
          data: {
            chargeMode: "FREE", amount: null, freeReason, commercialConfirmedAt: now, commercialConfirmedBy: employee.id,
            stage: "DESIGN_PENDING", designIntakeAvailableAt: now, designIntakeDueAt,
            currentOwnerLabel: "设计师", nextAction: "7个自然日内完成设计下单",
          },
        });
        await this.scheduler.planDesignIntake(id, now, current.designAssignmentVersion, tx);
        await tx.orderEvent.create({ data: { orderId: id, actorId: employee.id, type: "EXCEPTION_COMMERCIAL_CONFIRMED", title: "非常规订单已确认为免费单", description: freeReason, fromStage: "DEPOSIT_PENDING", toStage: "DESIGN_PENDING", metadata: { chargeMode: "FREE", freeReason, reviewComment, confirmedAt: now.toISOString() } } });
        await tx.stageSubmission.create({ data: { orderId: id, stage: "DEPOSIT_PENDING", command: "EXCEPTION_COMMERCIAL_REVIEW", status: "APPROVED", payload: { chargeMode: "FREE", freeReason }, comment: reviewComment, submittedBy: employee.id, reviewedBy: employee.id, reviewedAt: now } });
        return { id };
      }

      const amount = Number(input.amount);
      const depositAmount = Number(input.deposit?.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException("收费单合同金额必须大于0");
      if (!Number.isFinite(depositAmount) || depositAmount <= 0 || depositAmount > amount) throw new BadRequestException("定金必须大于0且不能超过合同金额");
      if (!input.deposit?.receivedAt || !input.deposit.account || !input.deposit.receiptAttachmentIds?.length) throw new BadRequestException("请完整填写定金金额、到账日期、收款账户和凭证");
      try { parseShanghaiBusinessDate(input.deposit.receivedAt); } catch { throw new BadRequestException("定金到账日期无效"); }
      await this.paymentAccounts.assertApproved(tx, input.deposit.account);
      const depositPayload = { receivedAmount: depositAmount, receivedAt: input.deposit.receivedAt, account: input.deposit.account, receiptAttachmentIds: input.deposit.receiptAttachmentIds };
      await validateOrderAttachments(tx, id, depositPayload, employee, "REPORT_DEPOSIT");
      await tx.order.update({ where: { id }, data: { chargeMode: "CHARGED", amount, freeReason: null, commercialConfirmedAt: now, commercialConfirmedBy: employee.id, depositReported: true, prepaymentRequired: false, currentOwnerLabel: "财务部", nextAction: "核验定金是否实际到账" } });
      await tx.stageSubmission.create({ data: { orderId: id, stage: "DEPOSIT_PENDING", command: "REPORT_DEPOSIT", status: "SUBMITTED", payload: depositPayload, comment: reviewComment, submittedBy: employee.id } });
      await tx.orderEvent.create({ data: { orderId: id, actorId: employee.id, type: "EXCEPTION_COMMERCIAL_CONFIRMED", title: "非常规订单已确认为收费单", description: `合同金额 ¥${amount.toFixed(2)}，定金已报备并等待财务核验`, fromStage: "DEPOSIT_PENDING", toStage: "DEPOSIT_PENDING", metadata: { chargeMode: "CHARGED", amount, depositAmount, confirmedAt: now.toISOString() } } });
      return { id };
    }, id);
    return this.detail(id, employee);
  }

  async command(id: string, command: OrderCommandType, employee: Employee, payload: Record<string, unknown> = {}, meta: MutationMeta = {}) {
    await this.assertVisible(id, employee);
    if (command === "SUBMIT_INSTALLATION_APPLICATION") throw new BadRequestException("安装申请入口已停用；请在每个自产发货车次中填写安装安排");
    validateEvidence(command, payload);
    const mutationResult = await runMutation(this.prisma, employee.id, `orders:${id}:command`, { command, payload }, meta, async (tx) => {
    const current = await tx.order.findFirst({ where: { id, ...this.scope(employee) } });
    if (!current) throw new NotFoundException("订单不存在或无权处理");
    assertCurrentVersion(current.updatedAt, meta);
    if (command === "COMPLETE_PRODUCTION") throw new BadRequestException("生产完成由逐工序累计报工自动判断，不能手工整单确认");
    if (command === "START_PRODUCTION") throw new BadRequestException("旧版手工下达四车间入口已停用；必须由采购点击“完成全部采购”后自动进入生产");
    if (!canExecuteOrderCommand(employee.role, command)) throw new ForbiddenException("当前角色不能执行该操作");
    if (command === "ASSIGN_DESIGNER" && employee.role === "ORDER_ADMIN" && !isInternalException(current)) throw new ForbiddenException("订单管理员只能重新分配内部非常规订单的设计师");
    if (employee.role === "DESIGNER" && current.designerId !== employee.id) throw new ForbiddenException("设计师只能处理本人任务");
    if (["REPORT_DEPOSIT", "REPORT_PREPAYMENT", "REPORT_TAIL_PAYMENT"].includes(command) && !canReportPayment(employee, current)) throw new ForbiddenException("收款报备必须由该订单的付款责任人提交");
    if (isCommerciallyConfirmedFree(current) && ["REPORT_DEPOSIT", "REPORT_PREPAYMENT", "REPORT_TAIL_PAYMENT", "CONFIRM_DEPOSIT", "CONFIRM_INITIAL_PAYMENTS", "CONFIRM_TAIL_PAYMENT"].includes(command)) throw new BadRequestException("免费单不适用任何收款报备或核验");
    if (isInternalException(current) && !current.commercialConfirmedAt && ["REPORT_DEPOSIT", "REPORT_PREPAYMENT", "REPORT_TAIL_PAYMENT"].includes(command)) throw new BadRequestException("请先完成非常规订单商务确认");
    if (command === "REPORT_DEPOSIT" && (current.depositReported || current.depositConfirmed)) throw new BadRequestException("定金收款已报备或已核验，无需重复提交");
    if (command === "REPORT_DEPOSIT" && Number(payload.receivedAmount) > Number(current.amount)) throw new BadRequestException("定金到账金额不能超过合同金额，请核对后重新报备");
    if (command === "CONFIRM_DEPOSIT" && !current.depositReported) throw new BadRequestException("付款责任人尚未报备定金账户、金额、时间和凭证");
    if (command === "CONFIRM_DEPOSIT" && current.prepaymentRequired) throw new BadRequestException("新合同必须同时核验定金与预付款");
    if (command === "REPORT_PREPAYMENT" && !current.prepaymentRequired) throw new BadRequestException("该历史订单不适用预付款双核验流程");
    if (command === "REPORT_PREPAYMENT" && (current.prepaymentReported || current.prepaymentConfirmed)) throw new BadRequestException("预付款已报备或已核验，无需重复提交");
    if (command === "REPORT_PREPAYMENT" && Number(payload.receivedAmount) > Number(current.amount)) throw new BadRequestException("预付款到账金额不能超过合同金额，请核对后重新报备");
    if (command === "CONFIRM_INITIAL_PAYMENTS") {
      if (!current.prepaymentRequired || !current.depositReported || !current.prepaymentReported) throw new BadRequestException("销售必须先完整报备定金与预付款");
      if (current.depositConfirmed || current.prepaymentConfirmed) throw new BadRequestException("签约两笔首付款已经核验，不得重复确认");
      const reports = await tx.stageSubmission.findMany({ where: { orderId: id, command: { in: ["REPORT_DEPOSIT", "REPORT_PREPAYMENT"] }, status: { not: "DRAFT" } } });
      const summary = paymentSummary({ contractAmount: current.amount, depositReported: true, depositConfirmed: true, prepaymentRequired: true, prepaymentReported: true, prepaymentConfirmed: true, submissions: reports });
      if (summary.exception) throw new BadRequestException("定金与预付款合计不能超过合同金额");
    }
    if (command === "REPORT_TAIL_PAYMENT" && (current.tailPaymentReported || current.tailPaymentConfirmed)) throw new BadRequestException("尾款收款已报备或已核验，无需重复提交");
    if (command === "CONFIRM_TAIL_PAYMENT" && !current.tailPaymentReported) throw new BadRequestException("付款责任人尚未报备尾款账户、金额、时间和凭证");
    if (command === "CONFIRM_TAIL_PAYMENT" && current.tailPaymentConfirmed) throw new BadRequestException("尾款已核验，不得重复确认");
    if (command === "PLAN_PROCUREMENT") throw new BadRequestException("旧版线上采购方案已停用，请由采购在线下完成后使用“完成全部采购”");
    if (command === "ACCEPT_DESIGN" && (!current.designerId || !current.designIntakeAvailableAt || (!isCommerciallyConfirmedFree(current) && (!current.depositConfirmed || (current.prepaymentRequired && !current.prepaymentConfirmed))))) throw new BadRequestException("订单尚未通过商务付款门禁和设计师分配，不能设计下单");
    if (command === "ACCEPT_DESIGN" && current.designLeadDays && current.designLeadDays !== Number(payload.designLeadDays)) throw new BadRequestException("设计承诺天数确认后不可修改");
    if (command === "RETURN_DESIGN" && isInternalException(current)) throw new BadRequestException("非销售创建的订单不提供退回销售");
    const transition = assertTransition(current.stage as WorkflowStage, command);
    validateEvidence(command, payload);
    if (["COMPLETE_INSTALLATION", "ACCEPT_CUSTOMER"].includes(command)) {
      const [areaCount, shippedCount] = await Promise.all([
        tx.productionArea.count({ where: { orderId: id, cancelledAt: null } }),
        tx.productionArea.count({ where: { orderId: id, cancelledAt: null, shipmentAreas: { some: {} } } }),
      ]);
      if (!areaCount || shippedCount !== areaCount) throw new BadRequestException("所有有效生产区域全部发货后，才能完成整单安装和客户验收");
      const fulfillment = await this.outsource.projectionIn(tx, id);
      if (!fulfillment.installationCompletionAllowed) throw new BadRequestException("存在尚未发货的外购产品，可继续现场施工，但不能提交安装完成或客户验收");
    }

    const now = new Date();
    let persistedPayload: Record<string, unknown> = payload;
    let appliedStage = current.stage as WorkflowStage;
    await validateOrderAttachments(tx, id, payload, employee, command);
    if (["RETURN_DESIGN", "ASSIGN_DESIGNER", "TRANSFER_DESIGN"].includes(command)) {
      const fromDesigner = current.designerId ? await tx.employee.findUnique({ where: { id: current.designerId }, select: { id: true, name: true } }) : null;
      if (command === "RETURN_DESIGN") {
        if (employee.role !== "DESIGNER" || current.designerId !== employee.id) throw new ForbiddenException("只有当前设计师可以在下单前退回销售");
        await this.scheduler.cancelStage(id, "DESIGN_PENDING", now, tx);
        await tx.order.update({ where: { id }, data: { designerId: null, designIntakeAvailableAt: null, designIntakeDueAt: null, currentOwnerLabel: isInternalException(current) ? "订单管理员" : "所属销售", nextAction: "重新分配设计师" } });
        await tx.orderEvent.create({ data: { orderId: id, actorId: employee.id, type: command, title: transition.title, description: String(payload.reason).trim(), fromStage: current.stage, toStage: current.stage, metadata: { fromDesignerId: fromDesigner?.id ?? null, fromDesignerName: fromDesigner?.name ?? null, toDesignerId: null, reason: String(payload.reason).trim(), originalDueAt: current.designIntakeDueAt?.toISOString() ?? null, assignmentVersion: current.designAssignmentVersion } } });
        return { orderId: id, accessRevoked: true };
      }

      const targetId = String(payload.designerId ?? "");
      const target = await tx.employee.findFirst({ where: { id: targetId, role: "DESIGNER", active: true }, select: { id: true, name: true } });
      if (!target) throw new BadRequestException("目标设计师不存在或账号未启用");
      if (command === "ASSIGN_DESIGNER") {
        if (!isCommerciallyConfirmedFree(current) && (!current.depositConfirmed || (current.prepaymentRequired && !current.prepaymentConfirmed))) throw new BadRequestException("首付款全部核验后才能重新分配设计师");
        if (current.designerId) throw new BadRequestException("订单已有设计师，不能使用重新分配入口");
        const returned = await tx.orderEvent.findFirst({ where: { orderId: id, type: "RETURN_DESIGN" }, select: { id: true, metadata: true }, orderBy: { createdAt: "desc" } });
        if (!returned) throw new BadRequestException("只有被设计师退回的订单可以重新分配");
        const returnedMetadata = returned.metadata && typeof returned.metadata === "object" && !Array.isArray(returned.metadata) ? returned.metadata as Record<string, unknown> : {};
        const version = current.designAssignmentVersion + 1;
        const dueAt = addCalendarDays(now, 7);
        await tx.order.update({ where: { id }, data: { designerId: target.id, designerAssignedAt: now, designIntakeAvailableAt: now, designIntakeDueAt: dueAt, designAssignmentVersion: version, currentOwnerLabel: "设计师", nextAction: "7个自然日内完成设计下单" } });
        await this.scheduler.planDesignIntake(id, now, version, tx);
        await tx.orderEvent.create({ data: { orderId: id, actorId: employee.id, type: command, title: transition.title, description: `已重新分配给${target.name}`, fromStage: current.stage, toStage: current.stage, metadata: { fromDesignerId: returnedMetadata.fromDesignerId ?? null, fromDesignerName: returnedMetadata.fromDesignerName ?? null, toDesignerId: target.id, toDesignerName: target.name, reason: null, originalDueAt: returnedMetadata.originalDueAt ?? null, dueAt: dueAt.toISOString(), assignmentVersion: version } } });
        return { orderId: id, accessRevoked: false };
      }

      if (target.id === current.designerId) throw new BadRequestException("设计任务必须转给另一名设计师");
      if (!current.designDueAt || !current.designAcceptedAt || !current.designLeadDays) throw new BadRequestException("正式设计截止时间尚未形成，不能转交");
      const version = current.designAssignmentVersion + 1;
      await this.scheduler.cancelStage(id, "DESIGN_ACCEPTED", now, tx);
      await tx.order.update({ where: { id }, data: { designerId: target.id, designerAssignedAt: now, designAssignmentVersion: version, currentOwnerLabel: "设计师", nextAction: "按原截止时间提交正式设计资料" } });
      await this.scheduler.planDesignSubmission(id, current.designDueAt, version, "设计提交", tx);
      await tx.orderEvent.create({ data: { orderId: id, actorId: employee.id, type: command, title: transition.title, description: `${fromDesigner?.name ?? "原设计师"}转给${target.name}：${String(payload.reason).trim()}`, fromStage: current.stage, toStage: current.stage, metadata: { fromDesignerId: fromDesigner?.id ?? null, fromDesignerName: fromDesigner?.name ?? null, toDesignerId: target.id, toDesignerName: target.name, reason: String(payload.reason).trim(), originalDueAt: current.designDueAt.toISOString(), assignmentVersion: version } } });
      return { orderId: id, accessRevoked: employee.role === "DESIGNER" };
    }
    if (["REPORT_DEPOSIT", "REPORT_PREPAYMENT", "REPORT_TAIL_PAYMENT"].includes(command)) await this.paymentAccounts.assertApproved(tx, payload.account);
    {
      const technicalResult = command === "SUBMIT_TECHNICAL" ? await this.materialPackages.submit(tx, current, employee, payload) : null;
      if (command === "APPROVE_TECH_REVIEW") await this.materialPackages.approve(tx, id, employee, { comment: String(payload.comment ?? "") });
      if (command === "REJECT_TECH_REVIEW") await this.materialPackages.reject(tx, id, employee, String(payload.reason ?? ""));
      let salesNumberValue = current.salesNumber;
      if (command === "SUBMIT_DESIGN" && !salesNumberValue) {
        salesNumberValue = await this.allocator.allocateSales(tx, current.businessType as BusinessType, now, current.trackingSerial);
      }
      let manufacturedShipmentStage: WorkflowStage | null = null;
      let unifiedShipmentIncludesManufactured = false;
      if (command === "RECORD_DELIVERY") {
        const requestedRouteBatches = Array.isArray(payload.productionRouteBatches) ? payload.productionRouteBatches.map((value) => {
          const line = value as Record<string, unknown>;
          return { productionRouteId: String(line.productionRouteId ?? ""), isFinalBatch: line.isFinalBatch === true };
        }) : [];
        const requestedRouteIds = requestedRouteBatches.map((line) => line.productionRouteId);
        const requestedLines = Array.isArray(payload.areaLines) ? payload.areaLines.map((value) => {
          const line = value as Record<string, unknown>;
          return { productionAreaId: String(line.productionAreaId ?? ""), isFinalBatch: line.isFinalBatch === true };
        }) : [];
        const installationFees = payload.installationFees && typeof payload.installationFees === "object" && !Array.isArray(payload.installationFees)
          ? payload.installationFees as Record<string, unknown>
          : {};
        const installationFeeFor = (areaId: string, areaName: string) => {
          const fee = Number(installationFees[areaId]);
          if (!Number.isFinite(fee) || fee < 0) throw new BadRequestException(`${areaName}本批安装费用必填且不能小于0`);
          return fee;
        };
        const outsourceLineIds = Array.isArray(payload.outsourceLineIds) ? payload.outsourceLineIds.map(String) : [];
        const includesManufactured = requestedRouteIds.length > 0 || requestedLines.length > 0;
        let installationArrangement: {
          installationDepartment: string;
          assignedInstallerId: string;
          installationTeamLabel: string;
          siteContact: string;
          plannedInstallationAt: Date;
          siteConditions: string;
        } | null = null;
        if (includesManufactured) {
          const assignedInstallerId = String(payload.assignedInstallerId ?? "").trim();
          const installationTeamLabel = String(payload.installationTeamLabel ?? payload.installationDepartment ?? "").trim();
          if (!assignedInstallerId) throw new BadRequestException("自产发货必须选择明确的安装负责人");
          const assignedInstaller = await tx.employee.findFirst({ where: { id: assignedInstallerId, role: "INSTALLER", active: true } });
          if (!assignedInstaller) throw new BadRequestException("选择的安装负责人不存在、已停用或不是安装岗位");
          try {
            installationArrangement = {
              installationDepartment: installationTeamLabel,
              assignedInstallerId: assignedInstaller.id,
              installationTeamLabel,
              siteContact: String(payload.contact ?? "").trim(),
              plannedInstallationAt: parseShanghaiBusinessDate(payload.plannedAt),
              siteConditions: String(payload.supplyChecks ?? "").trim(),
            };
          } catch {
            throw new BadRequestException("计划安装日期无效");
          }
          if (!installationArrangement.installationTeamLabel || !installationArrangement.siteContact || !installationArrangement.siteConditions) {
            throw new BadRequestException("自产发货请完整填写本车次安装安排");
          }
        }
        const shipmentIds: string[] = [];
        let manufacturedAreas: Array<Record<string, unknown>> = [];
        let outsourcedLines: Array<Record<string, unknown>> = [];
        let sharedShipmentId: string | null = null;

        if (requestedRouteIds.length) {
          if (current.productionExecutionMode !== "ROUTE_V2") throw new BadRequestException("旧模式订单请使用生产区域批次发货");
          if (requestedLines.length) throw new BadRequestException("路线模式不能同时提交旧的区域批次明细");
          if (!tailPaymentSatisfied(current)) throw new BadRequestException("首批发货前必须完成尾款门禁；免费单需先完成商务确认");
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`route-shipment:${id}`}))`;
          const routes = await tx.productionRoute.findMany({
            where: { id: { in: requestedRouteIds }, orderId: id, cancelledAt: null },
            include: {
              productionProcesses: true,
              shipmentLines: true,
              productionArea: { include: {
                productionRoutes: { where: { cancelledAt: null }, include: { shipmentLines: true, productionProcesses: true } },
                shipmentAreas: true,
                technicalPackages: { where: { status: "APPROVED" }, orderBy: { version: "desc" }, take: 1 },
              } },
            },
          });
          if (routes.length !== requestedRouteIds.length) throw new BadRequestException("选中路线不属于当前订单或已取消");
          const routeStates = routes.map((route) => {
            const projected = projectProductionRoute({
              id: route.id,
              productionAreaId: route.productionAreaId,
              kind: route.kind,
              assemblyPlanQty: Number(route.assemblyPlanQty),
              releasedAt: route.releasedAt,
              productionCompletedAt: route.productionCompletedAt,
              shippedAt: route.shippedAt,
              processes: route.productionProcesses.map((process) => ({ ...process, plannedQty: Number(process.plannedQty), completedQty: Number(process.completedQty) })),
            });
            return {
              id: route.id,
              productionAreaId: route.productionAreaId,
              areaName: route.productionArea.name,
              routeLabel: PRODUCTION_ROUTE_LABELS[route.kind],
              complete: projected.complete,
              finalShipmentRecorded: Boolean(route.shippedAt) || route.shipmentLines.some((line) => line.isFinalBatch),
              batchCount: route.shipmentLines.length,
            };
          });
          try {
            validateRouteShipmentBatches(routeStates, requestedRouteBatches);
          } catch (error) {
            throw new BadRequestException(error instanceof Error ? error.message : "路线发货批次校验失败");
          }
          const shipment = await tx.shipment.create({ data: {
            orderId: id,
            kind: "MANUFACTURED",
            vehicle: String(payload.vehicle),
            deliveredAt: shanghaiBusinessDate(now),
            pieceCount: null,
            countBasis: "NOT_RECORDED",
            submittedBy: employee.id,
            ...installationArrangement!,
          } });
          sharedShipmentId = shipment.id;
          shipmentIds.push(shipment.id);
          unifiedShipmentIncludesManufactured = true;
          const grouped = new Map<string, typeof routes>();
          for (const route of routes) grouped.set(route.productionAreaId, [...(grouped.get(route.productionAreaId) ?? []), route]);
          for (const areaRoutes of grouped.values()) {
            const area = areaRoutes[0]!.productionArea;
            const sequence = area.shipmentAreas.reduce((max, line) => Math.max(max, line.sequence), 0) + 1;
            const installationFee = installationFeeFor(area.id, area.name);
            const areaRequests = requestedRouteBatches.filter((line) => areaRoutes.some((route) => route.id === line.productionRouteId));
            const existingFinalRouteIds = area.productionRoutes.filter((route) => Boolean(route.shippedAt) || route.shipmentLines.some((line) => line.isFinalBatch)).map((route) => route.id);
            const isFinalBatch = isAreaFinalAfterRouteBatch(area.productionRoutes.map((route) => route.id), existingFinalRouteIds, areaRequests);
            const shipmentArea = await tx.shipmentArea.create({ data: {
              shipmentId: shipment.id,
              productionAreaId: area.id,
              productionNumber: area.productionNumber,
              areaName: area.name,
              sequence,
              pieceCount: null,
              isFinalBatch,
              installationFee,
              installationFeeSource: "ORDER_ADMIN_DELIVERY",
              installationFeeRecordedBy: employee.id,
              routeLines: { create: areaRoutes.map((route) => {
                const request = areaRequests.find((line) => line.productionRouteId === route.id)!;
                return { productionRouteId: route.id, routeKind: route.kind, routeLabel: PRODUCTION_ROUTE_LABELS[route.kind], sequence: route.shipmentLines.length + 1, isFinalBatch: request.isFinalBatch };
              }) },
            } });
            const finalizedRouteIds = areaRequests.filter((line) => line.isFinalBatch).map((line) => line.productionRouteId);
            if (finalizedRouteIds.length) await tx.productionRoute.updateMany({ where: { id: { in: finalizedRouteIds }, shippedAt: null }, data: { shippedAt: now } });
            await tx.productionArea.update({ where: { id: area.id }, data: { status: isFinalBatch ? "SHIPPED" : "PARTIALLY_SHIPPED", shippedAt: isFinalBatch ? now : undefined } });
            for (const route of areaRoutes) {
              const request = areaRequests.find((line) => line.productionRouteId === route.id)!;
              const routeSequence = route.shipmentLines.length + 1;
              await tx.orderEvent.create({ data: { orderId: id, actorId: employee.id, type: "SHIP_PRODUCTION_ROUTE", title: `${area.name}·${PRODUCTION_ROUTE_LABELS[route.kind]}第${routeSequence}批已发货`, description: `车辆 ${String(payload.vehicle)}·${request.isFinalBatch ? "订单管理员确认为本路线末批" : "本路线仍可继续发货"}`, fromStage: current.stage, toStage: current.stage, metadata: { productionRouteId: route.id, productionAreaId: area.id, shipmentId: shipment.id, shipmentAreaId: shipmentArea.id, areaSequence: sequence, routeSequence, isFinalBatch: request.isFinalBatch } } });
            }
            if (isFinalBatch) await tx.orderEvent.create({ data: { orderId: id, actorId: employee.id, type: "COMPLETE_AREA_SHIPMENT", title: `${area.name}全部路线末批已确认`, description: `订单管理员已确认${area.name}各路线末批，区域发货收口`, fromStage: current.stage, toStage: current.stage, metadata: { productionAreaId: area.id, shipmentId: shipment.id, sequence } } });
            manufacturedAreas.push({ id: area.id, name: area.name, productionNumber: area.productionNumber, sequence, isFinalBatch, shipmentAreaId: shipmentArea.id, routes: areaRoutes.map((route) => { const request = areaRequests.find((line) => line.productionRouteId === route.id)!; return { id: route.id, kind: route.kind, label: PRODUCTION_ROUTE_LABELS[route.kind], sequence: route.shipmentLines.length + 1, isFinalBatch: request.isFinalBatch }; }) });
          }
          await this.scheduler.planStage(id, "INSTALLATION", now, tx);
          const allRoutes = await tx.productionRoute.findMany({ where: { orderId: id, cancelledAt: null }, include: { productionProcesses: true, shipmentLines: true } });
          const allRoutesComplete = allRoutes.length > 0 && allRoutes.every((route) => projectProductionRoute({ id: route.id, productionAreaId: route.productionAreaId, kind: route.kind, assemblyPlanQty: Number(route.assemblyPlanQty), releasedAt: route.releasedAt, productionCompletedAt: route.productionCompletedAt, shippedAt: route.shippedAt, processes: route.productionProcesses.map((process) => ({ ...process, plannedQty: Number(process.plannedQty), completedQty: Number(process.completedQty) })) }).complete);
          const allRoutesShipped = allRoutes.length > 0 && allRoutes.every((route) => Boolean(route.shippedAt) || route.shipmentLines.some((line) => line.isFinalBatch));
          manufacturedShipmentStage = allRoutesComplete ? allRoutesShipped ? "INSTALLATION" : "DELIVERY" : "PRODUCTION";
        }

        if (requestedLines.length) {
          if (current.productionExecutionMode === "ROUTE_V2") throw new BadRequestException("新模式订单请按生产路线登记批次并确认各路线末批");
          unifiedShipmentIncludesManufactured = true;
          const activeAreas = await tx.productionArea.findMany({
            where: { orderId: id, cancelledAt: null },
            include: { productionProcesses: true, shipmentAreas: true, technicalPackages: { where: { status: "APPROVED" }, orderBy: { version: "desc" }, take: 1 } },
            orderBy: { sequence: "asc" },
          });
          if (!activeAreas.length) throw new BadRequestException("订单没有可发货的有效生产区域");
          const allAreasComplete = activeAreas.every((area) => area.productionProcesses.length > 0 && calculateProductionProgress(area.productionProcesses.map((process) => ({ workshop: process.workshop, plannedQty: Number(process.plannedQty), completedQty: Number(process.completedQty), status: process.status, metricMode: process.metricMode }))).complete);
          const areaStates = activeAreas.map((area) => ({ id: area.id, complete: area.productionProcesses.length > 0 && calculateProductionProgress(area.productionProcesses.map((process) => ({ workshop: process.workshop, plannedQty: Number(process.plannedQty), completedQty: Number(process.completedQty), status: process.status, metricMode: process.metricMode }))).complete, finalShipmentRecorded: area.shipmentAreas.some((line) => line.isFinalBatch) }));
          if (!shipmentAllowed(tailPaymentSatisfied(current), areaStates.some((area) => area.complete && !area.finalShipmentRecorded))) throw new BadRequestException("车间产品发货未解锁：必须先通过付款门禁，并至少有一个已完工且未登记末批的生产区域");
          try {
            validateManufacturedShipmentLines(areaStates, requestedLines);
          } catch (error) {
            throw new BadRequestException(error instanceof Error ? error.message : "区域发货批次校验失败");
          }
          const selectedAreas = requestedLines.map((requested) => {
            const area = activeAreas.find((candidate) => candidate.id === requested.productionAreaId)!;
            const sequence = area.shipmentAreas.reduce((max, line) => Math.max(max, line.sequence), 0) + 1;
            return { area, requested, sequence, installationFee: installationFeeFor(area.id, area.name) };
          });
          const shipment = await tx.shipment.create({ data: {
            orderId: id, kind: "MANUFACTURED", vehicle: String(payload.vehicle), deliveredAt: shanghaiBusinessDate(now),
            pieceCount: null, countBasis: "NOT_RECORDED", submittedBy: employee.id,
            ...installationArrangement!,
            areas: { create: selectedAreas.map(({ area, requested, sequence, installationFee }) => ({ productionAreaId: area.id, productionNumber: area.productionNumber, areaName: area.name, sequence, pieceCount: null, isFinalBatch: requested.isFinalBatch, installationFee, installationFeeSource: "ORDER_ADMIN_DELIVERY", installationFeeRecordedBy: employee.id })) },
          } });
          sharedShipmentId = shipment.id;
          shipmentIds.push(shipment.id);
          await this.scheduler.planStage(id, "INSTALLATION", now, tx);
          for (const { area, requested } of selectedAreas) await tx.productionArea.update({ where: { id: area.id }, data: { status: requested.isFinalBatch ? "SHIPPED" : "PARTIALLY_SHIPPED", shippedAt: requested.isFinalBatch ? now : undefined } });
          const allAreasFinal = activeAreas.every((area) => area.shipmentAreas.some((line) => line.isFinalBatch) || selectedAreas.some((entry) => entry.area.id === area.id && entry.requested.isFinalBatch));
          manufacturedShipmentStage = allAreasComplete ? allAreasFinal ? "INSTALLATION" : "DELIVERY" : "PRODUCTION";
          manufacturedAreas = selectedAreas.map(({ area, requested, sequence }) => ({ id: area.id, name: area.name, productionNumber: area.productionNumber, sequence, isFinalBatch: requested.isFinalBatch }));
        }

        if (outsourceLineIds.length) {
          const result = await this.outsource.recordShipment(tx, current, employee, { ...payload, lineIds: outsourceLineIds, shipmentId: sharedShipmentId ?? undefined });
          if (!shipmentIds.includes(result.shipment.id)) shipmentIds.push(result.shipment.id);
          outsourcedLines = result.lines;
          if (!requestedLines.length && !requestedRouteIds.length) {
            const fulfillment = await this.outsource.projectionIn(tx, id);
            manufacturedShipmentStage = current.stage === "INSTALLATION" && fulfillment.installationCompletionAllowed ? "ACCEPTANCE" : current.stage as WorkflowStage;
          }
        }
        const { areaLines: _areaLines, productionRouteSelection: _productionRouteSelection, productionRouteFinalFlags: _productionRouteFinalFlags, deliveredAt: _ignoredDeliveredAt, ...shipmentPayload } = payload;
        persistedPayload = { ...shipmentPayload, deliveredAt: shanghaiBusinessDate(now).toISOString(), shipmentIds, areas: manufacturedAreas, lines: outsourcedLines };
      }
      let outsourceShipmentStage: WorkflowStage | null = null;
      if (command === "RECORD_OUTSOURCE_DELIVERY") {
        const result = await this.outsource.recordShipment(tx, current, employee, payload);
        const fulfillment = await this.outsource.projectionIn(tx, id);
        outsourceShipmentStage = current.stage === "INSTALLATION" && fulfillment.installationCompletionAllowed ? "ACCEPTANCE" : current.stage as WorkflowStage;
        const { deliveredAt: _ignoredDeliveredAt, ...outsourcePayload } = payload;
        persistedPayload = { ...outsourcePayload, deliveredAt: result.shipment.deliveredAt.toISOString(), shipmentId: result.shipment.id, lines: result.lines };
      }
      const isFlagCommand = ["REPORT_DEPOSIT", "REPORT_PREPAYMENT", "REPORT_TAIL_PAYMENT", "CONFIRM_TAIL_PAYMENT", "RECORD_OUTSOURCE_DELIVERY"].includes(command);
      let nextStage = (isFlagCommand ? current.stage : transition.to) as WorkflowStage;
      if (command === "SUBMIT_TECHNICAL") nextStage = "TECHNICAL";
      if (command === "RECORD_DELIVERY") nextStage = manufacturedShipmentStage ?? current.stage as WorkflowStage;
      if (command === "RECORD_OUTSOURCE_DELIVERY") nextStage = outsourceShipmentStage ?? current.stage as WorkflowStage;
      appliedStage = nextStage;
      let nextAction = transition.nextAction;
      if (command === "REPORT_DEPOSIT") nextAction = current.prepaymentRequired && !current.prepaymentReported ? "继续报备预付款" : "财务同时核验定金与预付款";
      if (command === "REPORT_PREPAYMENT") nextAction = current.depositReported ? "财务同时核验定金与预付款" : "继续报备定金";
      if (command === "REPORT_TAIL_PAYMENT") nextAction = "财务核验尾款到账";
      if (command === "CONFIRM_TAIL_PAYMENT") nextAction = "尾款已确认，可安排发货";
      if (command === "SUBMIT_TECHNICAL") nextAction = "分区域提交技术包；全部完成后提交并锁定所有区域";
      if (command === "RECORD_DELIVERY") nextAction = !unifiedShipmentIncludesManufactured ? nextStage === "ACCEPTANCE" ? "提交客户最终验收" : current.nextAction : nextStage === "PRODUCTION" ? "完成其余区域生产；安装部可办理已发批次" : nextStage === "DELIVERY" ? "继续登记各区域后续发货批次" : "安装部逐批完成安装并归集费用";
      if (command === "RECORD_OUTSOURCE_DELIVERY") nextAction = nextStage === "ACCEPTANCE" ? "提交客户最终验收" : current.nextAction;
      const productionWindow = command === "SUBMIT_DESIGN" ? calculateProductionWindow(now, current.siteType as SiteType, current.finishType as "MELAMINE" | "PAINT", current.villaFloors) : null;
      const opensDesignIntake = ["CONFIRM_DEPOSIT", "CONFIRM_INITIAL_PAYMENTS"].includes(command) && Boolean(current.designerId);
      const designIntakeDueAt = opensDesignIntake ? addCalendarDays(now, 7) : null;
      await tx.order.update({
        where: { id },
        data: {
          stage: nextStage,
          salesNumber: salesNumberValue,
          depositReported: command === "REPORT_DEPOSIT" || command === "CONFIRM_DEPOSIT" ? true : undefined,
          depositConfirmed: command === "CONFIRM_DEPOSIT" || command === "CONFIRM_INITIAL_PAYMENTS" ? true : undefined,
          prepaymentReported: command === "REPORT_PREPAYMENT" || command === "CONFIRM_INITIAL_PAYMENTS" ? true : undefined,
          prepaymentConfirmed: command === "CONFIRM_INITIAL_PAYMENTS" ? true : undefined,
          designIntakeAvailableAt: opensDesignIntake ? now : undefined,
          designIntakeDueAt: opensDesignIntake ? designIntakeDueAt : undefined,
          tailPaymentReported: command === "REPORT_TAIL_PAYMENT" || command === "CONFIRM_TAIL_PAYMENT" ? true : undefined,
          tailPaymentConfirmed: command === "CONFIRM_TAIL_PAYMENT" ? true : undefined,
          materialSubstatus: command === "SUBMIT_TECHNICAL" ? "生产区域资料准备中" : command === "APPROVE_TECH_REVIEW" ? "线下采购进行中" : command === "REJECT_TECH_REVIEW" ? "技术审单退回" : undefined,
          finalAcceptedAt: command === "ACCEPT_CUSTOMER" ? new Date(String(payload.acceptedAt ?? now)) : undefined,
          designAcceptedAt: command === "ACCEPT_DESIGN" && !current.designAcceptedAt ? now : undefined,
          designLeadDays: command === "ACCEPT_DESIGN" && !current.designLeadDays ? Number(payload.designLeadDays) : undefined,
          productionDueAt: productionWindow?.productionDueAt,
          standardDueAt: productionWindow?.productionDueAt,
          internalDueAt: productionWindow?.internalDueAt,
          sundayRisk: productionWindow?.sundayRisk,
          currentOwnerLabel: ["CONFIRM_DEPOSIT", "CONFIRM_INITIAL_PAYMENTS"].includes(command) && !current.designerId ? "所属销售"
            : command === "REPORT_TAIL_PAYMENT" && current.productionExecutionMode === "ROUTE_V2" ? "生产车间 · 财务部"
            : command === "CONFIRM_TAIL_PAYMENT" && current.productionExecutionMode === "ROUTE_V2" ? "生产车间 · 订单管理员"
              : command === "RECORD_DELIVERY" && current.productionExecutionMode === "ROUTE_V2" ? nextStage === "PRODUCTION" ? "生产车间 · 订单管理员" : nextStage === "DELIVERY" ? "订单管理员" : "安装部"
              : ["REPORT_DEPOSIT", "REPORT_PREPAYMENT", "REPORT_TAIL_PAYMENT"].includes(command) ? "财务部" : STAGE_OWNER[nextStage] ?? current.currentOwnerLabel,
          nextAction: ["CONFIRM_DEPOSIT", "CONFIRM_INITIAL_PAYMENTS"].includes(command) && !current.designerId ? "分配设计师" : nextAction,
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId: id,
          actorId: employee.id,
          type: command,
          title: transition.title,
          description: String(payload.note ?? transition.nextAction),
          fromStage: current.stage,
          toStage: nextStage,
          metadata: persistedPayload as Prisma.InputJsonObject,
        },
      });
      await tx.stageSubmission.create({
        data: {
          orderId: id,
          stage: current.stage,
          command,
          version: typeof payload.version === "string" ? payload.version : typeof payload.designVersion === "string" ? payload.designVersion : typeof payload.haixunVersion === "string" ? payload.haixunVersion : null,
          status: command.startsWith("REJECT") ? "REJECTED" : command.startsWith("APPROVE") ? "APPROVED" : "SUBMITTED",
          payload: persistedPayload as Prisma.InputJsonObject,
          checklist: Array.isArray(payload.checklist) ? payload.checklist as Prisma.InputJsonArray : undefined,
          comment: typeof payload.comment === "string" ? payload.comment : typeof payload.reason === "string" ? payload.reason : null,
          submittedBy: employee.id,
          reviewedBy: command.startsWith("APPROVE") || command.startsWith("REJECT") ? employee.id : null,
          reviewedAt: command.startsWith("APPROVE") || command.startsWith("REJECT") ? new Date() : null,
        },
      });
      if (command === "SUBMIT_TECHNICAL") {
        const productionAreaId = String(payload.productionAreaId ?? "");
        const technicalDrafts = await tx.stageSubmission.findMany({
          where: { orderId: id, command, status: "DRAFT" },
          select: { id: true, payload: true },
        });
        const ids = technicalDrafts
          .filter((draft) => String((draft.payload as Record<string, unknown> | null)?.productionAreaId ?? "") === productionAreaId)
          .map((draft) => draft.id);
        if (ids.length) await tx.stageSubmission.deleteMany({ where: { id: { in: ids } } });
      } else {
        await tx.stageSubmission.deleteMany({ where: { orderId: id, command, status: "DRAFT" } });
      }
    }
    if (command === "ACCEPT_DESIGN") {
      await this.scheduler.completeStage(id, "DESIGN_PENDING", now, tx);
      const dueAt = await this.scheduler.planDesign(id, now, Number(payload.designLeadDays), tx);
      await tx.order.update({ where: { id }, data: { designDueAt: dueAt, internalDueAt: dueAt } });
    } else if (appliedStage !== current.stage) {
      await this.scheduler.completeStage(id, current.stage as WorkflowStage, now, tx);
      await this.scheduler.planStage(id, appliedStage, now, tx);
    }
    return { orderId: id };
    }, id);
    if (mutationResult.accessRevoked) return { id, accessRevoked: true };
    return this.detail(id, employee);
  }

  async finalizeTechnicalSet(id: string, employee: Employee, meta: MutationMeta = {}) {
    await this.assertVisible(id, employee);
    const result = await runMutation(this.prisma, employee.id, `orders:${id}:technical-submission-set`, {}, meta, async (tx) => {
      const current = await tx.order.findFirst({ where: { id, ...this.scope(employee) } });
      if (!current) throw new NotFoundException("订单不存在或无权处理");
      assertCurrentVersion(current.updatedAt, meta);
      if (!['TECHNICAL', 'CHAIRMAN'].includes(employee.role)) throw new ForbiddenException("只有技术拆单员可以提交整单拆单集合");
      const finalized = await this.materialPackages.finalize(tx, current, employee);
      const now = new Date();
      await tx.order.update({ where: { id }, data: { stage: "TECH_REVIEW", materialSubstatus: "待整单技术审单", currentOwnerLabel: "订单管理员", nextAction: "完成整单技术审单" } });
      await tx.orderEvent.create({ data: { orderId: id, actorId: employee.id, type: "SUBMIT_TECHNICAL_SET", title: "整单拆单集合已提交", description: `${finalized.areas.length}个生产区域已锁定并送订单管理员技术审单`, fromStage: "TECHNICAL", toStage: "TECH_REVIEW", metadata: { submissionSetId: finalized.submissionSet.id, version: finalized.submissionSet.version, areas: finalized.areas } as unknown as Prisma.InputJsonObject } });
      await tx.stageSubmission.create({ data: { orderId: id, stage: "TECHNICAL", command: "SUBMIT_TECHNICAL_SET", version: `T${finalized.submissionSet.version}`, status: "SUBMITTED", payload: { submissionSetId: finalized.submissionSet.id, areas: finalized.areas } as unknown as Prisma.InputJsonObject, submittedBy: employee.id } });
      await this.scheduler.completeStage(id, "TECHNICAL", now, tx);
      await this.scheduler.planStage(id, "TECH_REVIEW", now, tx);
      return finalized;
    }, id);
    void result;
    return this.detail(id, employee);
  }

  async submitTechnicalDrafts(id: string, productionAreaIds: string[], employee: Employee, meta: MutationMeta = {}) {
    const selectedIds = productionAreaIds.filter((areaId) => typeof areaId === "string" && areaId.trim()).map((areaId) => areaId.trim());
    if (!selectedIds.length) throw new BadRequestException("请至少选择一个资料已就绪的生产区域");
    if (new Set(selectedIds).size !== selectedIds.length) throw new BadRequestException("批量提交的生产区域不能重复");
    await this.assertVisible(id, employee);
    await runMutation(this.prisma, employee.id, `orders:${id}:technical-packages:bulk-submit`, { productionAreaIds: selectedIds }, meta, async (tx) => {
      const current = await tx.order.findFirst({ where: { id, ...this.scope(employee) } });
      if (!current) throw new NotFoundException("订单不存在或无权处理");
      assertCurrentVersion(current.updatedAt, meta);
      if (current.stage !== "TECHNICAL") throw new BadRequestException("只有技术拆单阶段可以批量提交区域技术包");
      if (!['TECHNICAL', 'CHAIRMAN'].includes(employee.role)) throw new ForbiddenException("只有技术拆单员可以批量提交区域技术包");
      const transition = assertTransition("TECHNICAL", "SUBMIT_TECHNICAL");
      const areas = await tx.productionArea.findMany({ where: { id: { in: selectedIds }, orderId: id, cancelledAt: null }, select: { id: true, name: true, productionNumber: true } });
      if (areas.length !== selectedIds.length) throw new BadRequestException("选中的生产区域不存在、已作废或不属于当前订单");
      const drafts = await tx.stageSubmission.findMany({ where: { orderId: id, command: "SUBMIT_TECHNICAL", status: "DRAFT" }, orderBy: { updatedAt: "desc" } });
      const submittedPackages = await tx.technicalPackageVersion.findMany({ where: { orderId: id, status: "SUBMITTED" }, orderBy: { submittedAt: "desc" }, select: { haixunAttachmentIds: true, decompositionAttachmentIds: true } });
      const supportingSources = [...drafts.map((draft) => draft.payload as Record<string, unknown>), ...submittedPackages];
      const selectedDrafts = selectedIds.map((areaId) => drafts.find((draft) => String((draft.payload as Record<string, unknown> | null)?.productionAreaId ?? "") === areaId));
      const missingDraftAreas = selectedIds.filter((_, index) => !selectedDrafts[index]).map((areaId) => areas.find((area) => area.id === areaId)?.name ?? areaId);
      if (missingDraftAreas.length) throw new BadRequestException(`${missingDraftAreas.join("、")}没有可提交的区域资料草稿`);

      const now = new Date();
      for (let index = 0; index < selectedIds.length; index += 1) {
        const draft = selectedDrafts[index]!;
        const payload = inheritTechnicalSupportingFiles(draft.payload as Record<string, unknown>, supportingSources);
        validateEvidence("SUBMIT_TECHNICAL", payload);
        await validateOrderAttachments(tx, id, payload, employee, "SUBMIT_TECHNICAL");
        await this.materialPackages.submit(tx, current, employee, payload);
        const area = areas.find((candidate) => candidate.id === selectedIds[index])!;
        await tx.orderEvent.create({ data: {
          orderId: id, actorId: employee.id, type: "SUBMIT_TECHNICAL", title: transition.title,
          description: `${area.name} · ${area.productionNumber} 技术包已提交`, fromStage: "TECHNICAL", toStage: "TECHNICAL",
          metadata: payload as Prisma.InputJsonObject,
        } });
        await tx.stageSubmission.create({ data: {
          orderId: id, stage: "TECHNICAL", command: "SUBMIT_TECHNICAL", version: typeof payload.designVersion === "string" ? payload.designVersion : null,
          status: "SUBMITTED", payload: payload as Prisma.InputJsonObject, submittedBy: employee.id,
        } });
        await tx.stageSubmission.delete({ where: { id: draft.id } });
      }
      await tx.order.update({ where: { id }, data: {
        materialSubstatus: "生产区域资料准备中",
        currentOwnerLabel: "技术部",
        nextAction: "可继续填写或批量提交其他区域；全部完成后提交并锁定所有区域",
        updatedAt: now,
      } });
      return { submittedAreaIds: selectedIds };
    }, id);
    return this.detail(id, employee);
  }

  async completeInstallationBatch(id: string, shipmentId: string, employee: Employee, payload: Record<string, unknown>, meta: MutationMeta = {}) {
    if (!["INSTALLER", "CHAIRMAN"].includes(employee.role)) throw new ForbiddenException("只有安装部或董事长管理员可以完成安装批次");
    await this.assertVisible(id, employee);
    await runMutation(this.prisma, employee.id, `orders:${id}:installation-batch:${shipmentId}`, payload, meta, async (tx) => {
      const current = await tx.order.findFirst({ where: { id, ...this.scope(employee) } });
      if (!current) throw new NotFoundException("订单不存在或无权处理");
      assertCurrentVersion(current.updatedAt, meta);
      if (!["PRODUCTION", "DELIVERY", "INSTALLATION"].includes(current.stage)) throw new BadRequestException("当前订单阶段不能完成安装批次");
      const shipment = await tx.shipment.findFirst({ where: { id: shipmentId, orderId: id, kind: "MANUFACTURED" }, include: { areas: true } });
      if (!shipment) throw new NotFoundException("定制产品发货批次不存在");
      if (employee.role === "INSTALLER" && shipment.assignedInstallerId !== employee.id) throw new ForbiddenException("该安装任务未分配给当前安装人员");
      if (shipment.installedAt) throw new BadRequestException("该发货批次已经完成安装，不得重复提交");
      const installedAt = new Date(String(payload.installedAt ?? ""));
      if (Number.isNaN(installedAt.getTime())) throw new BadRequestException("安装完成日期无效");
      const installer = String(payload.installer ?? "").trim();
      const issueConclusion = String(payload.issueConclusion ?? "").trim();
      const photoAttachmentIds = Array.isArray(payload.photoAttachmentIds) ? payload.photoAttachmentIds.filter((id): id is string => typeof id === "string" && Boolean(id)) : [];
      const transportCost = Number(payload.transportCost);
      if (!installer || !photoAttachmentIds.length) throw new BadRequestException("请完整填写安装负责人和完成照片");
      if (!Number.isFinite(transportCost) || transportCost < 0) throw new BadRequestException("运输费用必填且不能小于0");
      for (const line of shipment.areas) {
        if (line.installationFee == null) throw new BadRequestException(`${line.areaName}第${line.sequence}批安装费用尚未在发货时登记，请联系订单管理员处理`);
      }
      const now = new Date();
      await validateOrderAttachments(tx, id, { photoAttachmentIds }, employee);
      await tx.shipment.update({ where: { id: shipment.id }, data: { installedAt, installer, issueConclusion: issueConclusion || null, transportCost, installationPhotoAttachmentIds: photoAttachmentIds as Prisma.InputJsonArray, installationCompletedBy: employee.id } });
      await this.scheduler.completeShipmentInstallation(id, shipmentId, now, tx);
      const fulfillment = await this.outsource.projectionIn(tx, id);
      const allProductionComplete = fulfillment.manufactured.allProductionAreasComplete;
      const nextStage = fulfillment.installationCompletionAllowed ? "ACCEPTANCE" : allProductionComplete && fulfillment.manufactured.shipped ? "INSTALLATION" : current.stage;
      await tx.order.update({ where: { id }, data: { stage: nextStage, currentOwnerLabel: nextStage === "ACCEPTANCE" ? "安装部" : nextStage === "INSTALLATION" ? "安装部" : current.currentOwnerLabel, nextAction: nextStage === "ACCEPTANCE" ? "提交客户最终验收" : "继续完成其余发货与安装批次" } });
      await tx.orderEvent.create({ data: { orderId: id, actorId: employee.id, type: "COMPLETE_INSTALLATION_BATCH", title: `第${shipment.areas.map((line) => `${line.areaName}${line.sequence}`).join("/")}批安装完成`, description: `运输费与安装完成事实已按本批归集`, fromStage: current.stage, toStage: nextStage, metadata: { shipmentId, installedAt: installedAt.toISOString(), transportCost, photoAttachmentIds } as unknown as Prisma.InputJsonObject } });
      await tx.stageSubmission.create({ data: { orderId: id, stage: current.stage, command: "COMPLETE_INSTALLATION_BATCH", status: "SUBMITTED", payload: { shipmentId, installedAt: installedAt.toISOString(), installer, issueConclusion: issueConclusion || null, transportCost, photoAttachmentIds } as unknown as Prisma.InputJsonObject, submittedBy: employee.id } });
      await tx.stageSubmission.deleteMany({ where: { orderId: id, command: "COMPLETE_INSTALLATION_BATCH", status: "DRAFT", payload: { path: ["shipmentId"], equals: shipmentId } } });
      if (nextStage === "ACCEPTANCE") {
        await this.scheduler.completeStage(id, "INSTALLATION", now, tx);
        await this.scheduler.planStage(id, "ACCEPTANCE", now, tx);
      } else if (nextStage === "INSTALLATION" && current.stage !== "INSTALLATION") {
        await this.scheduler.planStage(id, "INSTALLATION", now, tx);
      }
    }, id);
    return this.detail(id, employee);
  }

  async reportInstallationProgress(id: string, shipmentId: string, employee: Employee, payload: Record<string, unknown>, meta: MutationMeta = {}) {
    if (!["INSTALLER", "CHAIRMAN"].includes(employee.role)) throw new ForbiddenException("只有安装部或董事长管理员可以报告安装进度与现场问题");
    const reportType = String(payload.reportType ?? "");
    const note = String(payload.note ?? "").trim();
    const photoAttachmentIds = Array.isArray(payload.photoAttachmentIds) ? payload.photoAttachmentIds.filter((value): value is string => typeof value === "string" && Boolean(value)) : [];
    if (!["PARTIAL", "ISSUE"].includes(reportType) || !note) throw new BadRequestException("部分完成或现场问题必须选择类型并填写说明");
    await runMutation(this.prisma, employee.id, `orders:${id}:installation-progress:${shipmentId}`, payload, meta, async (tx) => {
      const current = await tx.order.findFirst({ where: { id, ...this.scope(employee) } });
      if (!current) throw new NotFoundException("订单不存在或无权处理");
      assertCurrentVersion(current.updatedAt, meta);
      if (!["PRODUCTION", "DELIVERY", "INSTALLATION"].includes(current.stage)) throw new BadRequestException("当前订单阶段不能报告安装进度");
      const shipment = await tx.shipment.findFirst({ where: { id: shipmentId, orderId: id, kind: "MANUFACTURED" }, include: { areas: true } });
      if (!shipment) throw new NotFoundException("定制产品发货批次不存在");
      if (employee.role === "INSTALLER" && shipment.assignedInstallerId !== employee.id) throw new ForbiddenException("该安装任务未分配给当前安装人员");
      if (shipment.installedAt) throw new BadRequestException("该发货批次已完成安装");
      await validateOrderAttachments(tx, id, { photoAttachmentIds }, employee);
      const now = new Date();
      await tx.shipment.update({ where: { id: shipment.id }, data: { issueConclusion: note } });
      await tx.order.update({ where: { id }, data: { updatedAt: now } });
      await tx.stageSubmission.create({ data: { orderId: id, stage: current.stage, command: "REPORT_INSTALLATION_PROGRESS", status: "SUBMITTED", payload: { shipmentId, reportType, note, photoAttachmentIds, reportedOn: payload.reportedOn ?? null } as unknown as Prisma.InputJsonObject, submittedBy: employee.id } });
      await tx.orderEvent.create({ data: { orderId: id, actorId: employee.id, type: reportType === "ISSUE" ? "INSTALLATION_ISSUE_REPORTED" : "INSTALLATION_PARTIAL_REPORTED", title: reportType === "ISSUE" ? "安装现场问题已上报" : "安装部分完成已记录", description: note, fromStage: current.stage, toStage: current.stage, metadata: { shipmentId, productionAreaIds: shipment.areas.map((line) => line.productionAreaId), photoAttachmentIds } as unknown as Prisma.InputJsonObject } });
    }, id);
    return this.detail(id, employee);
  }

  async saveDraft(id: string, command: OrderCommandType, employee: Employee, payload: Record<string, unknown> = {}, meta: MutationMeta = {}) {
    await runMutation(this.prisma, employee.id, `orders:${id}:draft`, { command, payload }, meta, async (tx) => {
    const current = await tx.order.findFirst({ where: { id, ...this.scope(employee) } });
    if (!current) throw new NotFoundException("订单不存在或无权处理");
    assertCurrentVersion(current.updatedAt, meta);
    if (!canExecuteOrderCommand(employee.role, command)) throw new ForbiddenException("当前角色不能保存该节点草稿");
    if (employee.role === "DESIGNER" && current.designerId !== employee.id) throw new ForbiddenException("设计师只能处理本人任务");
    if (employee.role === "SALES" && ["REPORT_DEPOSIT", "REPORT_PREPAYMENT", "REPORT_TAIL_PAYMENT"].includes(command) && current.salesId !== employee.id) throw new ForbiddenException("收款报备草稿只能由所属销售保存");
    if (command === "SUBMIT_TECHNICAL") {
      const productionAreaId = String(payload.productionAreaId ?? "");
      if (!productionAreaId) throw new BadRequestException("请先选择要保存的生产区域");
      const area = await tx.productionArea.findFirst({ where: { id: productionAreaId, orderId: id, cancelledAt: null }, select: { id: true } });
      if (!area) throw new BadRequestException("草稿生产区域不属于当前订单");
    }
    await validateOrderAttachments(tx, id, payload, employee, command);
    assertTransition(current.stage as WorkflowStage, command);
    const drafts = await tx.stageSubmission.findMany({ where: { orderId: id, command, status: "DRAFT" }, orderBy: { updatedAt: "desc" } });
    const existing = command === "SUBMIT_TECHNICAL"
      ? drafts.find((draft) => String((draft.payload as Record<string, unknown> | null)?.productionAreaId ?? "") === String(payload.productionAreaId ?? ""))
      : command === "COMPLETE_INSTALLATION_BATCH"
        ? drafts.find((draft) => String((draft.payload as Record<string, unknown> | null)?.shipmentId ?? "") === String(payload.shipmentId ?? ""))
      : drafts[0];
    const data = {
      stage: current.stage as WorkflowStage,
      command,
      status: "DRAFT",
      payload: payload as Prisma.InputJsonObject,
      checklist: Array.isArray(payload.checklist) ? payload.checklist as Prisma.InputJsonArray : undefined,
      comment: typeof payload.comment === "string" ? payload.comment : typeof payload.reason === "string" ? payload.reason : null,
      submittedBy: employee.id,
    };
    if (existing) await tx.stageSubmission.update({ where: { id: existing.id }, data });
    else await tx.stageSubmission.create({ data: { orderId: id, ...data } });
    await tx.order.update({ where: { id }, data: { updatedAt: new Date() } });
    return { id };
    }, id);
    return this.detail(id, employee);
  }

  private async assertVisible(id: string, employee: Employee) {
    const order = await this.prisma.order.findFirst({ where: { id, ...this.scope(employee) } });
    if (!order) throw new NotFoundException("订单不存在或无权处理");
    return order;
  }

  private project<T extends Record<string, unknown>>(order: T, employee: Employee) {
    const result = { ...redactOrderFinancialAmounts(redactOrderCosts(order, employee.role), employee, order as never), businessTypeLabel: businessTypeLabels[order.businessType as BusinessType] } as Record<string, unknown>;
    const internal = order.creationMode === "INTERNAL_EXCEPTION";
    const free = isCommerciallyConfirmedFree(order as never);
    result.creationModeLabel = internal ? "内部非常规订单" : "常规销售订单";
    result.chargeModeLabel = free ? "免费单" : order.commercialConfirmedAt || !internal ? "收费单" : order.chargeMode === "FREE" ? "预计免费" : "预计收费";
    result.commercialStatus = !internal ? "NOT_APPLICABLE" : order.commercialConfirmedAt ? "CONFIRMED" : "PENDING";
    if (Array.isArray(order.aftersales)) {
      result.afterSalesCount = order.aftersales.length;
      result.afterSalesActive = order.aftersales.length > 0;
      delete result.aftersales;
    }
    if (order.stage === "DEPOSIT_PENDING") {
      if (internal && !order.commercialConfirmedAt) {
        result.currentOwnerLabel = "订单管理员";
        result.nextAction = "确认非常规订单商务方式";
      } else
      if (!order.depositReported || (order.prepaymentRequired && !order.prepaymentReported)) {
        result.currentOwnerLabel = internal ? "订单管理员" : "所属销售";
        result.nextAction = !order.depositReported ? "报备定金账户、金额、到账日期和凭证" : "报备预付款账户、金额、到账日期和凭证";
      } else if (!order.depositConfirmed || (order.prepaymentRequired && !order.prepaymentConfirmed)) {
        result.currentOwnerLabel = "财务部";
        result.nextAction = order.prepaymentRequired ? "同时核验定金与预付款是否实际到账" : "核验定金是否实际到账";
      }
    }
    if (order.stage === "MATERIALS") {
      result.currentOwnerLabel = "采购部";
      result.nextAction = "按生产区域分别确认板式与实木油漆采购";
    }
    if (["INSTALLATION_APPLICATION", "DELIVERY"].includes(String(order.stage))) {
      if (free) {
        result.currentOwnerLabel = "订单管理员";
        result.nextAction = "免费单付款门禁不适用，可按完工路线登记发货";
      } else if (!order.tailPaymentConfirmed && !order.tailPaymentReported) {
        result.currentOwnerLabel = internal ? "订单管理员" : "所属销售";
        result.nextAction = "报备尾款账户、金额、到账日期和凭证";
      } else if (!order.tailPaymentConfirmed) {
        result.currentOwnerLabel = "财务部";
        result.nextAction = "核验尾款是否实际到账";
      } else {
        result.currentOwnerLabel = "订单管理员";
        result.nextAction = "尾款已确认，可按区域记录发货批次";
      }
    }
    if (["WORKSHOP", "TECHNICAL", "WAREHOUSE", "PROCUREMENT"].includes(employee.role)) {
      delete result.customerPhone;
    }
    return result;
  }
}
