import { Body, Controller, ForbiddenException, Get, Inject, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { currentEmployee } from "./auth.js";
import { AfterSalesService } from "./aftersales.service.js";
import { isMiniProgramRole } from "./domain/mini-program-access.js";
import type { OrderCommandType } from "./domain/types.js";
import { MiniWorkspaceService } from "./mini-workspace.service.js";
import { mutationMeta } from "./mutations.js";
import { OrdersService, type CreateOrderInput } from "./orders.service.js";
import { PrismaService } from "./prisma.service.js";
import { OutsourceFulfillmentService } from "./outsource-fulfillment.service.js";
import { salesBusinessTypes } from "./domain/sales-policy.js";
import { MaterialCostService } from "./material-cost.service.js";
import { PackageCountService } from "./package-count.service.js";
import { PaymentAccountService } from "./payment-account.service.js";
import type { ProductionRouteKind } from "./domain/route-execution.js";

const MOBILE_COMMANDS: Record<string, OrderCommandType[]> = {
  CHAIRMAN: ["CONFIRM_DEPOSIT", "CONFIRM_INITIAL_PAYMENTS", "CONFIRM_TAIL_PAYMENT", "ACCEPT_CUSTOMER"],
  SALES: ["REPORT_DEPOSIT", "REPORT_PREPAYMENT", "ASSIGN_DESIGNER", "REPORT_TAIL_PAYMENT"],
  ORDER_ADMIN: ["RECORD_DELIVERY", "RECORD_OUTSOURCE_DELIVERY", "ACCEPT_CUSTOMER"],
  FINANCE: ["CONFIRM_DEPOSIT", "CONFIRM_INITIAL_PAYMENTS", "CONFIRM_TAIL_PAYMENT"],
  DESIGNER: ["ACCEPT_DESIGN", "RETURN_DESIGN", "TRANSFER_DESIGN", "SUBMIT_DESIGN"],
  INSTALLER: ["ACCEPT_CUSTOMER"],
};

@Controller("api/v1/mini")
export class MiniWorkspaceController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MiniWorkspaceService) private readonly workspaces: MiniWorkspaceService,
    @Inject(OrdersService) private readonly ordersService: OrdersService,
    @Inject(AfterSalesService) private readonly aftersales: AfterSalesService,
    @Inject(OutsourceFulfillmentService) private readonly outsource: OutsourceFulfillmentService,
    @Inject(MaterialCostService) private readonly materialCosts: MaterialCostService,
    @Inject(PackageCountService) private readonly packageCounts: PackageCountService,
    @Inject(PaymentAccountService) private readonly paymentAccounts: PaymentAccountService,
  ) {}

  @Get("workspace")
  async workspace(@Req() request: Request) { return this.workspaces.workspace(await this.employee(request)); }

  @Get("orders")
  async orders(@Req() request: Request) { return this.workspaces.orders(await this.employee(request)); }

  @Get("shipments")
  async shipmentQueue(@Req() request: Request) { return this.workspaces.shipmentQueue(await this.employee(request)); }

  @Get("orders/:id")
  async order(@Param("id") id: string, @Req() request: Request) { return this.workspaces.order(id, await this.employee(request)); }

  @Get("orders/:id/shipment-form")
  async shipmentForm(@Param("id") id: string, @Req() request: Request) { return this.workspaces.shipmentForm(id, await this.employee(request)); }

  @Get("orders/:id/payment-form")
  async paymentForm(@Param("id") id: string, @Req() request: Request) { return this.workspaces.paymentForm(id, await this.employee(request)); }

  @Get("orders/:id/procurement-form")
  async procurementForm(@Param("id") id: string, @Req() request: Request) { return this.workspaces.procurementForm(id, await this.employee(request)); }

  @Get("orders/:id/supply-summary")
  async supplySummary(@Param("id") id: string, @Req() request: Request) {
    const employee = await this.employee(request);
    if (!["PROCUREMENT", "ORDER_ADMIN", "CHAIRMAN"].includes(employee.role)) throw new ForbiddenException("当前岗位不能查看包件与外购到货统计");
    const packages = await this.packageCounts.projection(id, employee);
    const order = await this.prisma.order.findUnique({ where: { id }, select: {
      id: true, customerName: true, trackingSerial: true, salesNumber: true, updatedAt: true,
      productionAreas: { where: { cancelledAt: null }, select: { id: true, name: true, productionNumber: true }, orderBy: { sequence: "asc" } },
      outsourceRequirementVersions: {
        where: { status: "APPROVED" }, orderBy: { version: "desc" }, take: 1,
        select: { lines: { orderBy: { sequence: "asc" }, select: {
          id: true, name: true, usageArea: true, plannedQty: true, unit: true, note: true,
          arrivals: { where: { voidedAt: null }, orderBy: { arrivedOn: "desc" }, select: { id: true, quantity: true, arrivedOn: true } },
          shipmentLine: { select: { id: true } },
        } } },
      },
    } });
    if (!order) throw new ForbiddenException("订单不存在或无权查看");
    const hardware = new Map(packages.sources.filter((source) => source.kind === "HARDWARE_AREA").map((source) => [source.productionAreaId, source]));
    const hardwareAreas = order.productionAreas.map((area) => {
      const source = hardware.get(area.id);
      return { id: area.id, name: area.name, productionNumber: area.productionNumber, total: source?.total ?? 0, finalized: source?.status === "FINALIZED", handoffConfirmed: source?.handoffConfirmed ?? false };
    });
    const outsourceLines = (order.outsourceRequirementVersions[0]?.lines ?? []).map((line) => {
      const plannedQty = Number(line.plannedQty);
      const arrivedQty = line.arrivals.reduce((sum, arrival) => sum + Number(arrival.quantity), 0);
      return { id: line.id, name: line.name, usageArea: line.usageArea, note: line.note, unit: line.unit, plannedQty, arrivedQty, remainingQty: plannedQty - arrivedQty, shipped: Boolean(line.shipmentLine), arrivals: line.arrivals.map((arrival) => ({ id: arrival.id, quantity: Number(arrival.quantity), arrivedOn: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(arrival.arrivedOn) })) };
    });
    return { order: { id: order.id, customerName: order.customerName, trackingSerial: order.trackingSerial, salesNumber: order.salesNumber, updatedAt: order.updatedAt },
      hardwareAreas, hardwareTotal: packages.hardwareTotal, hardwareFinalized: hardwareAreas.filter((area) => area.finalized).length,
      packageTotal: packages.currentTotal, packageStatus: packages.status, manufacturedTotal: packages.manufacturedTotal, outsourcedPackageTotal: packages.outsourcedTotal,
      packageSources: packages.sources.filter((source) => source.kind !== "HARDWARE_AREA").map((source) => ({ sourceKey: source.sourceKey, label: source.label, kind: source.kind, total: source.total, finalized: source.status === "FINALIZED", detail: source.detail })),
      outsourceLines, outsourceReady: outsourceLines.filter((line) => line.arrivedQty >= line.plannedQty).length,
      outsourcePending: outsourceLines.filter((line) => !line.shipped && line.arrivedQty < line.plannedQty).length };
  }

  @Get("reference-data")
  async referenceData(@Req() request: Request) {
    const employee = await this.employee(request);
    if (["SALES", "DESIGNER", "CHAIRMAN"].includes(employee.role)) {
      const [designers, paymentAccounts] = await Promise.all([
        this.prisma.employee.findMany({ where: { role: "DESIGNER", active: true }, select: { id: true, name: true, department: true }, orderBy: { employeeNo: "asc" } }),
        this.prisma.paymentAccount.findMany({ where: { status: "APPROVED" }, select: { name: true }, orderBy: { name: "asc" } }),
      ]);
      return { businessTypes: employee.role === "SALES" ? salesBusinessTypes(employee.businessUnit) : [], designers, paymentAccounts: paymentAccounts.map((item) => item.name), installers: [] };
    }
    if (employee.role === "ORDER_ADMIN") {
      const installers = await this.prisma.employee.findMany({ where: { role: "INSTALLER", active: true }, select: { id: true, name: true, department: true }, orderBy: { employeeNo: "asc" } });
      return { businessTypes: [], designers: [], paymentAccounts: [], installers };
    }
    return { businessTypes: [], designers: [], paymentAccounts: [], installers: [] };
  }

  @Get("drafts/:kind/:draftKey")
  async draft(@Param("kind") kind: string, @Param("draftKey") draftKey: string, @Req() request: Request) {
    const employee = await this.employee(request);
    this.assertDraftScope(employee.role, kind, draftKey);
    const draft = await this.prisma.miniProgramDraft.findUnique({ where: { employeeId_kind_draftKey: { employeeId: employee.id, kind, draftKey } } });
    return draft ? { payload: draft.payload, updatedAt: draft.updatedAt } : { payload: null, updatedAt: null };
  }

  @Post("drafts/:kind/:draftKey")
  async saveMobileDraft(@Param("kind") kind: string, @Param("draftKey") draftKey: string, @Body() body: { payload?: Record<string, unknown> }, @Req() request: Request) {
    const employee = await this.employee(request);
    this.assertDraftScope(employee.role, kind, draftKey);
    if (!body.payload || JSON.stringify(body.payload).length > 64_000) throw new ForbiddenException("草稿内容为空或超过移动端限制");
    const draft = await this.prisma.miniProgramDraft.upsert({ where: { employeeId_kind_draftKey: { employeeId: employee.id, kind, draftKey } }, create: { employeeId: employee.id, kind, draftKey, payload: body.payload as never }, update: { payload: body.payload as never } });
    return { updatedAt: draft.updatedAt };
  }

  @Post("drafts/:kind/:draftKey/clear")
  async clearMobileDraft(@Param("kind") kind: string, @Param("draftKey") draftKey: string, @Req() request: Request) {
    const employee = await this.employee(request);
    this.assertDraftScope(employee.role, kind, draftKey);
    await this.prisma.miniProgramDraft.deleteMany({ where: { employeeId: employee.id, kind, draftKey } });
    return { ok: true };
  }

  @Post("orders")
  async createOrder(@Body() body: CreateOrderInput, @Req() request: Request) {
    const employee = await this.employee(request);
    if (employee.role !== "SALES") throw new ForbiddenException("移动建单仅供销售人员使用");
    const created = await this.ordersService.create(body, employee, mutationMeta(request));
    return this.workspaces.order(String(created.id), employee);
  }

  @Post("orders/:id/drafts")
  async saveDraft(@Param("id") id: string, @Body() body: { command: OrderCommandType; payload?: Record<string, unknown> }, @Req() request: Request) {
    const employee = await this.employee(request);
    this.assertCommand(employee.role, body.command);
    await this.ordersService.saveDraft(id, body.command, employee, body.payload, mutationMeta(request));
    return this.workspaces.order(id, employee);
  }

  @Get("orders/:id/design-draft")
  async designDraft(@Param("id") id: string, @Req() request: Request) {
    const employee = await this.employee(request);
    if (employee.role !== "DESIGNER") throw new ForbiddenException("仅当前设计师可查看设计草稿");
    const order = await this.workspaces.order(id, employee);
    if (order.designerOwnerId !== employee.id || order.stageLabel !== "设计交付") throw new ForbiddenException("当前设计任务不属于你");
    const draft = await this.prisma.stageSubmission.findFirst({ where: { orderId: id, command: "SUBMIT_DESIGN", status: "DRAFT", submittedBy: employee.id }, orderBy: { updatedAt: "desc" } });
    const payload = draft?.payload && typeof draft.payload === "object" && !Array.isArray(draft.payload) ? draft.payload as Record<string, unknown> : null;
    const ids = ["cadAttachmentIds", "confirmationAttachmentIds", "sampleBlockAttachmentIds"].flatMap((key) => Array.isArray(payload?.[key]) ? payload[key] as string[] : []);
    const files = ids.length ? await this.prisma.attachment.findMany({ where: { id: { in: ids }, orderId: id, category: { in: ["DESIGN_CAD", "DESIGN_CONFIRMATION", "CUSTOMER_SAMPLE_BLOCK"] } }, select: { id: true, category: true, originalName: true, mimeType: true, size: true } }) : [];
    return { payload, files };
  }

  @Post("orders/:id/commands")
  async command(@Param("id") id: string, @Body() body: { command: OrderCommandType; payload?: Record<string, unknown> }, @Req() request: Request) {
    const employee = await this.employee(request);
    this.assertCommand(employee.role, body.command);
    if (employee.role === "CHAIRMAN") {
      const reason = String(body.payload?.overrideReason ?? "").trim();
      if (reason.length < 5) throw new ForbiddenException("董事长移动覆盖必须填写至少5个字的原因");
      body.payload = { ...(body.payload ?? {}), overrideReason: reason, note: `董事长移动覆盖：${reason}` };
    }
    if (body.command === "RECORD_DELIVERY") {
      const includesManufactured = Array.isArray(body.payload?.productionRouteBatches) && body.payload.productionRouteBatches.length > 0 || Array.isArray(body.payload?.areaLines) && body.payload.areaLines.length > 0;
      if (includesManufactured && typeof body.payload?.assignedInstallerId !== "string") throw new ForbiddenException("小程序发货必须选择明确的安装负责人");
    }
    const result = await this.ordersService.command(id, body.command, employee, body.payload, mutationMeta(request));
    if ("accessRevoked" in result && result.accessRevoked) return result;
    return this.workspaces.order(id, employee);
  }

  @Get("payment-accounts")
  async paymentAccountList(@Req() request: Request) {
    const employee = await this.employee(request);
    if (!["FINANCE", "CHAIRMAN"].includes(employee.role)) throw new ForbiddenException("当前岗位不能访问收款账户管理");
    return this.paymentAccounts.list(employee);
  }

  @Post("payment-accounts")
  async requestPaymentAccount(@Body() body: { name?: string }, @Req() request: Request) {
    const employee = await this.employee(request);
    return this.paymentAccounts.request(body.name, employee);
  }

  @Post("payment-accounts/:id/review")
  async reviewPaymentAccount(@Param("id") id: string, @Body() body: { decision?: string; comment?: string }, @Req() request: Request) {
    const employee = await this.employee(request);
    return this.paymentAccounts.review(id, body.decision, body.comment, employee);
  }

  @Post("orders/:id/procurement-routes/:kind/complete")
  async completeProcurementRoute(@Param("id") id: string, @Param("kind") kind: ProductionRouteKind, @Body() body: { attested?: boolean; overrideReason?: string; productionAreaId?: string }, @Req() request: Request) {
    const employee = await this.employee(request);
    if (!["PROCUREMENT", "CHAIRMAN"].includes(employee.role)) throw new ForbiddenException("仅采购或董事长可确认采购路线");
    if (employee.role === "CHAIRMAN" && String(body.overrideReason ?? "").trim().length < 5) throw new ForbiddenException("董事长移动覆盖必须填写至少5个字的原因");
    await this.materialCosts.completeProcurementRoute(id, kind, employee, body.attested === true, mutationMeta(request), body.overrideReason, body.productionAreaId);
    return this.workspaces.procurementForm(id, employee);
  }

  @Post("orders/:id/package-counts/hardware/finalize")
  async finalizeHardwarePackages(@Param("id") id: string, @Body() body: { areas?: Array<{ productionAreaId?: string; total?: number }> }, @Req() request: Request) {
    const employee = await this.employee(request);
    if (employee.role !== "PROCUREMENT") throw new ForbiddenException("移动五金包确认仅供采购人员使用");
    await this.packageCounts.bulkFinalizeHardware(id, body, employee, mutationMeta(request));
    return this.workspaces.procurementForm(id, employee);
  }

  @Post("orders/:id/shipments/:shipmentId/complete-installation")
  async completeInstallation(@Param("id") id: string, @Param("shipmentId") shipmentId: string, @Body() body: Record<string, unknown>, @Req() request: Request) {
    const employee = await this.employee(request);
    if (employee.role !== "INSTALLER") throw new ForbiddenException("仅安装人员可在小程序提交安装记录");
    await this.ordersService.completeInstallationBatch(id, shipmentId, employee, body, mutationMeta(request));
    return this.workspaces.order(id, employee);
  }

  @Post("orders/:id/shipments/:shipmentId/installation-progress")
  async installationProgress(@Param("id") id: string, @Param("shipmentId") shipmentId: string, @Body() body: Record<string, unknown>, @Req() request: Request) {
    const employee = await this.employee(request);
    if (employee.role !== "INSTALLER") throw new ForbiddenException("仅安装人员可在小程序上报现场进度");
    await this.ordersService.reportInstallationProgress(id, shipmentId, employee, body, mutationMeta(request));
    return this.workspaces.order(id, employee);
  }

  @Post("orders/:id/outsource/products/:lineId/arrivals")
  async recordOutsourceArrival(@Param("id") id: string, @Param("lineId") lineId: string, @Body() body: { quantity: number; arrivedOn: string }, @Req() request: Request) {
    const employee = await this.employee(request);
    if (employee.role !== "ORDER_ADMIN") throw new ForbiddenException("仅订单管理员可在小程序登记外购到货");
    await this.outsource.addArrival(id, lineId, employee, body, mutationMeta(request));
    return this.workspaces.order(id, employee);
  }

  @Get("notifications")
  async notifications(@Req() request: Request) {
    const employee = await this.employee(request);
    return (await this.prisma.notification.findMany({ where: { employeeId: employee.id }, orderBy: { createdAt: "desc" }, take: 50 })).map((item) => ({ ...item, read: Boolean(item.readAt) }));
  }

  @Post("notifications/:id/read")
  async readNotification(@Param("id") id: string, @Req() request: Request) {
    const employee = await this.employee(request);
    await this.prisma.notification.updateMany({ where: { id, employeeId: employee.id }, data: { readAt: new Date() } });
    return { ok: true };
  }

  @Get("aftersales")
  async aftersalesList(@Req() request: Request) {
    const employee = await this.employee(request);
    if (employee.role !== "AFTERSALES") throw new ForbiddenException("仅售后人员可访问售后工作区");
    return this.aftersales.list(employee);
  }

  @Post("aftersales")
  async createAfterSales(@Body() body: { orderId: string; issueType: string; description: string; incurredOn?: string; amount?: number; attachmentIds?: string[] }, @Req() request: Request) {
    const employee = await this.employee(request);
    if (employee.role !== "AFTERSALES") throw new ForbiddenException("仅售后人员可登记售后问题");
    return this.aftersales.create(body, employee, mutationMeta(request));
  }

  @Post("aftersales/:caseId/actions")
  async transitionAfterSales(@Param("caseId") caseId: string, @Body() body: { action?: "START" | "RESOLVE"; resolution?: string }, @Req() request: Request) {
    const employee = await this.employee(request);
    if (employee.role !== "AFTERSALES") throw new ForbiddenException("仅售后人员可在小程序处理售后状态");
    return this.aftersales.transition(caseId, body, employee, mutationMeta(request));
  }

  @Post("aftersales/:caseId/cost-batches")
  async addAfterSalesCost(@Param("caseId") caseId: string, @Body() body: { incurredOn?: string; amount?: number; description?: string; attachmentIds?: string[] }, @Req() request: Request) {
    const employee = await this.employee(request);
    if (employee.role !== "AFTERSALES") throw new ForbiddenException("仅售后人员可在小程序登记售后费用");
    return this.aftersales.addCostBatch(caseId, body, employee, mutationMeta(request));
  }

  @Post("aftersales/:caseId/cost-batches/:batchId/void")
  async voidAfterSalesCost(@Param("caseId") caseId: string, @Param("batchId") batchId: string, @Body() body: { reason?: string }, @Req() request: Request) {
    const employee = await this.employee(request);
    if (employee.role !== "AFTERSALES") throw new ForbiddenException("仅售后人员可在小程序作废售后费用");
    return this.aftersales.voidCostBatch(caseId, batchId, body, employee, mutationMeta(request));
  }

  private async employee(request: Request) {
    const employee = await currentEmployee(this.prisma, request);
    if (!isMiniProgramRole(employee.role)) throw new ForbiddenException("当前岗位未开放小程序");
    return employee;
  }

  private assertCommand(role: string, command: OrderCommandType) {
    if (!MOBILE_COMMANDS[role]?.includes(command)) throw new ForbiddenException("该业务动作未纳入小程序移动白名单");
  }

  private assertDraftScope(role: string, kind: string, draftKey: string) {
    if (role !== "SALES" || kind !== "SALES_ORDER" || draftKey !== "NEW") throw new ForbiddenException("当前岗位不能访问该小程序草稿");
  }
}
