import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Param, Post, Req } from "@nestjs/common";
import { hash } from "bcryptjs";
import type { Request } from "express";
import type { Prisma, Role } from "./generated/prisma/client.js";
import { currentEmployee } from "./auth.js";
import { validateAccount, validatePassword } from "./account-policy.js";
import { PrismaService } from "./prisma.service.js";
import { createHash, randomBytes } from "node:crypto";
import { isMiniProgramRole, MINI_PROGRAM_ROLES } from "./domain/mini-program-access.js";

const publicFields = { id: true, employeeNo: true, username: true, name: true, department: true, role: true, level: true, businessUnit: true, workshop: true, processCode: true, processCodes: true, active: true, mustChangePassword: true, updatedAt: true } as const;

@Controller("api/v1/admin")
export class AccountsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get("employees")
  async list(@Req() request: Request) {
    await this.administrator(request);
    return this.prisma.employee.findMany({ where: { role: { not: "WAREHOUSE" } }, select: publicFields, orderBy: { employeeNo: "asc" } });
  }

  @Get("audit")
  async audit(@Req() request: Request) {
    await this.administrator(request);
    return this.prisma.securityAudit.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  }

  @Post("employees")
  async create(@Body() body: Record<string, unknown>, @Req() request: Request) {
    const actor = await this.administrator(request);
    const input = validateAccount(body);
    validatePassword(body.password);
    const passwordHash = await hash(body.password, 12);
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, actor.id);
      const exists = await tx.employee.findFirst({ where: { OR: [{ username: input.username }, { employeeNo: input.employeeNo }] } });
      if (exists) throw new BadRequestException("员工编号或账号已存在");
      const employee = await tx.employee.create({ data: { ...input, role: input.role as Role, passwordHash, mustChangePassword: true }, select: publicFields });
      await tx.securityAudit.create({ data: { actorId: actor.id, targetId: employee.id, action: "EMPLOYEE_CREATED", metadata: input } });
      return employee;
    });
  }

  @Post("employees/:id")
  async update(@Param("id") id: string, @Body() body: Record<string, unknown>, @Req() request: Request) {
    const actor = await this.administrator(request);
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, actor.id);
      const existing = await tx.employee.findUniqueOrThrow({ where: { id } });
      if (existing.role === "WAREHOUSE") throw new BadRequestException("历史仓库账号只读");
      const input = validateAccount({ ...existing, ...body, ...(body.processCodes === undefined && body.processCode !== undefined ? { processCodes: undefined } : {}) });
      if (body.updatedAt !== existing.updatedAt.toISOString()) throw new BadRequestException("员工资料已变化，请刷新后重试");
      if (existing.role === "CHAIRMAN" && existing.active && (!input.active || input.role !== "CHAIRMAN") && await tx.employee.count({ where: { active: true, role: "CHAIRMAN" } }) <= 1) throw new BadRequestException("必须保留至少一名启用的董事长管理员");
      const duplicate = await tx.employee.findFirst({ where: { id: { not: id }, OR: [{ username: input.username }, { employeeNo: input.employeeNo }] } });
      if (duplicate) throw new BadRequestException("员工编号或账号已存在");
      const employee = await tx.employee.update({ where: { id }, data: { ...input, role: input.role as Role, sessionVersion: { increment: 1 } }, select: publicFields });
      await tx.securityAudit.create({ data: { actorId: actor.id, targetId: id, action: "EMPLOYEE_UPDATED", metadata: input } });
      return employee;
    });
  }

  @Post("employees/:id/reset-password")
  async reset(@Param("id") id: string, @Body() body: { password?: string }, @Req() request: Request) {
    const actor = await this.administrator(request);
    validatePassword(body.password);
    const passwordHash = await hash(body.password, 12);
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, actor.id);
      const employee = await tx.employee.findUniqueOrThrow({ where: { id } });
      if (employee.role === "WAREHOUSE") throw new BadRequestException("历史仓库账号只读");
      await tx.employee.update({ where: { id }, data: { passwordHash, mustChangePassword: true, sessionVersion: { increment: 1 } } });
      await tx.securityAudit.create({ data: { actorId: actor.id, targetId: id, action: "PASSWORD_RESET" } });
    });
    return { ok: true };
  }

  @Get("mini-program/employees")
  async listMiniEmployees(@Req() request: Request) {
    await this.miniAdministrator(request);
    const now = new Date();
    const appId = process.env.WECHAT_MINI_APP_ID ?? (process.env.NODE_ENV === "production" ? "" : "local-test-appid");
    const employees = await this.prisma.employee.findMany({
      where: { role: { in: [...MINI_PROGRAM_ROLES] }, active: true, mustChangePassword: false },
      select: {
        id: true, employeeNo: true, name: true, department: true, role: true, level: true, active: true,
        miniBindings: { where: { appId, revokedAt: null }, select: { boundAt: true }, take: 1 },
        miniInvites: { where: { usedAt: null, revokedAt: null, expiresAt: { gt: now } }, select: { expiresAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { employeeNo: "asc" },
    });
    return employees.map(({ miniBindings, miniInvites, ...employee }) => ({
      ...employee,
      bindingStatus: miniBindings.length ? "BOUND" : miniInvites.length ? "INVITED" : "UNBOUND",
      boundAt: miniBindings[0]?.boundAt ?? null,
      inviteExpiresAt: miniInvites[0]?.expiresAt ?? null,
    }));
  }

  @Post("mini-program/employees/:id/invite")
  async createMiniInvite(@Param("id") id: string, @Req() request: Request) {
    const actor = await this.miniAdministrator(request);
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee?.active || !isMiniProgramRole(employee.role)) throw new BadRequestException("员工账号未启用或岗位未开放小程序");
    if (employee.mustChangePassword) throw new BadRequestException("员工须先在网页端修改初始密码，再绑定小程序");
    const inviteCode = `TAI-${randomBytes(24).toString("base64url")}`;
    const tokenHash = createHash("sha256").update(inviteCode).digest("hex");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60_000);
    const invite = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mini-invite:${id}`}))`;
      await tx.miniProgramInvite.updateMany({ where: { employeeId: id, usedAt: null, revokedAt: null }, data: { revokedAt: now } });
      const created = await tx.miniProgramInvite.create({ data: { employeeId: id, createdById: actor.id, tokenHash, expiresAt } });
      await tx.securityAudit.create({ data: { actorId: actor.id, targetId: id, action: "MINI_INVITE_CREATED", metadata: { inviteId: created.id, expiresAt: expiresAt.toISOString() } } });
      return created;
    });
    return { id: invite.id, employeeId: id, inviteCode, expiresAt };
  }

  @Post("mini-program/employees/:id/unbind")
  async unbindMini(@Param("id") id: string, @Req() request: Request) {
    const actor = await this.miniAdministrator(request);
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const bindings = await tx.miniProgramBinding.findMany({ where: { employeeId: id, revokedAt: null }, select: { id: true } });
      await tx.miniProgramBinding.updateMany({ where: { employeeId: id, revokedAt: null }, data: { revokedAt: now } });
      await tx.miniProgramSession.updateMany({ where: { employeeId: id, revokedAt: null }, data: { revokedAt: now } });
      await tx.miniProgramInvite.updateMany({ where: { employeeId: id, usedAt: null, revokedAt: null }, data: { revokedAt: now } });
      await tx.securityAudit.create({ data: { actorId: actor.id, targetId: id, action: "MINI_BINDING_REVOKED", metadata: { bindingIds: bindings.map((item) => item.id) } } });
      return { ok: true, revokedBindings: bindings.length };
    });
  }

  private async administrator(request: Request) {
    const employee = await currentEmployee(this.prisma, request);
    if (employee.role !== "CHAIRMAN") throw new ForbiddenException("仅董事长管理员可以管理员工账号");
    return employee;
  }

  private async miniAdministrator(request: Request) {
    const employee = await currentEmployee(this.prisma, request);
    if (!['CHAIRMAN', 'ORDER_ADMIN'].includes(employee.role)) throw new ForbiddenException("仅订单管理员或董事长管理员可管理小程序绑定");
    return employee;
  }

  private async lock(tx: Prisma.TransactionClient, actorId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('employee-administration'))`;
    const actor = await tx.employee.findUniqueOrThrow({ where: { id: actorId } });
    if (!actor.active || actor.role !== "CHAIRMAN") throw new ForbiddenException("管理员权限已变化");
  }
}
