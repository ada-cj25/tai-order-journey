import { Body, Controller, Get, Inject, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { currentEmployee } from "./auth.js";
import { PaymentAccountService } from "./payment-account.service.js";
import { PrismaService } from "./prisma.service.js";

@Controller("api/v1/payment-accounts")
export class PaymentAccountController {
  constructor(@Inject(PaymentAccountService) private readonly accounts: PaymentAccountService, @Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list(@Req() request: Request) { return this.accounts.list(await currentEmployee(this.prisma, request)); }

  @Post()
  async create(@Body() body: { name?: string }, @Req() request: Request) { return this.accounts.request(body.name, await currentEmployee(this.prisma, request)); }

  @Post(":id/review")
  async review(@Param("id") id: string, @Body() body: { decision?: string; comment?: string }, @Req() request: Request) {
    return this.accounts.review(id, body.decision, body.comment, await currentEmployee(this.prisma, request));
  }
}
