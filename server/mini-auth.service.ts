import { BadRequestException, ConflictException, ForbiddenException, GoneException, HttpException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, createHmac, randomBytes } from "node:crypto";
import type { Prisma } from "./generated/prisma/client.js";
import { isMiniProgramRole, miniEmployeeView } from "./domain/mini-program-access.js";
import { PrismaService } from "./prisma.service.js";
import { localTestAccountsEnabled } from "./runtime-config.js";

type Db = PrismaService | Prisma.TransactionClient;
type TokenPair = { accessToken: string; refreshToken: string; accessExpiresAt: Date; refreshExpiresAt: Date };

export function miniProgramEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.MINI_PROGRAM_ENABLED === "true";
}

export function miniProgramDevLoginEnabled(env: NodeJS.ProcessEnv = process.env) {
  return miniProgramEnabled(env) && env.MINI_PROGRAM_DEV_LOGIN_ENABLED === "true" && localTestAccountsEnabled(env);
}

export function tokenHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function validToken(value: unknown) {
  if (typeof value !== "string" || value.length < 24 || value.length > 256) throw new BadRequestException("移动登录凭证格式无效");
  return value;
}

@Injectable()
export class MiniAuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private assertEnabled() {
    if (!miniProgramEnabled()) throw new GoneException("小程序生产接入尚未开放");
  }

  private appId() {
    const appId = process.env.WECHAT_MINI_APP_ID ?? (process.env.NODE_ENV === "production" ? "" : "local-test-appid");
    if (!appId) throw new GoneException("小程序 AppID 尚未配置");
    return appId;
  }

  private openIdHash(openId: string) {
    const secret = process.env.WECHAT_OPENID_HASH_SECRET ?? process.env.SESSION_SECRET ?? "local-mini-openid-hash";
    if (process.env.NODE_ENV === "production" && secret.length < 32) throw new GoneException("微信身份哈希密钥尚未安全配置");
    return createHmac("sha256", secret).update(`${this.appId()}:${openId}`).digest("hex");
  }

  private async resolveOpenId(codeInput: unknown) {
    this.assertEnabled();
    const code = validToken(codeInput);
    if (code.startsWith("TEST-WX-")) {
      if (!miniProgramDevLoginEnabled()) throw new UnauthorizedException("模拟微信身份仅限本地测试环境");
      return this.openIdHash(code);
    }
    const secret = process.env.WECHAT_MINI_APP_SECRET;
    if (!secret) throw new GoneException("微信小程序密钥尚未配置");
    const query = new URLSearchParams({ appid: this.appId(), secret, js_code: code, grant_type: "authorization_code" });
    const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${query.toString()}`);
    const body = await response.json() as { openid?: string; errcode?: number; errmsg?: string };
    if (!response.ok || !body.openid || body.errcode) throw new UnauthorizedException("微信登录凭证无效或已过期");
    return this.openIdHash(body.openid);
  }

  private pair(now = new Date()): TokenPair {
    return {
      accessToken: randomBytes(32).toString("base64url"),
      refreshToken: randomBytes(40).toString("base64url"),
      accessExpiresAt: new Date(now.getTime() + 2 * 60 * 60_000),
      refreshExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    };
  }

  private async createSession(db: Db, binding: { id: string; employeeId: string }, employee: { sessionVersion: number }, now = new Date()) {
    const pair = this.pair(now);
    const session = await db.miniProgramSession.create({ data: {
      bindingId: binding.id,
      employeeId: binding.employeeId,
      accessTokenHash: tokenHash(pair.accessToken),
      refreshTokenHash: tokenHash(pair.refreshToken),
      sessionVersion: employee.sessionVersion,
      accessExpiresAt: pair.accessExpiresAt,
      refreshExpiresAt: pair.refreshExpiresAt,
    } });
    return { session, pair };
  }

  async bind(code: unknown, inviteCodeInput: unknown) {
    const inviteCode = validToken(inviteCodeInput);
    const openIdHash = await this.resolveOpenId(code);
    const appId = this.appId();
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mini-bind:${tokenHash(inviteCode)}`}))`;
      const invite = await tx.miniProgramInvite.findUnique({ where: { tokenHash: tokenHash(inviteCode) }, include: { employee: true } });
      if (!invite || invite.usedAt || invite.revokedAt || invite.expiresAt <= now) throw new UnauthorizedException("邀请码无效、已使用或已过期");
      if (!invite.employee.active || invite.employee.mustChangePassword || !isMiniProgramRole(invite.employee.role)) throw new ForbiddenException("对应员工账号未启用、未修改初始密码或岗位未开放小程序");
      const [openidBinding, employeeBinding] = await Promise.all([
        tx.miniProgramBinding.findUnique({ where: { appId_openIdHash: { appId, openIdHash } } }),
        tx.miniProgramBinding.findUnique({ where: { appId_employeeId: { appId, employeeId: invite.employeeId } } }),
      ]);
      if (openidBinding && openidBinding.employeeId !== invite.employeeId) throw new ConflictException("当前微信已绑定其他员工，请联系管理员");
      if (employeeBinding && employeeBinding.openIdHash !== openIdHash && !employeeBinding.revokedAt) throw new ConflictException("该员工已绑定其他微信，请先由管理员解除绑定");
      const binding = employeeBinding
        ? await tx.miniProgramBinding.update({ where: { id: employeeBinding.id }, data: { openIdHash, inviteId: invite.id, boundAt: now, revokedAt: null } })
        : await tx.miniProgramBinding.create({ data: { appId, openIdHash, employeeId: invite.employeeId, inviteId: invite.id } });
      await tx.miniProgramInvite.update({ where: { id: invite.id }, data: { usedAt: now } });
      const { pair } = await this.createSession(tx, binding, invite.employee, now);
      await tx.securityAudit.create({ data: { actorId: invite.employeeId, targetId: invite.employeeId, action: "MINI_PROGRAM_BOUND", metadata: { inviteId: invite.id, bindingId: binding.id } } });
      return this.result(invite.employee, pair);
    });
  }

  async login(code: unknown) {
    const openIdHash = await this.resolveOpenId(code);
    const binding = await this.prisma.miniProgramBinding.findUnique({ where: { appId_openIdHash: { appId: this.appId(), openIdHash } }, include: { employee: true } });
    if (!binding || binding.revokedAt) throw new UnauthorizedException("当前微信尚未绑定员工账号");
    if (!binding.employee.active || binding.employee.mustChangePassword || !isMiniProgramRole(binding.employee.role)) throw new UnauthorizedException("员工账号或小程序权限已失效");
    const { pair } = await this.createSession(this.prisma, binding, binding.employee);
    await this.prisma.securityAudit.create({ data: { actorId: binding.employeeId, action: "MINI_LOGIN_SUCCESS", metadata: { bindingId: binding.id } } });
    return this.result(binding.employee, pair);
  }

  async refresh(refreshTokenInput: unknown) {
    this.assertEnabled();
    const refreshToken = validToken(refreshTokenInput);
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.miniProgramSession.findUnique({ where: { refreshTokenHash: tokenHash(refreshToken) }, include: { employee: true, binding: true } });
      if (!current || current.revokedAt || current.refreshExpiresAt <= now || current.binding.revokedAt || !current.employee.active || current.employee.mustChangePassword || current.sessionVersion !== current.employee.sessionVersion || !isMiniProgramRole(current.employee.role)) throw new UnauthorizedException("移动会话已失效，请重新登录");
      await tx.miniProgramSession.update({ where: { id: current.id }, data: { revokedAt: now } });
      const { pair } = await this.createSession(tx, current.binding, current.employee, now);
      return this.result(current.employee, pair);
    });
  }

  async authenticate(accessTokenInput: unknown) {
    this.assertEnabled();
    const accessToken = validToken(accessTokenInput);
    const now = new Date();
    const session = await this.prisma.miniProgramSession.findUnique({ where: { accessTokenHash: tokenHash(accessToken) }, include: { employee: true, binding: true } });
    if (!session || session.revokedAt || session.accessExpiresAt <= now || session.binding.revokedAt || !session.employee.active || session.employee.mustChangePassword || session.sessionVersion !== session.employee.sessionVersion || !isMiniProgramRole(session.employee.role)) throw new UnauthorizedException("移动会话已过期或权限已变更");
    return session;
  }

  async logout(sessionId: string) {
    const session = await this.prisma.miniProgramSession.findUnique({ where: { id: sessionId }, select: { employeeId: true, bindingId: true } });
    await this.prisma.$transaction(async (tx) => {
      await tx.miniProgramSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
      if (session) await tx.securityAudit.create({ data: { actorId: session.employeeId, action: "MINI_LOGOUT", metadata: { bindingId: session.bindingId, sessionId } } });
    });
    return { ok: true };
  }

  async auditFailure(action: "MINI_BIND_FAILED" | "MINI_LOGIN_FAILED" | "MINI_REFRESH_FAILED", error: unknown) {
    const reason = error instanceof Error ? error.constructor.name : "UnknownError";
    await this.prisma.securityAudit.create({ data: { action, metadata: { reason } } }).catch(() => undefined);
  }

  async throttle(value: string, limit: number) {
    const key = tokenHash(`mini:${value}`);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60_000);
    const rows = await this.prisma.$queryRaw<Array<{ attempts: number }>>`
      INSERT INTO "LoginAttempt" ("key", "attempts", "expiresAt") VALUES (${key}, 1, ${expiresAt})
      ON CONFLICT ("key") DO UPDATE SET
        "attempts" = CASE WHEN "LoginAttempt"."expiresAt" <= ${now} THEN 1 ELSE "LoginAttempt"."attempts" + 1 END,
        "expiresAt" = CASE WHEN "LoginAttempt"."expiresAt" <= ${now} THEN ${expiresAt} ELSE "LoginAttempt"."expiresAt" END
      RETURNING "attempts"`;
    if (rows[0].attempts > limit) throw new HttpException("登录尝试过多，请15分钟后重试", 429);
  }

  private result(employee: Parameters<typeof miniEmployeeView>[0] & { sessionVersion: number }, pair: TokenPair) {
    return { employee: miniEmployeeView(employee), accessToken: pair.accessToken, refreshToken: pair.refreshToken, accessExpiresAt: pair.accessExpiresAt, refreshExpiresAt: pair.refreshExpiresAt };
  }
}
