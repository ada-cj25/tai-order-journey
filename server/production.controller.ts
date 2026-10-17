import { Body, Controller, Inject, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { currentEmployee } from "./auth.js";
import { OrdersService } from "./orders.service.js";
import { PrismaService } from "./prisma.service.js";
import { ProductionService, type ProductionReportInput } from "./production.service.js";
import { mutationMeta } from "./mutations.js";

@Controller("api/v1/orders/:orderId/production")
export class ProductionController {
  constructor(
    @Inject(ProductionService) private readonly production: ProductionService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Post("report")
  async report(@Param("orderId") orderId: string, @Body() body: ProductionReportInput, @Req() request: Request) {
    const employee = await currentEmployee(this.prisma, request);
    await this.production.report(orderId, body, employee, mutationMeta(request));
    return this.orders.detail(orderId, employee);
  }

  @Post("bulk-complete")
  async bulkComplete(@Param("orderId") orderId: string, @Body() body: { productionAreaId: string; productionRouteId?: string; workshop?: string }, @Req() request: Request) {
    const employee = await currentEmployee(this.prisma, request);
    await this.production.bulkComplete(orderId, body, employee, mutationMeta(request));
    return this.orders.detail(orderId, employee);
  }

  @Post("release")
  async release(@Param("orderId") orderId: string, @Body() body: { plans: Record<string, number> }, @Req() request: Request) {
    const employee = await currentEmployee(this.prisma, request);
    await this.production.release(orderId, body.plans, employee);
    return this.orders.detail(orderId, employee);
  }
}
