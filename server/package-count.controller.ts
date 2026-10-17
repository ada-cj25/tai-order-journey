import { Body, Controller, Get, Inject, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { currentEmployee } from "./auth.js";
import { mutationMeta } from "./mutations.js";
import { PackageCountService } from "./package-count.service.js";
import { PrismaService } from "./prisma.service.js";

@Controller("api/v1/orders/:orderId/package-counts")
export class PackageCountController {
  constructor(@Inject(PackageCountService) private readonly counts: PackageCountService, @Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async summary(@Param("orderId") orderId: string, @Req() request: Request) {
    return this.counts.projection(orderId, await currentEmployee(this.prisma, request));
  }

  @Post("hardware/bulk-finalize")
  async bulkFinalizeHardware(@Param("orderId") orderId: string, @Body() body: { areas?: Array<{ productionAreaId?: string; total?: number }> }, @Req() request: Request) {
    return this.counts.bulkFinalizeHardware(orderId, body, await currentEmployee(this.prisma, request), mutationMeta(request));
  }

  @Post(":sourceKey/commands")
  async command(@Param("orderId") orderId: string, @Param("sourceKey") sourceKey: string, @Body() body: { command: "ADD_COUNT" | "FINALIZE_SOURCE" | "CONFIRM_HARDWARE_HANDOFF" | "REOPEN_SOURCE" | "VOID_ENTRY"; quantity?: number; entryId?: string; reason?: string }, @Req() request: Request) {
    return this.counts.command(orderId, sourceKey, body, await currentEmployee(this.prisma, request), mutationMeta(request));
  }
}
