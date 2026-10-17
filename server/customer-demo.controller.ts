import { BadGatewayException, BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Param, Post, Query, Req, Res, ServiceUnavailableException } from "@nestjs/common";
import type { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { Public, currentEmployee } from "./auth.js";
import { CustomerDemoService, assertCustomerDemoEnabled } from "./customer-demo.service.js";
import { PrismaService } from "./prisma.service.js";

function customerId(request: Request) {
  if (!request.session.customerId) throw new ForbiddenException("请先登录客户账户");
  return request.session.customerId;
}

@Controller("api/v1/customer")
export class CustomerDemoController {
  constructor(@Inject(CustomerDemoService) private readonly service: CustomerDemoService) {}

  @Public()
  @Post("otp/request")
  requestCode(@Body() body: { phone?: string }) {
    return this.service.requestCode(body.phone);
  }

  @Public()
  @Post("otp/verify")
  async verifyCode(@Body() body: { phone?: string; code?: string }, @Req() request: Request) {
    const customer = await this.service.verifyCode(body.phone, body.code);
    await new Promise<void>((resolve, reject) => request.session.regenerate((error) => error ? reject(error) : resolve()));
    request.session.customerId = customer.id;
    request.session.customerSessionVersion = customer.sessionVersion;
    request.session.csrfToken = randomBytes(24).toString("hex");
    return { customer: { id: customer.id, phone: customer.phone }, csrfToken: request.session.csrfToken };
  }

  @Get("me")
  async me(@Req() request: Request) {
    const customer = await this.service.customer(customerId(request));
    return { customer: { id: customer.id, phone: customer.phone }, csrfToken: request.session.csrfToken };
  }

  @Post("logout")
  async logout(@Req() request: Request) {
    await new Promise<void>((resolve) => request.session.destroy(() => resolve()));
    return { ok: true };
  }

  @Get("orders")
  orders(@Req() request: Request) {
    return this.service.listOrders(customerId(request));
  }

  @Get("orders/:id")
  order(@Req() request: Request, @Param("id") id: string) {
    return this.service.progress(customerId(request), id);
  }

  @Post("support")
  support(@Req() request: Request, @Body() body: { orderId?: string; question?: string; reason?: string; idempotencyKey?: string }) {
    return this.service.createSupport(customerId(request), body);
  }

  @Get("support")
  async supportList(@Req() request: Request) {
    const id = customerId(request);
    await this.service.customer(id);
    // Re-check order grants before exposing any historical order-linked content.
    const requests = await this.prisma.customerSupportRequest.findMany({
      where: { customerId: id },
      include: { replies: { select: { id: true, body: true, createdAt: true }, orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
    const visible = [];
    for (const item of requests) {
      if (item.orderId) {
        try { await this.service.progress(id, item.orderId); } catch { continue; }
      }
      visible.push({ id: item.id, orderId: item.orderId, question: item.question, reason: item.reason, status: item.status, createdAt: item.createdAt, replies: item.replies });
    }
    return visible;
  }

  @Inject(PrismaService) private readonly prisma!: PrismaService;

  @Get("runtime")
  async runtime(@Req() request: Request) {
    const id = customerId(request);
    await this.service.customer(id);
    const url = new URL(process.env.CUSTOMER_AGENT_URL ?? "http://127.0.0.1:8042");
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.protocol !== "http:") throw new ServiceUnavailableException("本地 Agent 地址无效");
    try {
      const response = await fetch(new URL("/runtime", url), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceToken: this.service.serviceToken(id) }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("Agent unavailable");
      return await response.json();
    } catch { throw new BadGatewayException("Agent 运行状态暂不可用"); }
  }

  @Post("chat")
  async chat(@Req() request: Request, @Body() body: { question?: string; threadId?: string }) {
    const id = customerId(request);
    await this.service.customer(id);
    if (typeof body.question !== "string" || !body.question.trim() || body.question.length > 2000) throw new BadRequestException("问题格式无效");
    if (body.threadId !== undefined && (typeof body.threadId !== "string" || !/^[a-f0-9-]{36}$/.test(body.threadId))) throw new BadRequestException("会话标识无效");
    const agentUrl = process.env.CUSTOMER_AGENT_URL ?? "http://127.0.0.1:8042";
    const url = new URL(agentUrl);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.protocol !== "http:") throw new ServiceUnavailableException("本地 Agent 地址无效");
    try {
      const response = await fetch(new URL("/run", url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: body.question.trim(), threadId: body.threadId, serviceToken: this.service.serviceToken(id) }),
        signal: AbortSignal.timeout(65_000),
      });
      if (!response.ok) throw new Error("Agent failed");
      return await response.json();
    } catch { throw new BadGatewayException("客服暂时无法回答，可提交人工请求"); }
  }

  @Post("chat/stream")
  async chatStream(@Req() request: Request, @Res() output: Response, @Body() body: { question?: string; threadId?: string }) {
    const id = customerId(request);
    await this.service.customer(id);
    if (typeof body.question !== "string" || !body.question.trim() || body.question.length > 2000) throw new BadRequestException("问题格式无效");
    if (body.threadId !== undefined && (typeof body.threadId !== "string" || !/^[a-f0-9-]{36}$/.test(body.threadId))) throw new BadRequestException("会话标识无效");
    const agentUrl = process.env.CUSTOMER_AGENT_URL ?? "http://127.0.0.1:8042";
    const url = new URL(agentUrl);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.protocol !== "http:") throw new ServiceUnavailableException("本地 Agent 地址无效");
    let response: globalThis.Response;
    try {
      response = await fetch(new URL("/stream", url), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: body.question.trim(), threadId: body.threadId, serviceToken: this.service.serviceToken(id) }),
        signal: AbortSignal.timeout(65_000),
      });
      if (!response.ok || !response.body) throw new Error("Agent stream failed");
    } catch { throw new BadGatewayException("客服暂时无法回答，可提交人工请求"); }
    output.status(200).set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
    output.flushHeaders();
    try {
      const reader = response.body.getReader();
      while (true) {
        const part = await reader.read();
        if (part.done || output.destroyed) break;
        output.write(Buffer.from(part.value));
      }
    } catch {
      output.write('data: {"type":"error","message":"客服连接中断，可提交人工请求"}\n\n');
    } finally { output.end(); }
  }
}

@Controller("api/v1/customer-internal")
export class CustomerDemoInternalController {
  constructor(@Inject(CustomerDemoService) private readonly service: CustomerDemoService) {}

  @Public()
  @Get("orders")
  list(@Req() request: Request) {
    return this.service.listOrders(this.service.verifyServiceToken(request.header("x-customer-service-token")));
  }

  @Public()
  @Get("orders/:id")
  progress(@Req() request: Request, @Param("id") id: string) {
    return this.service.progress(this.service.verifyServiceToken(request.header("x-customer-service-token")), id);
  }

  @Public()
  @Post("support")
  support(@Req() request: Request, @Body() body: { orderId?: string; question?: string; reason?: string; idempotencyKey?: string; verifiedSummary?: string }) {
    return this.service.createSupport(this.service.verifyServiceToken(request.header("x-customer-service-token")), body);
  }
}

@Controller("api/v1/customer-admin")
export class CustomerDemoAdminController {
  constructor(@Inject(CustomerDemoService) private readonly service: CustomerDemoService, @Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Post("orders/:id/grants")
  async grant(@Req() request: Request, @Param("id") id: string, @Body() body: { phone?: string; reason?: string }) {
    return this.service.approveGrant(await currentEmployee(this.prisma, request), id, body.phone, body.reason);
  }

  @Post("orders/:id/grants/:customerId/revoke")
  async revoke(@Req() request: Request, @Param("id") id: string, @Param("customerId") boundCustomerId: string) {
    return this.service.revokeGrant(await currentEmployee(this.prisma, request), id, boundCustomerId);
  }

  @Get("support")
  async support(@Req() request: Request, @Query("status") status?: string) {
    assertCustomerDemoEnabled();
    const employee = await currentEmployee(this.prisma, request);
    if (!["ORDER_ADMIN", "CHAIRMAN"].includes(employee.role)) throw new ForbiddenException("无权查看客服待办");
    return this.prisma.customerSupportRequest.findMany({
      where: { status: status === "CLOSED" ? "CLOSED" : "OPEN" },
      select: { id: true, question: true, reason: true, status: true, orderId: true, createdAt: true, replies: { select: { id: true, body: true, createdAt: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  @Post("support/:id/replies")
  async reply(@Req() request: Request, @Param("id") id: string, @Body() body: { text?: string }) {
    assertCustomerDemoEnabled();
    const employee = await currentEmployee(this.prisma, request);
    if (!["ORDER_ADMIN", "CHAIRMAN"].includes(employee.role)) throw new ForbiddenException("无权处理客服待办");
    if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 2000) throw new BadRequestException("回复内容无效");
    return this.prisma.customerSupportReply.create({ data: { requestId: id, employeeId: employee.id, body: body.text.trim() }, select: { id: true, body: true, createdAt: true } });
  }

  @Post("support/:id/close")
  async close(@Req() request: Request, @Param("id") id: string) {
    assertCustomerDemoEnabled();
    const employee = await currentEmployee(this.prisma, request);
    if (!["ORDER_ADMIN", "CHAIRMAN"].includes(employee.role)) throw new ForbiddenException("无权处理客服待办");
    return this.prisma.customerSupportRequest.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date() }, select: { id: true, status: true, closedAt: true } });
  }
}
