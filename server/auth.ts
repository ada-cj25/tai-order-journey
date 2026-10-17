import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Inject,
  Post,
  Req,
  Res,
  SetMetadata,
  UnauthorizedException,
  ForbiddenException,
  Body,
  HttpException,
  BadRequestException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { compare, hash, hashSync } from "bcryptjs";
import { randomBytes, createHash } from "node:crypto";
import type { Request, Response } from "express";
import { PrismaService } from "./prisma.service.js";
import { costEnabled } from "./runtime-config.js";
import { validatePassword } from "./account-policy.js";
import { MiniAuthService } from "./mini-auth.service.js";

const dummyHash = hashSync(randomBytes(32).toString("hex"), 12);

declare module "express-session" {
  interface SessionData {
    employeeId?: string;
    customerId?: string;
    customerSessionVersion?: number;
    csrfToken?: string;
    sessionVersion?: number;
    client?: "desktop" | "mobile-readonly";
  }
}

declare global {
  namespace Express {
    interface Request {
      miniEmployeeId?: string;
      miniSessionId?: string;
    }
  }
}

export const Public = () => SetMetadata("public", true);

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MiniAuthService) private readonly miniAuth: MiniAuthService,
  ) {}

  async canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>("public", [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<Request>();
    const normalizedPath = request.path.replace(/\/$/, "");
    if (normalizedPath.startsWith("/api/v1/mini/")) {
      const authorization = request.header("authorization") ?? "";
      const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
      if (!token) throw new UnauthorizedException("请先登录小程序");
      const session = await this.miniAuth.authenticate(token);
      request.miniEmployeeId = session.employeeId;
      request.miniSessionId = session.id;
      return true;
    }
    if (normalizedPath.startsWith("/api/v1/customer/")) {
      if (!request.session.customerId) throw new UnauthorizedException("请先登录客户账户");
      const customer = await this.prisma.customerAccount.findUnique({ where: { id: request.session.customerId }, select: { active: true, sessionVersion: true } });
      if (!customer?.active || customer.sessionVersion !== request.session.customerSessionVersion) throw new UnauthorizedException("客户会话已失效");
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.header("x-csrf-token") !== request.session.csrfToken) throw new ForbiddenException("CSRF 校验失败");
      return true;
    }
    if (!request.session.employeeId) throw new UnauthorizedException("请先登录");
    const employee = await this.prisma.employee.findUnique({ where: { id: request.session.employeeId }, select: { active: true, role: true, sessionVersion: true, mustChangePassword: true } });
    if (!employee?.active || employee.role === "WAREHOUSE" || employee.sessionVersion !== (request.session.sessionVersion ?? 0)) throw new UnauthorizedException("账号或会话已失效，请重新登录");
    const allowedDuringPasswordChange = ["/api/v1/auth/me", "/api/v1/auth/password", "/api/v1/auth/logout"];
    if (employee.mustChangePassword && !allowedDuringPasswordChange.includes(normalizedPath)) throw new ForbiddenException("请先修改初始密码");
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      if (request.session.client === "mobile-readonly" && !["/api/v1/auth/password", "/api/v1/auth/logout"].includes(normalizedPath)) {
        throw new ForbiddenException("手机查看模式为只读会话，请在电脑端办理业务");
      }
      const supplied = request.header("x-csrf-token");
      if (!supplied || supplied !== request.session.csrfToken) throw new ForbiddenException("CSRF 校验失败");
    }
    return true;
  }
}

@Controller("api/v1/auth")
export class AuthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Public()
  @Post("login")
  async login(@Body() body: { username?: string; password?: string; client?: string }, @Req() request: Request) {
    if (typeof body.username !== "string" || typeof body.password !== "string" || body.username.length > 80 || body.password.length > 256) throw new BadRequestException("账号或密码格式无效");
    if (body.client !== undefined && !["desktop", "mobile-readonly"].includes(body.client)) throw new BadRequestException("登录端类型无效");
    await this.throttle(`ip:${request.ip ?? "unknown"}`, 120);
    await this.throttle(`user:${body.username.trim()}`, 10);
    const employee = await this.prisma.employee.findUnique({ where: { username: body.username.trim() } });
    const matches = await compare(body.password, employee?.passwordHash ?? dummyHash);
    if (!employee || !employee.active || employee.role === "WAREHOUSE" || !matches) {
      throw new UnauthorizedException("账号或密码错误");
    }
    await new Promise<void>((resolve, reject) => request.session.regenerate((error) => (error ? reject(error) : resolve())));
    request.session.employeeId = employee.id;
    request.session.csrfToken = randomBytes(24).toString("hex");
    request.session.sessionVersion = employee.sessionVersion;
    request.session.client = body.client === "mobile-readonly" ? "mobile-readonly" : "desktop";
    await this.prisma.securityAudit.create({ data: { actorId: employee.id, action: "LOGIN_SUCCESS" } });
    return { employee: this.safeEmployee(employee, request.session.client), csrfToken: request.session.csrfToken };
  }

  @Post("logout")
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await new Promise<void>((resolve) => request.session.destroy(() => resolve()));
    response.clearCookie("erp.sid");
    return { ok: true };
  }

  @Get("me")
  async me(@Req() request: Request) {
    const employee = await this.prisma.employee.findUniqueOrThrow({ where: { id: request.session.employeeId } });
    return { employee: this.safeEmployee(employee, request.session.client ?? "desktop"), csrfToken: request.session.csrfToken };
  }

  @Get("employees")
  async employees() {
    return this.prisma.employee.findMany({
      where: { active: true, role: { not: "WAREHOUSE" } },
      select: { id: true, employeeNo: true, name: true, department: true, role: true, level: true, businessUnit: true, workshop: true, processCode: true, processCodes: true },
      orderBy: [{ department: "asc" }, { employeeNo: "asc" }],
    });
  }

  @Post("password")
  async changePassword(@Body() body: { currentPassword?: string; newPassword?: string }, @Req() request: Request) {
    validatePassword(body.newPassword);
    const employee = await currentEmployee(this.prisma, request);
    if (typeof body.currentPassword !== "string" || !(await compare(body.currentPassword, employee.passwordHash))) throw new BadRequestException("当前密码不正确");
    if (await compare(body.newPassword, employee.passwordHash)) throw new BadRequestException("新密码不能与当前密码相同");
    const passwordHash = await hash(body.newPassword, 12);
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.employee.updateMany({ where: { id: employee.id, passwordHash: employee.passwordHash, sessionVersion: employee.sessionVersion }, data: { passwordHash, mustChangePassword: false, sessionVersion: { increment: 1 } } });
      if (changed.count !== 1) throw new UnauthorizedException("账号已变更，请重新登录");
      await tx.securityAudit.create({ data: { actorId: employee.id, targetId: employee.id, action: "PASSWORD_CHANGED" } });
    });
    await new Promise<void>((resolve, reject) => request.session.destroy((error) => error ? reject(error) : resolve()));
    return { ok: true, loginRequired: true };
  }

  private async throttle(value: string, limit: number) {
    const key = createHash("sha256").update(value).digest("hex");
    const now = new Date();
    const expires = new Date(now.getTime() + 15 * 60_000);
    const rows = await this.prisma.$queryRaw<Array<{ attempts: number }>>`
      INSERT INTO "LoginAttempt" ("key", "attempts", "expiresAt") VALUES (${key}, 1, ${expires})
      ON CONFLICT ("key") DO UPDATE SET
        "attempts" = CASE WHEN "LoginAttempt"."expiresAt" <= ${now} THEN 1 ELSE "LoginAttempt"."attempts" + 1 END,
        "expiresAt" = CASE WHEN "LoginAttempt"."expiresAt" <= ${now} THEN ${expires} ELSE "LoginAttempt"."expiresAt" END
      RETURNING "attempts"`;
    if (rows[0].attempts > limit) throw new HttpException("登录尝试过多，请15分钟后重试", 429);
  }

  private safeEmployee(employee: { id: string; employeeNo: string; username: string; name: string; department: string; role: string; level?: string; businessUnit?: string | null; workshop?: string | null; processCode?: string | null; processCodes: string[]; mustChangePassword?: boolean }, sessionClient: "desktop" | "mobile-readonly") {
    return {
      id: employee.id,
      employeeNo: employee.employeeNo,
      username: employee.username,
      name: employee.name,
      department: employee.department,
      role: employee.role,
      level: employee.level ?? "STAFF",
      businessUnit: employee.businessUnit ?? null,
      workshop: employee.workshop ?? null,
      processCode: employee.processCode ?? null,
      processCodes: employee.processCodes,
      mustChangePassword: employee.mustChangePassword ?? false,
      costModuleEnabled: costEnabled(),
      environment: process.env.APP_ENVIRONMENT === "company-test" ? "company-test" : process.env.NODE_ENV ?? "development",
      sessionClient,
    };
  }
}

export async function currentEmployee(prisma: PrismaService, request: Request) {
  const employeeId = request.miniEmployeeId ?? request.session.employeeId;
  if (!employeeId) throw new UnauthorizedException();
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee?.active || employee.role === "WAREHOUSE" || (!request.miniEmployeeId && employee.sessionVersion !== (request.session.sessionVersion ?? 0))) throw new UnauthorizedException("账号或会话已失效");
  return employee;
}
