import { Body, Controller, Get, GoneException, Inject, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { currentEmployee } from "./auth.js";
import { MaterialPackageService } from "./material-package.service.js";
import { PrismaService } from "./prisma.service.js";
import { ProcurementFlow } from "./procurement-flow.service.js";
import type { MaterialTemplateType } from "./domain/types.js";
import { requireOrder, redactOrderCosts, redactOrderFinancialAmounts } from "./order-access.js";

@Controller("api/v1/material-imports")
export class MaterialImportsController {
  constructor(@Inject(MaterialPackageService) private readonly packages: MaterialPackageService, @Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Post("preview")
  async preview(@Req() request: Request, @Body() body: { orderId: string; productionAreaId: string; attachmentId: string; templateType: MaterialTemplateType }) {
    return this.packages.preview(body.orderId, body.productionAreaId, body.attachmentId, body.templateType, await currentEmployee(this.prisma, request));
  }

  @Get("order/:orderId/area/:productionAreaId/drafts")
  async drafts(@Param("orderId") orderId: string, @Param("productionAreaId") productionAreaId: string, @Req() request: Request) {
    return this.packages.listDrafts(orderId, productionAreaId, await currentEmployee(this.prisma, request));
  }

  @Post(":id/cancel")
  async cancel(@Param("id") id: string, @Req() request: Request) {
    return this.packages.cancelDraft(id, await currentEmployee(this.prisma, request));
  }
}

@Controller("api/v1/technical-reviews")
export class TechnicalReviewsController {
  constructor(@Inject(MaterialPackageService) private readonly packages: MaterialPackageService, @Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list(@Req() request: Request) {
    const employee = await currentEmployee(this.prisma, request);
    if (!["ORDER_ADMIN", "CHAIRMAN"].includes(employee.role)) return [];
    return this.packages.reviewQueue();
  }

  @Get("order/:orderId")
  async detail(@Param("orderId") orderId: string, @Req() request: Request) {
    const employee = await currentEmployee(this.prisma, request);
    const order = await requireOrder(this.prisma, orderId, employee);
    const result = await this.packages.detail(orderId);
    return result ? redactOrderFinancialAmounts(redactOrderCosts(result, employee.role), employee, order) : null;
  }
}

@Controller("api/v1/warehouse/material-releases")
export class WarehouseMaterialReleasesController {
  constructor(@Inject(ProcurementFlow) private readonly procurement: ProcurementFlow, @Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Post(":materialVersionId")
  async release(@Param("materialVersionId") materialVersionId: string, @Req() request: Request, @Body() body: { location?: string; batchNo?: string; note?: string }) {
    throw new GoneException("线上库存核料已停用；物料版仅用于线下采购和成本核算");
  }
}

@Controller("api/v1/procurement")
export class ProcurementFlowController {
  constructor(@Inject(ProcurementFlow) private readonly procurement: ProcurementFlow, @Inject(PrismaService) private readonly prisma: PrismaService) {}

  private retired(): never { throw new GoneException("旧版线上采购过程已停用；请使用采购与成本页面"); }

  @Get()
  async list(@Req() request: Request) {
    return this.procurement.list(await currentEmployee(this.prisma, request));
  }

  @Post("suppliers")
  async createSupplier(@Req() request: Request, @Body() body: { code: string; name: string; contact?: string; phone?: string; taxNo?: string }) {
    return this.retired();
  }

  @Post("requirements/:id/quotes")
  async submitQuote(@Param("id") id: string, @Req() request: Request, @Body() body: Parameters<ProcurementFlow["submitQuote"]>[2]) {
    return this.retired();
  }

  @Post("quotes/:id/submit-for-review")
  async submitQuoteForReview(@Param("id") id: string, @Req() request: Request) {
    return this.retired();
  }

  @Post("quotes/:id/review")
  async reviewQuote(@Param("id") id: string, @Req() request: Request, @Body() body: { approved: boolean; comment?: string }) {
    return this.retired();
  }

  @Post("purchase-orders")
  async createPurchaseOrder(@Req() request: Request, @Body() body: { quoteIds: string[]; expectedAt?: string; note?: string }) {
    return this.retired();
  }

  @Post("purchase-orders/:id/issue")
  async issuePurchaseOrder(@Param("id") id: string, @Req() request: Request) {
    return this.retired();
  }

  @Post("purchase-orders/:id/terminate")
  async terminatePurchaseOrder(@Param("id") id: string, @Req() request: Request, @Body() body: Parameters<ProcurementFlow["terminatePurchaseOrder"]>[2]) {
    return this.retired();
  }

  @Post("requirements/:id/confirm-replenishment")
  async confirmRequirementReplenishment(@Param("id") id: string, @Req() request: Request) {
    return this.retired();
  }

  @Post("receipts")
  async receive(@Req() request: Request, @Body() body: Parameters<ProcurementFlow["receive"]>[1]) {
    return this.retired();
  }

  @Post("returns/:id/resolve")
  async resolveReturn(@Param("id") id: string, @Req() request: Request, @Body() body: Parameters<ProcurementFlow["resolveReturn"]>[2]) {
    return this.retired();
  }

  @Post("material-versions/:id/cancel-and-rebuild")
  async cancelAndRebuild(@Param("id") id: string, @Req() request: Request, @Body() body: { reason: string; supplierResolution?: unknown; receivedResolution?: unknown }) {
    return this.procurement.cancelAndRebuild(id, await currentEmployee(this.prisma, request), body);
  }
}

@Controller("api/v1/material-versions")
export class MaterialVersionsController {
  constructor(@Inject(ProcurementFlow) private readonly procurement: ProcurementFlow, @Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Post(":id/cancel-and-rebuild")
  async cancelAndRebuild(@Param("id") id: string, @Req() request: Request, @Body() body: { reason: string; supplierResolution?: unknown; receivedResolution?: unknown }) {
    return this.procurement.cancelAndRebuild(id, await currentEmployee(this.prisma, request), body);
  }
}

@Controller("api/v1/inventory/stock-policy-change-requests")
export class StockPolicyChangesController {
  constructor(@Inject(ProcurementFlow) private readonly procurement: ProcurementFlow, @Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Post(":itemId")
  async propose(@Param("itemId") itemId: string, @Req() request: Request, @Body() body: { minimumStock?: number; targetStock?: number; replenishmentLot?: number; reason: string }) {
    throw new GoneException("线上库存策略已停用");
  }

  @Post(":id/review")
  async review(@Param("id") id: string, @Req() request: Request, @Body() body: { approved: boolean }) {
    throw new GoneException("线上库存策略已停用");
  }
}

@Controller("api/v1/inventory/replenishment-suggestions")
export class ReplenishmentSuggestionsController {
  constructor(@Inject(ProcurementFlow) private readonly procurement: ProcurementFlow, @Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Post(":itemId/confirm")
  async confirm(@Param("itemId") itemId: string, @Req() request: Request) {
    throw new GoneException("线上补货建议已停用");
  }
}
