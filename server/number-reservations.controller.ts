import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { currentEmployee } from "./auth.js";
import { BUSINESS_TYPES, type BusinessType } from "./domain/types.js";
import { PrismaService } from "./prisma.service.js";
import { OrderNumberAllocator } from "./number-allocator.service.js";
import { mutationMeta, runMutation } from "./mutations.js";

@Controller("api/v1/admin/number-reservations")
export class NumberReservationsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(OrderNumberAllocator) private readonly allocator: OrderNumberAllocator) {}
  private async actor(request: Request) {
    const employee = await currentEmployee(this.prisma, request);
    if (!["CHAIRMAN", "ORDER_ADMIN"].includes(employee.role)) throw new ForbiddenException("仅订单管理员或董事长可预留旧流程编号");
    return employee;
  }
  @Get()
  async list(@Req() request: Request) {
    await this.actor(request);
    return this.prisma.securityAudit.findMany({ where: { action: "LEGACY_NUMBER_RESERVED" }, orderBy: { createdAt: "desc" }, take: 100 });
  }
  @Post()
  async reserve(@Req() request: Request, @Body() body: { businessType: BusinessType; reason: string }) {
    const actor = await this.actor(request);
    if (!BUSINESS_TYPES.includes(body.businessType) || typeof body.reason !== "string" || !body.reason.trim() || body.reason.length > 200) throw new BadRequestException("请选择业务分类并填写旧流程登记单号和原因（最多200字）");
    return runMutation(this.prisma, actor.id, "legacy-number-reservation", body, mutationMeta(request), async (tx) => {
      const number = await this.allocator.allocate(tx, body.businessType, new Date());
      await tx.securityAudit.create({ data: { actorId: actor.id, action: "LEGACY_NUMBER_RESERVED", metadata: { number, businessType: body.businessType, reason: body.reason.trim() } } });
      return { number };
    });
  }
}
