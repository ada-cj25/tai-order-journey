import { BadRequestException, ForbiddenException, GoneException, HttpException, Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { Employee } from "./generated/prisma/client.js";
import { orderScope } from "./order-access.js";
import { PrismaService } from "./prisma.service.js";
import { customerDemoEnabled } from "./runtime-config.js";

export const CUSTOMER_STAGES: Record<string, string> = {
  DEPOSIT_PENDING: "签订合同", DESIGN_PENDING: "等待设计", DESIGN_ACCEPTED: "设计中",
  PRE_REVIEW: "设计资料审核", TECHNICAL: "技术拆单", TECH_REVIEW: "技术审核",
  MATERIALS: "生产准备", PRODUCTION: "生产中", INSTALLATION_APPLICATION: "安装安排",
  DELIVERY: "交付中", INSTALLATION: "安装中", ACCEPTANCE: "客户验收",
  BUSINESS_COMPLETE: "已完成",
};

export function assertCustomerDemoEnabled() {
  if (!customerDemoEnabled()) throw new GoneException("客户客服 Demo 仅在隔离的本地测试库开放");
}

function phoneValue(value: unknown) {
  if (typeof value !== "string" || !/^1[3-9]\d{9}$/.test(value)) throw new BadRequestException("请输入有效的大陆手机号");
  return value;
}

function safeText(value: unknown, max = 1000) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new BadRequestException("内容格式无效");
  return value.trim();
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function sameSignature(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function mayApproveCustomerGrant(employee: Pick<Employee, "id" | "role" | "level" | "businessUnit" | "workshop">, order: { id: string; salesId: string | null; creationMode: string; businessType: string }) {
  if (order.creationMode !== "SALES_STANDARD") return false;
  if (employee.role === "CHAIRMAN" || employee.role === "ORDER_ADMIN") return true;
  return employee.role === "SALES" && order.salesId === employee.id && Boolean(orderScope(employee).businessType);
}

@Injectable()
export class CustomerDemoService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private secret() {
    return process.env.CUSTOMER_DEMO_SECRET ?? process.env.SESSION_SECRET ?? "local-development-only";
  }

  async requestCode(phoneInput: unknown) {
    assertCustomerDemoEnabled();
    const phone = phoneValue(phoneInput);
    const now = new Date();
    const existing = await this.prisma.customerOtp.findUnique({ where: { phone } });
    if (existing && now.getTime() - existing.lastSentAt.getTime() < 60_000) throw new HttpException("请稍后再获取验证码", 429);
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const codeHash = signature(phone + ":" + code, this.secret());
    await this.prisma.customerOtp.upsert({
      where: { phone },
      update: { codeHash, expiresAt: new Date(now.getTime() + 5 * 60_000), lastSentAt: now, attempts: 0 },
      create: { phone, codeHash, expiresAt: new Date(now.getTime() + 5 * 60_000), lastSentAt: now },
    });
    // The code is returned only on the isolated loopback demo.
    return { expiresInSeconds: 300, demoCode: code };
  }

  async verifyCode(phoneInput: unknown, codeInput: unknown) {
    assertCustomerDemoEnabled();
    const phone = phoneValue(phoneInput);
    if (typeof codeInput !== "string" || !/^\d{6}$/.test(codeInput)) throw new UnauthorizedException("验证码无效");
    const record = await this.prisma.customerOtp.findUnique({ where: { phone } });
    if (!record || record.expiresAt <= new Date() || record.attempts >= 5) throw new UnauthorizedException("验证码已失效");
    await this.prisma.customerOtp.update({ where: { phone }, data: { attempts: { increment: 1 } } });
    if (!sameSignature(signature(phone + ":" + codeInput, this.secret()), record.codeHash)) throw new UnauthorizedException("验证码无效");
    await this.prisma.customerOtp.delete({ where: { phone } });
    return this.prisma.customerAccount.upsert({ where: { phone }, update: {}, create: { phone } });
  }

  async customer(customerId: string) {
    assertCustomerDemoEnabled();
    const customer = await this.prisma.customerAccount.findUnique({ where: { id: customerId } });
    if (!customer?.active) throw new UnauthorizedException("客户会话已失效");
    return customer;
  }

  async approveGrant(employee: Employee, orderId: string, phoneInput: unknown, reasonInput: unknown) {
    assertCustomerDemoEnabled();
    const phone = phoneValue(phoneInput);
    const reason = safeText(reasonInput, 300);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, ...orderScope(employee) },
      select: { id: true, salesId: true, creationMode: true, businessType: true, customerPhone: true },
    });
    if (!order || !mayApproveCustomerGrant(employee, order)) throw new ForbiddenException("无权绑定此订单");
    if (order.customerPhone !== phone) throw new BadRequestException("手机号与订单预留号码不一致");
    const customer = await this.prisma.customerAccount.findUnique({ where: { phone } });
    if (!customer?.active) throw new NotFoundException("客户尚未完成手机号验证");
    return this.prisma.customerOrderGrant.upsert({
      where: { customerId_orderId: { customerId: customer.id, orderId } },
      update: { approvedById: employee.id, approvedAt: new Date(), revokedAt: null, revokedById: null, reason },
      create: { customerId: customer.id, orderId, approvedById: employee.id, reason },
      select: { id: true, customerId: true, orderId: true, approvedAt: true, revokedAt: true },
    });
  }

  async revokeGrant(employee: Employee, orderId: string, customerId: string) {
    assertCustomerDemoEnabled();
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, ...orderScope(employee) },
      select: { id: true, salesId: true, creationMode: true, businessType: true },
    });
    if (!order || !mayApproveCustomerGrant(employee, order)) throw new ForbiddenException("无权解除此订单绑定");
    const changed = await this.prisma.customerOrderGrant.updateMany({
      where: { customerId, orderId, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: employee.id },
    });
    if (!changed.count) throw new NotFoundException("当前没有可解除的订单绑定");
    return { orderId, customerId, revoked: true };
  }

  async listOrders(customerId: string) {
    const customer = await this.customer(customerId);
    const grants = await this.prisma.customerOrderGrant.findMany({
      where: { customerId, revokedAt: null, order: { creationMode: "SALES_STANDARD", customerPhone: customer.phone } },
      select: { order: { select: { id: true, salesNumber: true, trackingSerial: true, stage: true, updatedAt: true } } },
      orderBy: { approvedAt: "desc" },
    });
    return grants.map(({ order }) => ({
      orderId: order.id, identifier: order.salesNumber ?? order.trackingSerial,
      trackingSerial: order.salesNumber ? order.trackingSerial : null,
      stage: CUSTOMER_STAGES[order.stage], updatedAt: order.updatedAt,
    }));
  }

  async progress(customerId: string, orderId: string) {
    const customer = await this.customer(customerId);
    const grant = await this.prisma.customerOrderGrant.findFirst({
      where: { customerId, orderId, revokedAt: null, order: { creationMode: "SALES_STANDARD", customerPhone: customer.phone } },
      select: { order: { select: {
        id: true, trackingSerial: true, salesNumber: true, businessType: true, stage: true,
        standardDueAt: true, finalAcceptedAt: true, updatedAt: true,
        productionAreas: { where: { cancelledAt: null }, orderBy: { sequence: "asc" }, select: {
          name: true, productionCompletedAt: true, shippedAt: true,
          productionRoutes: { where: { cancelledAt: null }, select: {
            kind: true, releasedAt: true, productionCompletedAt: true, shippedAt: true,
          } },
        } },
        shipments: { orderBy: { deliveredAt: "desc" }, select: {
          kind: true, deliveredAt: true, plannedInstallationAt: true, installedAt: true,
        } },
        aftersales: { orderBy: { createdAt: "desc" }, select: { status: true, createdAt: true, resolvedAt: true } },
      } } },
    });
    if (!grant) throw new NotFoundException("订单不存在或未授权");
    const order = grant.order;
    return {
      orderId: order.id,
      identifier: order.salesNumber ?? order.trackingSerial,
      trackingSerial: order.salesNumber ? order.trackingSerial : null,
      stage: CUSTOMER_STAGES[order.stage],
      customerDueDate: order.standardDueAt.toISOString().slice(0, 10),
      finalAcceptedDate: order.finalAcceptedAt?.toISOString().slice(0, 10) ?? null,
      areas: order.productionAreas.map((area) => ({
        name: area.name,
        productionCompleted: Boolean(area.productionCompletedAt),
        shipped: Boolean(area.shippedAt),
        routes: area.productionRoutes.map((route) => ({
          kind: route.kind === "PANEL" ? "板式" : "实木油漆",
          released: Boolean(route.releasedAt),
          completed: Boolean(route.productionCompletedAt),
          shipped: Boolean(route.shippedAt),
        })),
      })),
      shipments: order.shipments.map((shipment) => ({
        kind: shipment.kind, deliveredDate: shipment.deliveredAt.toISOString().slice(0, 10),
        plannedInstallationDate: shipment.plannedInstallationAt?.toISOString().slice(0, 10) ?? null,
        installedDate: shipment.installedAt?.toISOString().slice(0, 10) ?? null,
      })),
      aftersales: order.aftersales.map((caseItem) => ({
        status: caseItem.status, openedDate: caseItem.createdAt.toISOString().slice(0, 10),
        resolvedDate: caseItem.resolvedAt?.toISOString().slice(0, 10) ?? null,
      })),
      queriedAt: new Date().toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }

  serviceToken(customerId: string) {
    const payload = Buffer.from(JSON.stringify({ customerId, exp: Date.now() + 60_000 })).toString("base64url");
    return payload + "." + signature(payload, this.secret());
  }

  verifyServiceToken(token: unknown) {
    assertCustomerDemoEnabled();
    if (typeof token !== "string" || token.length > 1000) throw new UnauthorizedException("服务凭证无效");
    const [payload, mac] = token.split(".");
    if (!payload || !mac || !sameSignature(signature(payload, this.secret()), mac)) throw new UnauthorizedException("服务凭证无效");
    try {
      const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { customerId?: string; exp?: number };
      if (typeof data.customerId !== "string" || !data.customerId || typeof data.exp !== "number" || data.exp < Date.now()) throw new Error();
      return data.customerId;
    } catch { throw new UnauthorizedException("服务凭证无效"); }
  }

  async createSupport(customerId: string, input: { orderId?: string; question?: string; reason?: string; idempotencyKey?: string; verifiedSummary?: string }) {
    await this.customer(customerId);
    const question = safeText(input.question, 2000);
    const reason = safeText(input.reason, 300);
    const idempotencyKey = safeText(input.idempotencyKey, 100);
    if (input.orderId) await this.progress(customerId, input.orderId);
    return this.prisma.customerSupportRequest.upsert({
      where: { customerId_idempotencyKey: { customerId, idempotencyKey } },
      update: {},
      create: { customerId, orderId: input.orderId, question, reason, idempotencyKey, verifiedSummary: typeof input.verifiedSummary === "string" ? input.verifiedSummary.slice(0, 2000) : null },
      select: { id: true, status: true, createdAt: true },
    });
  }
}
