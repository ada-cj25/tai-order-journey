import { Body, Controller, Get, Inject, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { currentEmployee } from "./auth.js";
import { MaterialCostService } from "./material-cost.service.js";
import { OrdersService } from "./orders.service.js";
import { PrismaService } from "./prisma.service.js";
import { mutationMeta } from "./mutations.js";
import type { ProductionRouteKind } from "./domain/route-execution.js";

@Controller("api/v1")
export class MaterialCostController {
  constructor(
    @Inject(MaterialCostService) private readonly costs: MaterialCostService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get("procurement/orders")
  async procurementOrders(@Req() request: Request) {
    return this.costs.listOrders(await currentEmployee(this.prisma, request));
  }

  @Get("material-cost-items")
  async items(@Req() request: Request) {
    return this.costs.listItems(await currentEmployee(this.prisma, request));
  }

  @Post("material-cost-items/:id/prices")
  async addPrice(@Param("id") id: string, @Body() body: { unitPrice: number; note?: string }, @Req() request: Request) {
    return this.costs.addPrice(id, await currentEmployee(this.prisma, request), body);
  }

  @Get("workshop-cost-rates")
  async workshopRates(@Req() request: Request) {
    return this.costs.listWorkshopRates(await currentEmployee(this.prisma, request));
  }

  @Post("workshop-cost-rates/:workshop/prices")
  async addWorkshopRate(@Param("workshop") workshop: string, @Body() body: { unitPrice: number; note?: string }, @Req() request: Request) {
    return this.costs.addWorkshopRate(workshop, await currentEmployee(this.prisma, request), body);
  }

  @Get("orders/:id/material-cost")
  async orderCost(@Param("id") id: string, @Req() request: Request) {
    return this.costs.orderCost(id, await currentEmployee(this.prisma, request));
  }

  @Post("orders/:id/material-cost/recalculate")
  async recalculate(@Param("id") id: string, @Req() request: Request) {
    return this.costs.recalculate(id, await currentEmployee(this.prisma, request));
  }

  @Post("orders/:id/outsource-cost/products/:lineId/prices")
  async addOutsourceCostPrice(@Param("id") id: string, @Param("lineId") lineId: string, @Body() body: { unitPrice: number; note?: string }, @Req() request: Request) {
    return this.costs.addOutsourceCostPrice(id, lineId, await currentEmployee(this.prisma, request), body);
  }

  @Post("orders/:id/complete-procurement")
  async complete(@Param("id") id: string, @Body() body: { attested: boolean }, @Req() request: Request) {
    const employee = await currentEmployee(this.prisma, request);
    await this.costs.completeProcurement(id, employee, body.attested === true, mutationMeta(request));
    return this.orders.detail(id, employee);
  }

  @Post("orders/:id/procurement-routes/:kind/complete")
  async completeRoute(@Param("id") id: string, @Param("kind") kind: ProductionRouteKind, @Body() body: { attested: boolean; productionAreaId?: string }, @Req() request: Request) {
    const employee = await currentEmployee(this.prisma, request);
    await this.costs.completeProcurementRoute(id, kind, employee, body.attested === true, mutationMeta(request), undefined, body.productionAreaId);
    return this.orders.detail(id, employee);
  }
}
