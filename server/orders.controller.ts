import { Body, Controller, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import type { OrderCommandType } from "./domain/types.js";
import { currentEmployee } from "./auth.js";
import { OrdersService } from "./orders.service.js";
import { PrismaService } from "./prisma.service.js";
import { mutationMeta } from "./mutations.js";

@Controller("api/v1/orders")
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService, @Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list(@Req() request: Request, @Query() query: Record<string, string | undefined>) {
    return this.orders.list(await currentEmployee(this.prisma, request), query);
  }

  @Post()
  async create(@Req() request: Request, @Body() body: Parameters<OrdersService["create"]>[0]) {
    return this.orders.create(body, await currentEmployee(this.prisma, request), mutationMeta(request));
  }

  @Get(":id")
  async detail(@Param("id") id: string, @Req() request: Request) {
    return this.orders.detail(id, await currentEmployee(this.prisma, request));
  }

  @Get(":id/timeline")
  async timeline(@Param("id") id: string, @Req() request: Request) {
    return this.orders.timeline(id, await currentEmployee(this.prisma, request));
  }

  @Post(":id/commands")
  async command(
    @Param("id") id: string,
    @Req() request: Request,
    @Body() body: { command: OrderCommandType; payload?: Record<string, unknown> },
  ) {
    return this.orders.command(id, body.command, await currentEmployee(this.prisma, request), body.payload, mutationMeta(request));
  }

  @Post(":id/contract-amount")
  async updateContractAmount(
    @Param("id") id: string,
    @Req() request: Request,
    @Body() body: { amount: number },
  ) {
    return this.orders.updateContractAmount(id, body, await currentEmployee(this.prisma, request), mutationMeta(request));
  }

  @Post(":id/exception-commercial-review")
  async reviewExceptionCommercial(
    @Param("id") id: string,
    @Req() request: Request,
    @Body() body: Parameters<OrdersService["reviewExceptionCommercial"]>[1],
  ) {
    return this.orders.reviewExceptionCommercial(id, body, await currentEmployee(this.prisma, request), mutationMeta(request));
  }

  @Post(":id/drafts")
  async saveDraft(
    @Param("id") id: string,
    @Req() request: Request,
    @Body() body: { command: OrderCommandType; payload?: Record<string, unknown> },
  ) {
    return this.orders.saveDraft(id, body.command, await currentEmployee(this.prisma, request), body.payload, mutationMeta(request));
  }

  @Post(":id/technical-submission-set")
  async finalizeTechnicalSet(@Param("id") id: string, @Req() request: Request) {
    return this.orders.finalizeTechnicalSet(id, await currentEmployee(this.prisma, request), mutationMeta(request));
  }

  @Post(":id/technical-packages/bulk-submit")
  async submitTechnicalDrafts(
    @Param("id") id: string,
    @Req() request: Request,
    @Body() body: { productionAreaIds?: string[] },
  ) {
    return this.orders.submitTechnicalDrafts(id, body.productionAreaIds ?? [], await currentEmployee(this.prisma, request), mutationMeta(request));
  }

  @Post(":id/shipments/:shipmentId/complete-installation")
  async completeInstallationBatch(
    @Param("id") id: string,
    @Param("shipmentId") shipmentId: string,
    @Req() request: Request,
    @Body() body: Record<string, unknown>,
  ) {
    return this.orders.completeInstallationBatch(id, shipmentId, await currentEmployee(this.prisma, request), body, mutationMeta(request));
  }
}
