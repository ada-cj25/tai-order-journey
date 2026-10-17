import { Body, Controller, Inject, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { currentEmployee } from "./auth.js";
import { mutationMeta } from "./mutations.js";
import { PrismaService } from "./prisma.service.js";
import { ProductionAreaService } from "./production-area.service.js";

@Controller("api/v1/orders/:orderId/areas")
export class ProductionAreaController {
  constructor(@Inject(ProductionAreaService) private readonly areas: ProductionAreaService, @Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Post()
  async create(@Param("orderId") orderId: string, @Body() body: { name?: string }, @Req() request: Request) {
    return this.areas.create(orderId, body.name, await currentEmployee(this.prisma, request), mutationMeta(request));
  }

  @Post(":areaId/cancel")
  async cancel(@Param("orderId") orderId: string, @Param("areaId") areaId: string, @Body() body: { reason?: string }, @Req() request: Request) {
    return this.areas.cancel(orderId, areaId, body.reason, await currentEmployee(this.prisma, request), mutationMeta(request));
  }
}
