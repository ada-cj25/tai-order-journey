import { Body, Controller, Get, Inject, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { currentEmployee } from "./auth.js";
import { mutationMeta } from "./mutations.js";
import { OutsourceFulfillmentService } from "./outsource-fulfillment.service.js";
import { PrismaService } from "./prisma.service.js";

@Controller("api/v1/orders/:orderId/outsource")
export class OutsourceFulfillmentController {
  constructor(@Inject(OutsourceFulfillmentService) private readonly outsource: OutsourceFulfillmentService, @Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get("draft")
  async draft(@Param("orderId") orderId: string, @Req() request: Request) {
    return this.outsource.draft(orderId, await currentEmployee(this.prisma, request));
  }

  @Post("draft")
  async saveDraft(@Param("orderId") orderId: string, @Req() request: Request, @Body() body: { declaresNone?: boolean; lines?: Array<{ presetCode?: string; name: string; plannedQty: number; unit?: string; usageArea?: string; note?: string }> }) {
    return this.outsource.saveDraft(orderId, await currentEmployee(this.prisma, request), body, mutationMeta(request));
  }

  @Post("products/:lineId/arrivals")
  async arrival(@Param("orderId") orderId: string, @Param("lineId") lineId: string, @Req() request: Request, @Body() body: { quantity: number; arrivedOn: string }) {
    return this.outsource.addArrival(orderId, lineId, await currentEmployee(this.prisma, request), body, mutationMeta(request));
  }

  @Post("arrivals/:arrivalId/void")
  async voidArrival(@Param("orderId") orderId: string, @Param("arrivalId") arrivalId: string, @Req() request: Request, @Body() body: { reason: string }) {
    return this.outsource.voidArrival(orderId, arrivalId, await currentEmployee(this.prisma, request), body.reason ?? "", mutationMeta(request));
  }
}

