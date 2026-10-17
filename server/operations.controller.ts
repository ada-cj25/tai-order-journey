import { BadRequestException, Body, Controller, ForbiddenException, Get, GoneException, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { currentEmployee } from "./auth.js";
import type { Prisma } from "./generated/prisma/client.js";
import { PrismaService } from "./prisma.service.js";
import { sortTasksByUrgency, taskUrgency } from "./domain/task-priority.js";
import { projectActionableProductionTasks } from "./domain/production-task-projection.js";
import { projectActionableShipmentTasks } from "./domain/shipment-task-projection.js";
import { projectActionableInitialPaymentTasks } from "./domain/initial-payment-task-projection.js";
import { projectActionableDesignIntakeTasks } from "./domain/design-intake-task-projection.js";
import { projectActionableOutsourceArrivalTasks } from "./domain/outsource-arrival-task-projection.js";
import { projectPendingPaymentAccountTasks } from "./domain/payment-account-task-projection.js";
import { projectActionablePackageCountTasks } from "./domain/package-count-task-projection.js";
import { productionWorkshopComplete } from "./domain/production-progress.js";
import { PackageCountService } from "./package-count.service.js";
import { orderScope, requireOrder } from "./order-access.js";
import { mutationMeta } from "./mutations.js";
import { AfterSalesService } from "./aftersales.service.js";

@Controller("api/v1/tasks")
export class TasksController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(PackageCountService) private readonly packageCounts: PackageCountService) {}

  @Get()
  async list(@Req() request: Request, @Query("scope") scope = "mine") {
    const employee = await currentEmployee(this.prisma, request);
    const now = new Date();
    const tasks = await this.prisma.task.findMany({
      where: {
        ...(scope === "department" ? { department: employee.department } : { ownerId: employee.id }),
        order: orderScope(employee),
        status: { in: ["PENDING", "OVERDUE"] },
        NOT: [
          { uniqueKey: { contains: ":MATERIALS:PROCUREMENT" } },
          { uniqueKey: { startsWith: "PRICE_REVIEW:" } },
          { uniqueKey: { startsWith: "CREATE_PO:" } },
        ],
      },
      include: { order: { select: { id: true, trackingSerial: true, salesNumber: true, productionNumber: true, customerName: true, stage: true, rush: true, productionAreas: { where: { cancelledAt: null }, orderBy: { sequence: "asc" }, select: { id: true, name: true, productionNumber: true, productionProcesses: { where: { productionRouteId: null }, select: { workshop: true, plannedQty: true, completedQty: true, status: true, metricMode: true } }, productionRoutes: { where: { cancelledAt: null }, select: { id: true, productionProcesses: { select: { workshop: true, plannedQty: true, completedQty: true, status: true, metricMode: true } } } } } } } } },
    });
    const productionOrders = scope === "mine" && employee.role === "WORKSHOP" && employee.level === "STAFF" && employee.workshop
      ? await this.prisma.order.findMany({
          where: { stage: { in: ["PRODUCTION", "DELIVERY", "INSTALLATION"] }, ...orderScope(employee) },
          select: {
            id: true, trackingSerial: true, salesNumber: true, productionNumber: true, customerName: true, stage: true, rush: true, internalDueAt: true,
            productionProcesses: { include: { productionArea: { select: { id: true, name: true, productionNumber: true } }, productionRoute: { select: { id: true, kind: true, releasedAt: true } } }, orderBy: [{ productionAreaId: "asc" }, { workshop: "asc" }, { sequence: "asc" }] },
            tasks: { where: { stage: "PRODUCTION", workshop: employee.workshop, status: { in: ["PENDING", "OVERDUE"] } }, orderBy: { dueAt: "asc" }, select: { dueAt: true, plannedStartAt: true, workloadDays: true }, take: 1 },
          },
        })
      : [];
    const shipmentOrders = scope === "mine" && ["SALES", "FINANCE", "ORDER_ADMIN"].includes(employee.role)
      ? await this.prisma.order.findMany({
          where: {
            stage: { in: ["PRODUCTION", "INSTALLATION_APPLICATION", "DELIVERY", "INSTALLATION"] },
            tailPaymentConfirmed: false,
            OR: [
              { productionRoutes: { some: { productionCompletedAt: { not: null }, shippedAt: null, cancelledAt: null } } },
              { stage: { in: ["INSTALLATION_APPLICATION", "DELIVERY"] } },
            ],
            ...(employee.role === "SALES" ? { creationMode: "SALES_STANDARD", salesId: employee.id, tailPaymentReported: false } : employee.role === "ORDER_ADMIN" ? { creationMode: "INTERNAL_EXCEPTION", chargeMode: "CHARGED", commercialConfirmedAt: { not: null }, tailPaymentReported: false } : { tailPaymentReported: true }),
            ...orderScope(employee),
          },
          select: {
            id: true, salesId: true, creationMode: true, chargeMode: true, commercialConfirmedAt: true, trackingSerial: true, salesNumber: true, productionNumber: true, customerName: true, stage: true, rush: true, internalDueAt: true,
            tailPaymentReported: true, tailPaymentConfirmed: true,
            productionRoutes: { where: { productionCompletedAt: { not: null }, shippedAt: null, cancelledAt: null }, select: { id: true } },
            tasks: { where: { stage: { in: ["INSTALLATION_APPLICATION", "DELIVERY"] }, status: { in: ["PENDING", "OVERDUE"] } }, orderBy: { dueAt: "asc" }, select: { dueAt: true }, take: 1 },
          },
        })
      : [];
    const initialPaymentOrders = scope === "mine" && ["SALES", "FINANCE", "ORDER_ADMIN"].includes(employee.role)
      ? await this.prisma.order.findMany({
          where: {
            stage: "DEPOSIT_PENDING",
            ...(employee.role === "SALES" ? { creationMode: "SALES_STANDARD", salesId: employee.id } : employee.role === "ORDER_ADMIN" ? { creationMode: "INTERNAL_EXCEPTION", commercialConfirmedAt: null } : { OR: [{ creationMode: "SALES_STANDARD" as const }, { creationMode: "INTERNAL_EXCEPTION" as const, chargeMode: "CHARGED" as const, commercialConfirmedAt: { not: null } }] }),
            ...orderScope(employee),
          },
          select: {
            id: true, salesId: true, creationMode: true, chargeMode: true, commercialConfirmedAt: true, trackingSerial: true, salesNumber: true, productionNumber: true, customerName: true, stage: true, rush: true, internalDueAt: true,
            prepaymentRequired: true, depositReported: true, depositConfirmed: true, prepaymentReported: true, prepaymentConfirmed: true,
          },
        })
      : [];
    const designIntakeOrders = scope === "mine" && ["DESIGNER", "SALES", "ORDER_ADMIN"].includes(employee.role)
      ? await this.prisma.order.findMany({
          where: {
            stage: "DESIGN_PENDING",
            ...(employee.role === "DESIGNER" ? { designerId: employee.id } : employee.role === "ORDER_ADMIN" ? { creationMode: "INTERNAL_EXCEPTION", designerId: null } : { creationMode: "SALES_STANDARD", designerId: null, salesId: employee.id }),
            ...orderScope(employee),
          },
          select: {
            id: true, salesId: true, creationMode: true, designerId: true, trackingSerial: true, salesNumber: true, productionNumber: true, customerName: true, stage: true, rush: true, internalDueAt: true,
            designIntakeDueAt: true, designAssignmentVersion: true,
            tasks: { where: { stage: "DESIGN_PENDING", status: { in: ["PENDING", "OVERDUE"] } }, select: { id: true }, take: 1 },
          },
        })
      : [];
    const outsourceArrivalOrders = scope === "mine" && employee.role === "ORDER_ADMIN"
      ? await this.prisma.order.findMany({
          where: {
            stage: { in: ["MATERIALS", "PRODUCTION", "INSTALLATION_APPLICATION", "DELIVERY", "INSTALLATION"] },
            outsourceRequirementMode: "REQUIRED",
            ...orderScope(employee),
          },
          select: {
            id: true, trackingSerial: true, salesNumber: true, productionNumber: true, customerName: true, stage: true, rush: true, internalDueAt: true, outsourceRequirementMode: true,
            outsourceRequirementVersions: {
              where: { status: "APPROVED" }, orderBy: { version: "desc" }, take: 1,
              select: { lines: { select: { plannedQty: true, arrivals: { select: { quantity: true, voidedAt: true } } } } },
            },
          },
        })
      : [];
    const pendingPaymentAccounts = scope === "mine" && employee.role === "CHAIRMAN"
      ? await this.prisma.paymentAccount.findMany({
          where: { status: "PENDING" },
          select: { id: true, name: true, status: true, requestedAt: true },
          orderBy: { requestedAt: "asc" },
        })
      : [];
    const packageOrders = scope === "mine" && (employee.role === "PROCUREMENT" || (employee.role === "WORKSHOP" && employee.workshop === "ASSEMBLY"))
      ? await this.prisma.order.findMany({
          where: { stage: { in: ["MATERIALS", "PRODUCTION", "INSTALLATION_APPLICATION", "DELIVERY", "INSTALLATION", "ACCEPTANCE"] }, productionAreas: { some: { cancelledAt: null } }, ...orderScope(employee) },
          select: { id: true, trackingSerial: true, salesNumber: true, productionNumber: true, customerName: true, stage: true, rush: true, internalDueAt: true, productionAreas: { where: { cancelledAt: null }, orderBy: { sequence: "asc" }, select: { id: true, name: true, productionNumber: true } } },
        })
      : [];
    const scopedPersistedTasks = tasks.flatMap((task) => {
      const routeScope = task.stage === "PRODUCTION"
        ? task.order.productionAreas.flatMap((area) => area.productionRoutes.map((route) => ({ area, route }))).find(({ route }) => task.uniqueKey.includes(`:PRODUCTION:${route.id}:`))
        : undefined;
      const fallbackArea = task.stage === "PRODUCTION" && task.order.productionAreas.length === 1 ? task.order.productionAreas[0] : undefined;
      const productionArea = routeScope?.area ?? fallbackArea;
      const workshopProcesses = routeScope?.route.productionProcesses ?? productionArea?.productionProcesses ?? [];
      if (task.stage === "PRODUCTION" && task.workshop && productionWorkshopComplete(workshopProcesses.map((item) => ({ ...item, plannedQty: Number(item.plannedQty), completedQty: Number(item.completedQty) })), task.workshop)) return [];
      return [{
        ...task,
        productionRouteId: routeScope?.route.id ?? null,
        order: {
          ...task.order,
          productionAreas: task.order.productionAreas.map(({ productionRoutes: _productionRoutes, productionProcesses: _productionProcesses, ...area }) => area),
          productionArea: productionArea ? { id: productionArea.id, name: productionArea.name, productionNumber: productionArea.productionNumber } : null,
        },
      }];
    });
    const processTasks = projectActionableProductionTasks(employee, productionOrders, now);
    const shipmentTasks = projectActionableShipmentTasks(employee, shipmentOrders.map((order) => ({ ...order, shipmentReady: order.productionRoutes.length > 0 })), now);
    const initialPaymentTasks = projectActionableInitialPaymentTasks(employee, initialPaymentOrders, now);
    const designIntakeTasks = projectActionableDesignIntakeTasks(employee, designIntakeOrders.map((order) => ({
      ...order,
      salesEmployeeId: order.salesId,
      hasPersistedTask: employee.role === "DESIGNER" && order.tasks.length > 0,
    })), now);
    const outsourceArrivalTasks = projectActionableOutsourceArrivalTasks(employee, outsourceArrivalOrders.map((order) => ({
      ...order,
      outsourceLines: (order.outsourceRequirementVersions[0]?.lines ?? []).map((line) => ({
        plannedQty: Number(line.plannedQty),
        arrivals: line.arrivals.map((arrival) => ({ quantity: Number(arrival.quantity), voidedAt: arrival.voidedAt })),
      })),
    })), now);
    const paymentAccountTasks = projectPendingPaymentAccountTasks(employee, pendingPaymentAccounts);
    const packageTaskOrders = await Promise.all(packageOrders.map(async (order) => ({ ...order, packageSummary: await this.packageCounts.projection(order.id) })));
    const packageCountTasks = projectActionablePackageCountTasks(employee, packageTaskOrders, now);
    return sortTasksByUrgency([...scopedPersistedTasks, ...initialPaymentTasks, ...designIntakeTasks, ...outsourceArrivalTasks, ...processTasks, ...shipmentTasks, ...paymentAccountTasks, ...packageCountTasks], now).map((task) => ({ ...task, urgency: taskUrgency(task, now) }));
  }
}

@Controller("api/v1/notifications")
export class NotificationsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list(@Req() request: Request) {
    const employee = await currentEmployee(this.prisma, request);
    // Reminders encode their originating task key; old reminders must not leak
    // an order after its salesperson/brand assignment has changed.
    const salesTasks = employee.role === "SALES"
      ? await this.prisma.task.findMany({ where: { order: orderScope(employee) }, select: { uniqueKey: true } }) : null;
    return this.prisma.notification.findMany({
      where: {
        employeeId: employee.id,
        ...(salesTasks ? { OR: salesTasks.map((task) => ({ uniqueKey: { startsWith: `${task.uniqueKey}:` } })) } : {}),
        NOT: [
          { uniqueKey: { contains: ":MATERIALS:PROCUREMENT" } },
          { uniqueKey: { startsWith: "PRICE_REVIEW:" } },
          { uniqueKey: { startsWith: "CREATE_PO:" } },
          { title: { contains: "库存" } },
          { title: { contains: "缺料" } },
          { title: { contains: "补货" } },
          { title: { contains: "齐套" } },
          { title: { contains: "采购报价" } },
          { title: { contains: "采购单" } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  @Post(":id/read")
  async read(@Param("id") id: string, @Req() request: Request) {
    const employee = await currentEmployee(this.prisma, request);
    await this.prisma.notification.updateMany({ where: { id, employeeId: employee.id }, data: { readAt: new Date() } });
    return { ok: true };
  }
}

@Controller("api/v1/inventory")
export class InventoryController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list(@Req() request: Request) {
    const employee = await currentEmployee(this.prisma, request);
    if (employee.role !== "CHAIRMAN") throw new ForbiddenException("历史库存仅董事长管理员可审计读取");
    return this.prisma.inventoryItem.findMany({ orderBy: [{ mode: "asc" }, { sku: "asc" }] });
  }

  @Post()
  async create(@Req() request: Request, @Body() body: Record<string, unknown>) {
    throw new GoneException("线上库存档案维护已停用；历史库存仅保留只读审计");
  }
}

@Controller("api/v1/procurement")
export class ProcurementController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const [demands, standards] = await Promise.all([
      this.prisma.purchaseDemand.findMany({ include: { item: true, order: { select: { id: true, trackingSerial: true, salesNumber: true, productionNumber: true, customerName: true } } }, orderBy: { createdAt: "desc" } }),
      this.prisma.inventoryItem.findMany({ where: { mode: "STOCK_STANDARD", approvedStandard: true } }),
    ]);
    const suggestions = standards
      .filter((item) => Number(item.onHand) - Number(item.reserved) < Number(item.minimumStock ?? 0))
      .map((item) => ({
        itemId: item.id,
        sku: item.sku,
        name: item.name,
        available: Number(item.onHand) - Number(item.reserved),
        suggestedQty: Math.max(Number(item.replenishmentLot ?? 0), Number(item.targetStock ?? 0) - Number(item.onHand) + Number(item.reserved)),
        status: "SUGGESTION_ONLY",
      }));
    return { demands, suggestions };
  }

  @Post("calculate/:orderId")
  async calculate(
    @Param("orderId") orderId: string,
    @Req() request: Request,
    @Body() body: { lines?: Array<{ itemId: string; quantity: number }> },
  ) {
    throw new GoneException("线上采购需求计算已停用；物料由订单管理员技术审单发布后自动进入成本核算");
  }
}

@Controller("api/v1/aftersales")
export class AfterSalesController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(AfterSalesService) private readonly aftersales: AfterSalesService) {}

  @Get()
  async list(@Req() request: Request) {
    const employee = await currentEmployee(this.prisma, request);
    return this.aftersales.list(employee);
  }

  @Post()
  async create(@Req() request: Request, @Body() body: { orderId: string; issueType: string; description: string; incurredOn?: string; amount?: number; attachmentIds?: string[] }) {
    const employee = await currentEmployee(this.prisma, request);
    return this.aftersales.create(body, employee, mutationMeta(request));
  }

  @Post(":caseId/cost-batches")
  async addCostBatch(@Param("caseId") caseId: string, @Req() request: Request, @Body() body: { incurredOn?: string; amount?: number; description?: string; attachmentIds?: string[] }) {
    return this.aftersales.addCostBatch(caseId, body, await currentEmployee(this.prisma, request), mutationMeta(request));
  }

  @Post(":caseId/actions")
  async transition(@Param("caseId") caseId: string, @Req() request: Request, @Body() body: { action?: "START" | "RESOLVE"; resolution?: string }) {
    return this.aftersales.transition(caseId, body, await currentEmployee(this.prisma, request), mutationMeta(request));
  }

  @Post(":caseId/cost-batches/:batchId/void")
  async voidCostBatch(@Param("caseId") caseId: string, @Param("batchId") batchId: string, @Req() request: Request, @Body() body: { reason?: string }) {
    return this.aftersales.voidCostBatch(caseId, batchId, body, await currentEmployee(this.prisma, request), mutationMeta(request));
  }
}

@Controller("api/v1/imports/haixun")
export class HaixunController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list(@Req() request: Request, @Query("orderId") orderId?: string) {
    const employee = await currentEmployee(this.prisma, request);
    return this.prisma.haixunImport.findMany({ where: { ...(orderId ? { orderId } : {}), order: orderScope(employee) }, orderBy: { createdAt: "desc" } });
  }

  @Post("preview")
  async preview(@Req() request: Request, @Body() body: { orderId: string; fileName: string; rows: unknown[]; errors?: unknown[] }) {
    const employee = await currentEmployee(this.prisma, request);
    if (!["TECHNICAL", "CHAIRMAN"].includes(employee.role)) throw new ForbiddenException("仅技术拆单岗位可预览导入");
    await requireOrder(this.prisma, body.orderId, employee);
    const latest = await this.prisma.haixunImport.findFirst({ where: { orderId: body.orderId }, orderBy: { version: "desc" } });
    return this.prisma.haixunImport.create({
      data: {
        orderId: body.orderId,
        version: (latest?.version ?? 0) + 1,
        fileName: body.fileName,
        uploadedBy: employee.id,
        preview: body.rows as Prisma.InputJsonValue,
        errors: (body.errors ?? []) as Prisma.InputJsonValue,
      },
    });
  }

  @Post(":id/publish")
  async publish(@Param("id") id: string, @Req() request: Request) {
    throw new GoneException("独立海迅发布入口已停用；请通过技术提交包的独立复核发布");
  }
}
