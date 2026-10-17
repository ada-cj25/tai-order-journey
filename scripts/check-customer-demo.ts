import "dotenv/config";
import assert from "node:assert/strict";
import { customerDemoEnabled } from "../server/runtime-config.js";

if (!customerDemoEnabled()) throw new Error("客服验收脚本仅可在本机独立测试库运行");
assert.equal(customerDemoEnabled({ ...process.env, NODE_ENV: "production" }), false);
assert.equal(customerDemoEnabled({ ...process.env, APP_ENVIRONMENT: "company-test" }), false);
assert.equal(customerDemoEnabled({ ...process.env, DATABASE_URL: "postgresql://127.0.0.1/whole_house_erp" }), false);
const base = "http://127.0.0.1:3100";

type Client = { cookie: string; csrf: string };
async function request(path: string, method = "GET", body?: object, client?: Client) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(client?.cookie ? { Cookie: client.cookie } : {}),
      ...(client?.csrf && method !== "GET" ? { "x-csrf-token": client.csrf } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(70_000),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
}

async function customer(phone: string): Promise<Client> {
  const otp = await request("/api/v1/customer/otp/request", "POST", { phone });
  assert.equal(otp.status, 201);
  const verified = await request("/api/v1/customer/otp/verify", "POST", { phone, code: otp.data.demoCode });
  assert.equal(verified.status, 201);
  assert(verified.cookie.includes("erp.sid="));
  return { cookie: verified.cookie, csrf: verified.data.csrfToken };
}

const config = await request("/api/v1/public/config");
assert.equal(config.data.customerDemoEnabled, true);
assert.equal(config.data.miniProgramEnabled, false);

const first = await customer("13800000001");
const second = await customer("13800000002");
assert.equal((await request("/api/v1/customer/runtime")).status, 401);
const runtime = await request("/api/v1/customer/runtime", "GET", undefined, first);
assert.equal(runtime.status, 200);
assert.equal(runtime.data.activeChunks, 4); // Public research drafts never become active automatically.
assert.equal(runtime.data.previewChunks, 4);
assert.equal(runtime.data.mixedSearchChunks, 32);
assert.equal(runtime.data.reviewChunks, 28);
assert.equal(runtime.data.vectorizedChunks, 32);
assert.equal(runtime.data.denseEnabled, true);
assert.equal(runtime.data.rerankEnabled, true);
assert.equal(runtime.data.environment, "local_demo");
assert.equal(JSON.stringify(runtime.data).includes("serviceToken"), false);
assert.equal(JSON.stringify(runtime.data).includes("sk-"), false);
const firstOrders = await request("/api/v1/customer/orders", "GET", undefined, first);
const secondOrders = await request("/api/v1/customer/orders", "GET", undefined, second);
assert.equal(firstOrders.status, 200);
assert.equal(firstOrders.data.length, 1);
assert.equal(secondOrders.data.length, 1);
const firstId: string = firstOrders.data[0].orderId;
const secondId: string = secondOrders.data[0].orderId;
assert.notEqual(firstId, secondId);
assert.equal((await request("/api/v1/customer/orders/" + secondId, "GET", undefined, first)).status, 404);
assert.equal((await request("/api/v1/orders", "GET", undefined, first)).status, 401);
assert.equal((await request("/api/v1/customer-internal/orders", "GET", undefined, first)).status, 401);
const progress = await request("/api/v1/customer/orders/" + firstId, "GET", undefined, first);
assert.equal(progress.status, 200);
assert.equal(progress.data.stage, "生产中");
for (const forbidden of ["amount", "depositConfirmed", "tailPaymentConfirmed", "attachments", "customerPhone"]) {
  assert.equal(JSON.stringify(progress.data).includes('"' + forbidden + '"'), false);
}
const chat = await request("/api/v1/customer/chat", "POST", { question: "我的订单现在做到哪一步了？" }, first);
assert.equal(chat.status, 201, JSON.stringify(chat.data));
assert.match(chat.data.answer, /生产中/);
assert(chat.data.trace.some((event: { step: string; name?: string }) => event.step === "tool" && event.name === "get_order_progress"));
const colorChange = await request("/api/v1/customer/chat", "POST", { question: "查询订单 TEST-SALES-CUSTOMER-01 的进度，我这笔订单里的柜子现在还可以换颜色吗？" }, first);
assert.equal(colorChange.status, 201, JSON.stringify(colorChange.data));
assert.match(colorChange.data.answer, /生产中/);
assert.match(colorChange.data.answer, /待公司审核/);
assert.match(colorChange.data.answer, /颜色/);
assert.doesNotMatch(colorChange.data.answer, /清洁|保修|售后/);
const changeSources = new Set(colorChange.data.sources);
for (const id of ["company-change-001", "company-change-002", "company-change-003", "company-change-004"]) assert(changeSources.has(id));
assert.equal(colorChange.data.trace.filter((event: { step: string; name?: string; status: string }) => event.step === "tool" && event.name === "search_knowledge" && event.status === "ok").length, 1);
const redCabinet = await request("/api/v1/customer/chat", "POST", { question: "我的订单执行到哪里了，里面的柜子我可以换成红色的吗" }, second);
assert.equal(redCabinet.status, 201, JSON.stringify(redCabinet.data));
assert.match(redCabinet.data.answer, /交付中/);
assert.match(redCabinet.data.answer, /待公司审核/);
assert.doesNotMatch(redCabinet.data.answer, /清洁|保修|售后/);
assert(redCabinet.data.sources.includes("company-change-002"), JSON.stringify(redCabinet.data));
assert.equal(redCabinet.data.trace.filter((event: { step: string; name?: string; status: string }) => event.step === "tool" && event.name === "search_knowledge" && event.status === "ok").length, 1);
assert(redCabinet.data.trace.some((event: { step: string; status: string }) => event.step === "validate" && event.status === "passed"));
const stream = await fetch(base + "/api/v1/customer/chat/stream", {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: first.cookie, "x-csrf-token": first.csrf },
  body: JSON.stringify({ question: "那一单目前是什么进度？", threadId: chat.data.threadId }),
  signal: AbortSignal.timeout(70_000),
});
assert.equal(stream.status, 200);
assert.match(stream.headers.get("content-type") ?? "", /text\/event-stream/);
const events = (await stream.text()).split("\n\n").filter((part) => part.startsWith("data: ")).map((part) => JSON.parse(part.slice(6)));
assert(events.some((event) => event.type === "trace" && event.event.step === "tool"));
assert(events.some((event) => event.type === "result" && /生产中/.test(event.answer)));
assert.equal(events.filter((event) => event.type === "result").length, 1, "多轮 SSE 不能重复发送上一轮结果");
assert.equal(events.filter((event) => event.type === "trace" && event.event.step === "prepare").length, 1);
assert(events.some((event) => event.type === "trace" && event.event.step === "prepare" && event.event.queryRewritten));
assert(events.some((event) => event.type === "trace" && event.event.step === "tool" && event.event.result));
assert.equal(JSON.stringify(events).includes("service_token"), false);
const agentHandoff = await request("/api/v1/customer/chat", "POST", { question: "请转人工处理", threadId: "00000000-0000-4000-8000-000000000001" }, first);
assert.equal(agentHandoff.status, 201);
assert(agentHandoff.data.trace.some((event: { step: string; status: string }) => event.step === "handoff" && event.status === "created"));

const handoffKey = "TEST-DEMO-HANDOFF-ACCEPTANCE";
const support = await request("/api/v1/customer/support", "POST", { orderId: firstId, question: "请人工核对测试订单", reason: "客服 Demo 验收", idempotencyKey: handoffKey }, first);
assert.equal(support.status, 201);
const repeated = await request("/api/v1/customer/support", "POST", { orderId: firstId, question: "请人工核对测试订单", reason: "客服 Demo 验收", idempotencyKey: handoffKey }, first);
assert.equal(repeated.data.id, support.data.id);

const login = await request("/api/v1/auth/login", "POST", { username: "customer_demo_admin", password: "customer-demo-123" });
assert.equal(login.status, 201);
const admin: Client = { cookie: login.cookie, csrf: login.data.csrfToken };
const pending = await request("/api/v1/customer-admin/support", "GET", undefined, admin);
assert.equal(pending.status, 200);
assert(pending.data.some((item: { id: string }) => item.id === support.data.id));
const reply = await request("/api/v1/customer-admin/support/" + support.data.id + "/replies", "POST", { text: "已收到这笔测试订单的人工请求。" }, admin);
assert.equal(reply.status, 201);
const visibleSupport = await request("/api/v1/customer/support", "GET", undefined, first);
assert(visibleSupport.data.some((item: { id: string; replies: Array<{ body: string }> }) => item.id === support.data.id && item.replies.some((entry) => entry.body.includes("已收到"))));

console.log("本地客服验收通过：隔离开关、验证码、客户行权限、订单投影、Agent 查询、实时轨迹、人工请求、幂等和回复。");
