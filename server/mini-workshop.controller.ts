import { Body, Controller, ForbiddenException, Get, Inject, Param, Post, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { pipeline } from "node:stream/promises";
import { basename } from "node:path";
import type { Employee } from "./generated/prisma/client.js";
import { currentEmployee } from "./auth.js";
import { AttachmentVault } from "./attachment-vault.js";
import { projectWorkshopWorkbench } from "./domain/workshop-workbench.js";
import { mutationMeta } from "./mutations.js";
import { canUploadAttachment, orderScope, requireAttachment, requireOrder } from "./order-access.js";
import { PrismaService } from "./prisma.service.js";
import { ProductionService, type ProductionReportInput } from "./production.service.js";
import { PackageCountService } from "./package-count.service.js";
import { MAX_UPLOAD_BYTES } from "./upload-policy.js";

@Controller("api/v1/mini/workshop")
export class MiniWorkshopController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(PackageCountService) private readonly packageCounts: PackageCountService) {}

  @Get("workbench")
  async workbench(@Req() request: Request) {
    const employee = await this.employee(request);
    return projectWorkshopWorkbench(employee, await this.loadOrders(employee));
  }

  @Get("package-workbench")
  async packageWorkbench(@Req() request: Request) {
    const employee = await this.employee(request);
    if (employee.workshop !== "ASSEMBLY") throw new ForbiddenException("包件待办仅供组装车间查看");
    const orders = await this.prisma.order.findMany({
      where: { stage: { in: ["PRODUCTION", "DELIVERY", "INSTALLATION"] }, ...orderScope(employee) },
      select: { id: true, customerName: true, salesNumber: true, trackingSerial: true }, orderBy: { updatedAt: "desc" }, take: 50,
    });
    const actions = [];
    for (const order of orders) {
      const summary = await this.packageCounts.projection(order.id);
      for (const source of summary.sources) {
        const actionable = source.kind === "HARDWARE_AREA"
          ? source.status === "FINALIZED" && !source.handoffConfirmed
          : source.status === "OPEN" && source.canAdd;
        if (actionable) actions.push({ orderId: order.id, customerName: order.customerName, salesNumber: order.salesNumber, trackingSerial: order.trackingSerial,
          productionAreaId: source.productionAreaId ?? "", sourceKey: source.sourceKey, kind: source.kind, label: source.label,
          actionLabel: source.kind === "HARDWARE_AREA" ? "确认领五金" : "统计包件", total: source.total });
      }
    }
    return actions;
  }

  @Get("production-areas/:productionNumber/assignment")
  async resolveProductionArea(@Param("productionNumber") productionNumber: string, @Req() request: Request) {
    const employee = await this.employee(request);
    const area = await this.prisma.productionArea.findFirst({ where: { productionNumber, order: orderScope(employee) }, select: { id: true, cancelledAt: true } });
    if (!area) return { status: "INVALID", tasks: [], message: "二维码无效或生产区域不存在" };
    if (area.cancelledAt) return { status: "CANCELLED", tasks: [], message: "该生产区域已取消，不能继续报工" };
    const workbench = projectWorkshopWorkbench(employee, await this.loadOrders(employee, productionNumber));
    const tasks = workbench.allUnfinished.filter((task) => task.productionAreaId === area.id);
    if (!tasks.length) return { status: "UNASSIGNED", tasks: [], message: "该区域没有分配给当前账号的未完成工序" };
    const actionable = tasks.filter((task) => task.canReport);
    if (actionable.length === 1) return { status: "DIRECT", task: actionable[0], tasks: actionable, message: "已找到可报工工序" };
    if (actionable.length > 1) return { status: "MULTIPLE", tasks: actionable, message: "请选择要报工的具体工序" };
    return { status: "WAITING", tasks, message: tasks[0]?.waitingReason ?? "当前工序尚未解锁" };
  }

  private async employee(request: Request) {
    const employee = await currentEmployee(this.prisma, request);
    if (employee.role !== "WORKSHOP" || !employee.workshop) throw new ForbiddenException("车间工作台仅供已分配车间的员工使用");
    return employee;
  }

  private loadOrders(employee: Employee, productionNumber?: string) {
    return this.prisma.order.findMany({
      where: { stage: { in: ["PRODUCTION", "DELIVERY", "INSTALLATION"] }, ...(productionNumber ? { productionAreas: { some: { productionNumber } } } : {}), ...orderScope(employee) },
      select: {
        id: true, trackingSerial: true, salesNumber: true, productionNumber: true, customerName: true, stage: true, rush: true, internalDueAt: true, updatedAt: true,
        productionProcesses: { include: { productionArea: { select: { id: true, name: true, productionNumber: true, cancelledAt: true } }, productionRoute: { select: { id: true, kind: true, releasedAt: true } } }, orderBy: [{ productionAreaId: "asc" }, { workshop: "asc" }, { sequence: "asc" }] },
        tasks: { where: { stage: "PRODUCTION", workshop: employee.workshop, status: { in: ["PENDING", "OVERDUE"] } }, orderBy: { dueAt: "asc" }, select: { dueAt: true, plannedStartAt: true, workloadDays: true }, take: 1 },
      },
    });
  }
}

@Controller("api/v1/mini/orders/:orderId/production")
export class MiniProductionController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(ProductionService) private readonly production: ProductionService) {}

  @Post("report")
  async report(@Param("orderId") orderId: string, @Body() body: ProductionReportInput, @Req() request: Request) {
    const employee = await currentEmployee(this.prisma, request);
    if (employee.role !== "WORKSHOP" || !employee.workshop) throw new ForbiddenException("小程序报工仅供本车间员工使用");
    await this.production.report(orderId, body, employee, mutationMeta(request));
    return { ok: true };
  }
}

@Controller("api/v1/mini/orders/:orderId/package-counts")
export class MiniPackageCountController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(PackageCountService) private readonly counts: PackageCountService) {}

  @Get()
  async summary(@Param("orderId") orderId: string, @Req() request: Request) {
    const employee = await currentEmployee(this.prisma, request);
    if (employee.role !== "WORKSHOP" || employee.workshop !== "ASSEMBLY") throw new ForbiddenException("组装车间包件台账仅供组装车间查看");
    return this.counts.projection(orderId, employee);
  }

  @Post(":sourceKey/commands")
  async command(@Param("orderId") orderId: string, @Param("sourceKey") sourceKey: string, @Body() body: { command: "ADD_COUNT" | "FINALIZE_SOURCE" | "CONFIRM_HARDWARE_HANDOFF"; quantity?: number }, @Req() request: Request) {
    const employee = await currentEmployee(this.prisma, request);
    if (employee.role !== "WORKSHOP" || employee.workshop !== "ASSEMBLY") throw new ForbiddenException("只有组装车间可提交包件台账");
    if (!["ADD_COUNT", "FINALIZE_SOURCE", "CONFIRM_HARDWARE_HANDOFF"].includes(body.command)) throw new ForbiddenException("小程序不支持此包件操作");
    return this.counts.command(orderId, sourceKey, body, employee, mutationMeta(request));
  }
}

const MOBILE_UPLOAD_CATEGORIES: Partial<Record<Employee["role"], ReadonlySet<string>>> = {
  CHAIRMAN: new Set(["CUSTOMER_ACCEPTANCE"]),
  SALES: new Set(["DEPOSIT_RECEIPT", "PREPAYMENT_RECEIPT", "TAIL_PAYMENT_RECEIPT"]),
  DESIGNER: new Set(["DESIGN_CAD", "DESIGN_CONFIRMATION", "CUSTOMER_SAMPLE_BLOCK"]),
  ORDER_ADMIN: new Set(["CUSTOMER_ACCEPTANCE"]),
  INSTALLER: new Set(["INSTALLATION_PHOTO", "CUSTOMER_ACCEPTANCE"]),
  AFTERSALES: new Set(["AFTERSALES_COST"]),
  WORKSHOP: new Set(["PRODUCTION_ISSUE"]),
};

const MOBILE_READ_CATEGORIES: Partial<Record<Employee["role"], ReadonlySet<string>>> = {
  CHAIRMAN: new Set(["INSTALLATION_PHOTO", "CUSTOMER_ACCEPTANCE", "PRODUCTION_ISSUE", "AFTERSALES_COST"]),
  ORDER_ADMIN: new Set(["INSTALLATION_PHOTO", "CUSTOMER_ACCEPTANCE", "PRODUCTION_ISSUE"]),
  FINANCE: new Set(["DEPOSIT_RECEIPT", "PREPAYMENT_RECEIPT", "TAIL_PAYMENT_RECEIPT", "PAYMENT_RECEIPT", "AFTERSALES_COST"]),
  SALES: new Set(["DEPOSIT_RECEIPT", "PREPAYMENT_RECEIPT", "TAIL_PAYMENT_RECEIPT", "PAYMENT_RECEIPT"]),
  DESIGNER: new Set(["DESIGN_CAD", "DESIGN_CONFIRMATION", "CUSTOMER_SAMPLE_BLOCK"]),
  INSTALLER: new Set(["INSTALLATION_PHOTO", "CUSTOMER_ACCEPTANCE"]),
  AFTERSALES: new Set(["AFTERSALES_COST"]),
  WORKSHOP: new Set(["PRODUCTION_ISSUE"]),
};

@Controller("api/v1/mini/attachments")
export class MiniAttachmentsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(AttachmentVault) private readonly vault: AttachmentVault) {}

  @Post(":orderId")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async upload(@Param("orderId") orderId: string, @Req() request: Request, @UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
    const employee = await currentEmployee(this.prisma, request);
    const category = String(request.body.category ?? "");
    if (!MOBILE_UPLOAD_CATEGORIES[employee.role]?.has(category)) throw new ForbiddenException("该附件类别未纳入当前岗位的小程序上传白名单");
    const order = await requireOrder(this.prisma, orderId, employee);
    if (!canUploadAttachment(employee, category, order)) throw new ForbiddenException("当前账号无权向该订单上传此类附件");
    const suppliedName = typeof request.body.originalName === "string" ? basename(request.body.originalName).trim() : "";
    const namedFile = suppliedName ? { ...file, originalname: suppliedName } : file;
    return this.vault.save(orderId, employee.id, category, namedFile, typeof request.body.productionAreaId === "string" ? request.body.productionAreaId : undefined);
  }

  @Get(":id")
  async download(@Param("id") id: string, @Req() request: Request, @Res() response: Response) {
    const employee = await currentEmployee(this.prisma, request);
    const attachment = await requireAttachment(this.prisma, id, employee);
    if (!MOBILE_READ_CATEGORIES[employee.role]?.has(attachment.category)) throw new ForbiddenException("该附件类别只允许在电脑端查看");
    const opened = await this.vault.open(id);
    response.type(opened.attachment.mimeType);
    response.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(opened.attachment.originalName)}`);
    response.setHeader("Cache-Control", "private, no-store");
    await pipeline(opened.stream, response);
  }
}
