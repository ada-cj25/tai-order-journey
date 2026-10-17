import { Body, Controller, Get, Inject, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { currentEmployee, Public } from "./auth.js";
import { miniCapabilities, miniEmployeeView } from "./domain/mini-program-access.js";
import { MiniAuthService } from "./mini-auth.service.js";
import { PrismaService } from "./prisma.service.js";

@Controller("api/v1/mini/auth")
export class MiniAuthController {
  constructor(@Inject(MiniAuthService) private readonly auth: MiniAuthService, @Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Public()
  @Post("bind")
  async bind(@Body() body: { code?: string; inviteCode?: string }, @Req() request: Request) {
    try { await this.auth.throttle(`bind-ip:${request.ip ?? "unknown"}`, 50); return await this.auth.bind(body.code, body.inviteCode); }
    catch (error) { await this.auth.auditFailure("MINI_BIND_FAILED", error); throw error; }
  }

  @Public()
  @Post("login")
  async login(@Body() body: { code?: string }, @Req() request: Request) {
    try { await this.auth.throttle(`login-ip:${request.ip ?? "unknown"}`, 120); return await this.auth.login(body.code); }
    catch (error) { await this.auth.auditFailure("MINI_LOGIN_FAILED", error); throw error; }
  }

  @Public()
  @Post("refresh")
  async refresh(@Body() body: { refreshToken?: string }, @Req() request: Request) {
    try { await this.auth.throttle(`refresh-ip:${request.ip ?? "unknown"}`, 180); return await this.auth.refresh(body.refreshToken); }
    catch (error) { await this.auth.auditFailure("MINI_REFRESH_FAILED", error); throw error; }
  }

  @Post("logout")
  logout(@Req() request: Request) { return this.auth.logout(request.miniSessionId!); }

  @Get("me")
  async me(@Req() request: Request) {
    const employee = await currentEmployee(this.prisma, request);
    return { employee: miniEmployeeView(employee), capabilities: miniCapabilities(employee.role, employee.level) };
  }
}
