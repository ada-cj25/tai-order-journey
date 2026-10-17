import "reflect-metadata";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import * as XLSX from "xlsx";
import { PrismaService } from "../../server/prisma.service.js";
import { OrderNumberAllocator } from "../../server/number-allocator.service.js";
import { OrdersService } from "../../server/orders.service.js";
import { TaskScheduler } from "../../server/scheduler.service.js";

if (!/^\/erp_test_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("测试只允许访问本次创建的隔离数据库");
const db = new PrismaService();
const password = "Integration-only-2026";
let apiProcess: ChildProcess;
let base = "";
let uploads = "";
let logs = "";
const users: Record<string, any> = {};
const sessions: Record<string, { cookie: string; csrf: string }> = {};

async function request(path: string, actor?: string, body?: unknown, expected?: string, key = randomUUID()) {
  const session = actor ? sessions[actor] : undefined;
  const response = await fetch(`${base}${path}`, { method: body === undefined ? "GET" : "POST", headers: {
    ...(session ? { Cookie: session.cookie, "x-csrf-token": session.csrf } : {}),
    ...(body !== undefined ? { "Content-Type": "application/json", "idempotency-key": key } : {}),
    ...(expected ? { "x-expected-updated-at": expected } : {}),
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { response, status: response.status, data: await response.json() };
}
async function login(name: string, pass = password, client: "desktop" | "mobile-readonly" = "desktop", sessionKey = name) {
  const result = await request("/api/v1/auth/login", undefined, { username: name, password: pass, client });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  sessions[sessionKey] = { cookie: result.response.headers.get("set-cookie")!.split(";")[0], csrf: result.data.csrfToken };
  return result;
}
async function order(overrides = {}) {
  const now = new Date();
  const data = { trackingSerial: `TEST-${randomUUID()}`, businessType: "NOERLI_FORMAL", siteType: "FINISHED", customerName: "隔离测试客户", customerPhone: "10000000000", address: "测试地址", amount: 1000, signedAt: now, standardDueAt: now, promisedAt: now, internalDueAt: now, currentOwnerLabel: "测试", nextAction: "测试", salesId: users.sales.id, designerId: users.designer.id, designerAssignedAt: now, designAssignmentVersion: 1, ...overrides } as any;
  if (data.stage === "DESIGN_PENDING" && data.depositConfirmed && (!data.prepaymentRequired || data.prepaymentConfirmed)) {
    data.designIntakeAvailableAt ??= now;
    data.designIntakeDueAt ??= new Date(now.getTime() + 7 * 86_400_000);
  }
  return db.order.create({ data });
}

function veneerWorkbook(productionNumber: string, quantity = 12.75) {
  const workbook = XLSX.utils.book_new();
  const rows = [
    ["油漆参考区", "#REF!"],
    ["实木原材料生产下料单"],
    ["客户：", productionNumber],
    ["产品型号", "平板门材质", "原材料名称", "实际面积(平方)"],
    ["测试门板", "平板门材质：胡桃", "18厚多层板", quantity],
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "下料单");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function uploadWorkbook(orderId: string, category: string, name: string, buffer: Buffer) {
  const form = new FormData();
  form.set("category", category);
  form.set("file", new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name);
  const response = await fetch(`${base}/api/v1/attachments/${orderId}`, {
    method: "POST",
    headers: { Cookie: sessions.technical.cookie, "x-csrf-token": sessions.technical.csrf },
    body: form,
  });
  return { status: response.status, data: await response.json() };
}

async function uploadEvidence(orderId: string, actor: string, category: string, name: string, bytes: Uint8Array, type: string) {
  const form = new FormData();
  form.set("category", category);
  form.set("file", new Blob([bytes], { type }), name);
  const response = await fetch(`${base}/api/v1/attachments/${orderId}`, {
    method: "POST",
    headers: { Cookie: sessions[actor]!.cookie, "x-csrf-token": sessions[actor]!.csrf },
    body: form,
  });
  return { status: response.status, data: await response.json() };
}

before(async () => {
  const passwordHash = await hash(password, 10);
  for (const [username, role] of Object.entries({ admin: "CHAIRMAN", sales: "SALES", sales_supervisor: "SALES", outsider: "SALES", designer: "DESIGNER", designer2: "DESIGNER", technical: "TECHNICAL", worker: "WORKSHOP", workshop_supervisor: "WORKSHOP", finance: "FINANCE", procurement: "PROCUREMENT", orderadmin: "ORDER_ADMIN", installer: "INSTALLER", aftersales: "AFTERSALES" })) {
    users[username] = await db.employee.create({ data: { employeeNo: username, username, name: username, department: "测试", role: role as never, passwordHash, businessUnit: "NOERLI", ...(["sales_supervisor", "workshop_supervisor"].includes(username) ? { level: "SUPERVISOR" } : {}), ...(role === "WORKSHOP" ? { workshop: "PANEL", processCode: "PANEL-01", processCodes: ["PANEL-01"] } : {}) } });
  }
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  uploads = await mkdtemp(join(tmpdir(), "erp-test-uploads-"));
  base = `http://127.0.0.1:${port}`;
  apiProcess = spawn(process.execPath, process.env.ERP_TEST_COMPILED === "true" ? ["server/dist/main.js"] : ["--import", "tsx", "server/main.ts"], { env: { ...process.env, NODE_ENV: "test", API_HOST: "127.0.0.1", API_PORT: String(port), ATTACHMENT_STORAGE: "local", UPLOAD_ROOT: uploads, COST_MODULE_ENABLED: "false", TSX_TSCONFIG_PATH: "server/tsconfig.json" }, stdio: ["ignore", "pipe", "pipe"] });
  apiProcess.stdout?.on("data", (data) => { logs = (logs + data).slice(-16000); });
  apiProcess.stderr?.on("data", (data) => { logs = (logs + data).slice(-16000); });
  for (let attempt = 0; attempt < 240; attempt++) {
    if (await fetch(`${base}/api/health/ready`).then((r) => r.ok).catch(() => false)) break;
    if (apiProcess.exitCode !== null || attempt === 239) throw new Error(`API启动失败: ${logs}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  for (const name of Object.keys(users)) await login(name);
});

after(async () => {
  if (apiProcess && apiProcess.exitCode === null) {
    const exited = new Promise((resolve) => apiProcess.once("exit", resolve));
    apiProcess.kill("SIGTERM"); await exited;
  }
  await db.$disconnect();
  if (uploads.startsWith(join(tmpdir(), "erp-test-uploads-"))) await rm(uploads, { recursive: true, force: true });
});

test("health is public; protected writes need CSRF; disabled cost APIs stay closed", async () => {
  assert.equal((await request("/api/health/ready")).status, 200);
  const publicConfig = await request("/api/v1/public/config");
  assert.equal(publicConfig.status, 200);
  assert.equal(publicConfig.data.productName, "苔的跟单旅程");
  assert.equal(JSON.stringify(publicConfig.data).includes("SECRET"), false);
  const loginWeather = await request("/api/v1/public/login-weather");
  assert.equal(loginWeather.status, 200);
  assert.equal(loginWeather.data.mode, "sunny");
  assert.equal(loginWeather.data.locationLabel, "宁波镇海");
  assert.equal(loginWeather.data.stale, true);
  assert.equal(JSON.stringify(loginWeather.data).includes("AMAP_WEATHER_API_KEY"), false);
  assert.equal((await request("/api/v1/orders")).status, 401);
  const response = await fetch(`${base}/api/v1/notifications/fake/read`, { method: "POST", headers: { Cookie: sessions.admin.cookie } });
  assert.equal(response.status, 403);
  assert.equal((await request("/api/v1/material-cost-items", "admin")).status, 410);
  assert.equal((await request("/api/v1/procurement/orders", "admin")).status, 200);
});

test("the mobile chairman session can read every order but cannot call business writes", async () => {
  const result = await login("admin", password, "mobile-readonly", "admin-mobile");
  assert.equal(result.data.employee.sessionClient, "mobile-readonly");
  assert.equal((await request("/api/v1/orders", "admin-mobile")).status, 200);
  const rejected = await request("/api/v1/notifications/fake/read", "admin-mobile", {});
  assert.equal(rejected.status, 403);
  assert.match(String(rejected.data.message), /只读会话/);
});

test("安装人员从可见正单创建关联补单后立即返回成功且重试不重复建单", async () => {
  const parent = await order({
    creationMode: "SALES_STANDARD",
    stage: "INSTALLATION",
    salesNumber: `TEST-SALES-${randomUUID()}`,
  });
  await db.task.create({
    data: {
      orderId: parent.id,
      stage: "INSTALLATION",
      title: "安装测试待办",
      department: "安装部",
      ownerId: users.installer.id,
      dueAt: new Date(),
      reminderAt: new Date(),
      uniqueKey: `TEST-INSTALL-SUPPLEMENT-${parent.id}`,
    },
  });
  const payload = {
    businessType: "NOERLI_SUPPLEMENT",
    creationMode: "SALES_STANDARD",
    parentOrderId: parent.id,
    siteType: "FINISHED",
    amount: 0,
    signedAt: "2026-09-23",
    promisedAt: "2026-09-30",
    supplementType: "INSTALLATION_ISSUE",
    responsibilityType: "COMPANY_RESPONSIBILITY",
    supplementReason: "安装现场回归测试",
  };
  const key = randomUUID();

  const first = await request("/api/v1/orders", "installer", payload, undefined, key);
  assert.equal(first.status, 201, JSON.stringify(first.data));
  assert.equal(first.data.parentOrderId, parent.id);
  assert.equal(first.data.createdById, users.installer.id);

  const retried = await request("/api/v1/orders", "installer", payload, undefined, key);
  assert.equal(retried.status, 201, JSON.stringify(retried.data));
  assert.equal(retried.data.id, first.data.id);
  assert.equal((await request(`/api/v1/orders/${first.data.id}`, "installer")).status, 200);
  assert.equal(await db.order.count({ where: { parentOrderId: parent.id, createdById: users.installer.id } }), 1);
});

test("contract amount visibility is separate from payment secrecy and edits close at tail report or shipment", async () => {
  const record = await order({ stage: "BUSINESS_COMPLETE", amount: 1000 });
  for (const actor of ["sales", "sales_supervisor", "designer", "finance", "orderadmin", "admin"]) {
    const detail = await request(`/api/v1/orders/${record.id}`, actor);
    assert.equal(detail.status, 200, `${actor}: ${JSON.stringify(detail.data)}`);
    assert.equal(Number(detail.data.amount), 1000, `${actor}应看到合同金额`);
  }
  for (const actor of ["technical", "procurement", "aftersales"]) {
    const detail = await request(`/api/v1/orders/${record.id}`, actor);
    assert.equal(detail.status, 200, `${actor}: ${JSON.stringify(detail.data)}`);
    assert.equal(detail.data.amount, undefined, `${actor}不应看到合同金额`);
  }
  const changed = await request(`/api/v1/orders/${record.id}/contract-amount`, "orderadmin", { amount: 1200 }, record.updatedAt.toISOString());
  assert.equal(changed.status, 201, JSON.stringify(changed.data));
  assert.equal(Number((await db.order.findUniqueOrThrow({ where: { id: record.id } })).amount), 1200);
  assert.equal((await request(`/api/v1/orders/${record.id}/contract-amount`, "designer", { amount: 1300 }, changed.data.updatedAt)).status, 403);
  const tailed = await db.order.update({ where: { id: record.id }, data: { tailPaymentReported: true } });
  assert.equal((await request(`/api/v1/orders/${record.id}/contract-amount`, "admin", { amount: 1300 }, tailed.updatedAt.toISOString())).status, 400);

  const supplement = await order({ businessType: "NOERLI_SUPPLEMENT", amount: 50 });
  const zero = await request(`/api/v1/orders/${supplement.id}/contract-amount`, "admin", { amount: 0 }, supplement.updatedAt.toISOString());
  assert.equal(zero.status, 201, JSON.stringify(zero.data));

  const paid = await order({ amount: 1000, depositReported: true, depositConfirmed: true, prepaymentRequired: false });
  await db.stageSubmission.create({ data: { orderId: paid.id, stage: "DEPOSIT_PENDING", command: "REPORT_DEPOSIT", status: "SUBMITTED", payload: { receivedAmount: 300 }, submittedBy: users.sales.id } });
  const paidFresh = await db.order.findUniqueOrThrow({ where: { id: paid.id } });
  assert.equal((await request(`/api/v1/orders/${paid.id}/contract-amount`, "orderadmin", { amount: 299 }, paidFresh.updatedAt.toISOString())).status, 400);
  const shippedOrder = await order({ amount: 1000 });
  await db.shipment.create({ data: { orderId: shippedOrder.id, kind: "OUTSOURCED", vehicle: "测试车", deliveredAt: new Date(), submittedBy: users.orderadmin.id } });
  const shippedFresh = await db.order.findUniqueOrThrow({ where: { id: shippedOrder.id } });
  assert.equal((await request(`/api/v1/orders/${shippedOrder.id}/contract-amount`, "orderadmin", { amount: 1100 }, shippedFresh.updatedAt.toISOString())).status, 400);
});

test("hardware package totals finalize every active area atomically and preserve zero totals", async () => {
  const record = await order({ stage: "MATERIALS" });
  const areaA = await db.productionArea.create({ data: { orderId: record.id, name: "客厅", sequence: 1, productionNumber: `TEST-HW-A-${randomUUID()}`, createdBy: users.technical.id } });
  const areaB = await db.productionArea.create({ data: { orderId: record.id, name: "儿童房", sequence: 2, productionNumber: `TEST-HW-B-${randomUUID()}`, createdBy: users.technical.id } });
  const result = await request(`/api/v1/orders/${record.id}/package-counts/hardware/bulk-finalize`, "procurement", { areas: [{ productionAreaId: areaA.id, total: 4 }, { productionAreaId: areaB.id, total: 0 }] }, record.updatedAt.toISOString());
  assert.equal(result.status, 201, JSON.stringify(result.data));
  const sources = await db.packageCountSource.findMany({ where: { orderId: record.id, kind: "HARDWARE_AREA" }, include: { entries: true } });
  assert.equal(sources.length, 2);
  assert.equal(sources.every((source) => source.status === "FINALIZED"), true);
  assert.equal(sources.find((source) => source.productionAreaId === areaA.id)?.entries.reduce((sum, entry) => sum + entry.quantity, 0), 4);
  assert.equal(sources.find((source) => source.productionAreaId === areaB.id)?.entries.length, 0);
  const fresh = await db.order.findUniqueOrThrow({ where: { id: record.id } });
  assert.equal((await request(`/api/v1/orders/${record.id}/package-counts/hardware/bulk-finalize`, "procurement", { areas: [{ productionAreaId: areaA.id, total: 4 }, { productionAreaId: areaB.id, total: 0 }] }, fresh.updatedAt.toISOString())).status, 400);
});

test("workshop supervisor bulk reporting stays inside one area and workshop and rolls back on issues", async () => {
  const record = await order({ stage: "PRODUCTION", productionExecutionMode: "AREA_LEGACY" });
  const area = await db.productionArea.create({ data: { orderId: record.id, name: "客厅", sequence: 1, productionNumber: `TEST-BULK-${randomUUID()}`, createdBy: users.technical.id } });
  const otherArea = await db.productionArea.create({ data: { orderId: record.id, name: "卧室", sequence: 2, productionNumber: `TEST-BULK-OTHER-${randomUUID()}`, createdBy: users.technical.id } });
  await db.productionProcess.createMany({ data: [
    { orderId: record.id, productionAreaId: area.id, workshop: "PANEL", workshopLabel: "板式车间", processCode: "PANEL-01", processName: "开料", sequence: 1, plannedQty: 5 },
    { orderId: record.id, productionAreaId: area.id, workshop: "PANEL", workshopLabel: "板式车间", processCode: "PANEL-02", processName: "封边", sequence: 2, plannedQty: 5, status: "ISSUE" },
    { orderId: record.id, productionAreaId: area.id, workshop: "WOOD", workshopLabel: "实木车间", processCode: "WOOD-01", processName: "开料", sequence: 1, plannedQty: 5 },
    { orderId: record.id, productionAreaId: otherArea.id, workshop: "PANEL", workshopLabel: "板式车间", processCode: "PANEL-01", processName: "开料", sequence: 1, plannedQty: 3 },
  ] });
  const rejected = await request(`/api/v1/orders/${record.id}/production/bulk-complete`, "workshop_supervisor", { productionAreaId: area.id }, record.updatedAt.toISOString());
  assert.equal(rejected.status, 400);
  assert.equal(await db.productionReport.count({ where: { orderId: record.id } }), 0);
  await db.productionProcess.updateMany({ where: { orderId: record.id, productionAreaId: area.id, processCode: "PANEL-02" }, data: { status: "PENDING" } });
  const completed = await request(`/api/v1/orders/${record.id}/production/bulk-complete`, "workshop_supervisor", { productionAreaId: area.id }, record.updatedAt.toISOString());
  assert.equal(completed.status, 201, JSON.stringify(completed.data));
  assert.equal(await db.productionReport.count({ where: { orderId: record.id, productionAreaId: area.id } }), 2);
  assert.equal((await db.productionProcess.findFirstOrThrow({ where: { orderId: record.id, productionAreaId: area.id, workshop: "WOOD" } })).status, "PENDING");
  assert.equal((await db.productionProcess.findFirstOrThrow({ where: { orderId: record.id, productionAreaId: otherArea.id, workshop: "PANEL" } })).status, "PENDING");
});

test("aftersales registration and cost writes both obey the disabled cost flag", async () => {
  const pending = await order({ stage: "ACCEPTANCE" });
  assert.equal((await request("/api/v1/aftersales", "orderadmin", { orderId: pending.id, issueType: "调整", description: "尚未履约", incurredOn: "2026-09-12", amount: 100 }, pending.updatedAt.toISOString())).status, 403);
  const complete = await order({ stage: "BUSINESS_COMPLETE", finalAcceptedAt: new Date() });
  const created = await request("/api/v1/aftersales", "aftersales", { orderId: complete.id, issueType: "五金更换", description: "客户报修", incurredOn: "2026-09-12", amount: 100 }, complete.updatedAt.toISOString());
  assert.equal(created.status, 410, JSON.stringify(created.data));
  const queue = await request("/api/v1/aftersales", "aftersales");
  assert.equal(queue.status, 200);
  assert.equal(queue.data.some((item: any) => item.orderId === complete.id), false);
});

test("cross-order detail and attachment IDs cannot bypass employee scope", async () => {
  const record = await order();
  assert.equal((await request(`/api/v1/orders/${record.id}`, "outsider")).status, 404);
  const form = new FormData(); form.set("category", "DEPOSIT_RECEIPT"); form.set("file", new Blob(["%PDF-1.7\nfixture"]), "合同.pdf");
  const uploaded = await fetch(`${base}/api/v1/attachments/${record.id}`, { method: "POST", headers: { Cookie: sessions.sales.cookie, "x-csrf-token": sessions.sales.csrf }, body: form });
  assert.equal(uploaded.status, 201); const file = await uploaded.json();
  assert.equal(file.originalName, "合同.pdf"); assert.match(file.sha256, /^[a-f0-9]{64}$/);
  for (const actor of ["finance", "admin", "orderadmin", "designer"]) {
    const forbiddenForm = new FormData(); forbiddenForm.set("category", "DEPOSIT_RECEIPT"); forbiddenForm.set("file", new Blob(["%PDF-1.7\nfixture"]), `${actor}.pdf`);
    const forbiddenUpload = await fetch(`${base}/api/v1/attachments/${record.id}`, { method: "POST", headers: { Cookie: sessions[actor].cookie, "x-csrf-token": sessions[actor].csrf }, body: forbiddenForm });
    assert.equal(forbiddenUpload.status, 403, `${actor}不应能上传付款凭证`);
  }
  assert.equal((await fetch(`${base}/api/v1/attachments/${file.id}`, { headers: { Cookie: sessions.outsider.cookie } })).status, 404);
  assert.equal((await fetch(`${base}/api/v1/attachments/${file.id}`, { headers: { Cookie: sessions.sales.cookie } })).status, 200);
  assert.equal((await fetch(`${base}/api/v1/attachments/${file.id}`, { headers: { Cookie: sessions.finance.cookie } })).status, 200);
  assert.equal((await fetch(`${base}/api/v1/attachments/${file.id}`, { headers: { Cookie: sessions.admin.cookie } })).status, 403);
  assert.equal((await fetch(`${base}/api/v1/attachments/${file.id}`, { headers: { Cookie: sessions.orderadmin.cookie } })).status, 403);
  assert.equal((await fetch(`${base}/api/v1/attachments/${file.id}`, { headers: { Cookie: sessions.designer.cookie } })).status, 403);
  for (const actor of ["admin", "orderadmin", "designer"]) {
    const detail = await request(`/api/v1/orders/${record.id}`, actor);
    assert.equal(detail.status, 200, JSON.stringify(detail.data));
    assert.equal(detail.data.attachments.some((attachment: any) => attachment.id === file.id), false);
  }
  for (const actor of ["sales", "finance"]) {
    const detail = await request(`/api/v1/orders/${record.id}`, actor);
    assert.equal(detail.data.attachments.some((attachment: any) => attachment.id === file.id), true);
  }
  const other = await order();
  assert.equal((await request(`/api/v1/orders/${other.id}/drafts`, "sales", { command: "REPORT_DEPOSIT", payload: { receiptAttachmentIds: [file.id] } }, other.updatedAt.toISOString())).status, 403);
});

test("technical material previews persist optional categories, replace drafts, and stay hidden from finance", async () => {
  const record = await order({ stage: "TECHNICAL", productionNumber: "2607508" });
  const area = await db.productionArea.create({ data: { orderId: record.id, name: "历史未分区区域", sequence: 1, productionNumber: "2607508", createdBy: users.technical.id } });
  const firstFile = await uploadWorkbook(record.id, "VENEER_DOOR", "2607508-first.xlsx", veneerWorkbook("2607508"));
  assert.equal(firstFile.status, 201, JSON.stringify(firstFile.data));
  const first = await request("/api/v1/material-imports/preview", "technical", { orderId: record.id, productionAreaId: area.id, attachmentId: firstFile.data.id, templateType: "VENEER_DOOR" });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  assert.equal(first.data.valid, true);
  assert.equal(first.data.sourceProductionNumber, "2607508");
  assert.equal(first.data.lines.length, 1);

  const restored = await request(`/api/v1/material-imports/order/${record.id}/area/${area.id}/drafts`, "technical");
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  assert.deepEqual(restored.data.map((batch: any) => batch.id), [first.data.id]);
  assert.equal((await request(`/api/v1/material-imports/order/${record.id}/area/${area.id}/drafts`, "finance")).status, 403);

  const secondFile = await uploadWorkbook(record.id, "VENEER_DOOR", "2607508-second.xlsx", veneerWorkbook("2607508", 20));
  const second = await request("/api/v1/material-imports/preview", "technical", { orderId: record.id, productionAreaId: area.id, attachmentId: secondFile.data.id, templateType: "VENEER_DOOR" });
  assert.equal(second.status, 201, JSON.stringify(second.data));
  assert.notEqual(second.data.id, first.data.id);
  assert.equal((await db.materialImportBatch.findUniqueOrThrow({ where: { id: first.data.id } })).status, "CANCELLED");
  assert.equal(await db.attachment.count({ where: { id: { in: [firstFile.data.id, secondFile.data.id] } } }), 2);

  const mismatchFile = await uploadWorkbook(record.id, "PAINT_WOOD", "wrong-production.xlsx", veneerWorkbook("2609999"));
  const mismatch = await request("/api/v1/material-imports/preview", "technical", { orderId: record.id, productionAreaId: area.id, attachmentId: mismatchFile.data.id, templateType: "PAINT_WOOD" });
  assert.equal(mismatch.status, 201, JSON.stringify(mismatch.data));
  assert.equal(mismatch.data.valid, false);
  assert.ok(mismatch.data.errors.some((issue: any) => issue.code === "PRODUCTION_NUMBER_MISMATCH"));

  const cancelled = await request(`/api/v1/material-imports/${second.data.id}/cancel`, "technical", {});
  assert.equal(cancelled.status, 201, JSON.stringify(cancelled.data));
  const remaining = await request(`/api/v1/material-imports/order/${record.id}/area/${area.id}/drafts`, "technical");
  assert.deepEqual(remaining.data.map((batch: any) => batch.templateType), ["PAINT_WOOD"]);
});

test("technical workshop plans persist as independent drafts for each production area", async () => {
  const record = await order({ stage: "TECHNICAL", productionNumber: "TEST-AREA-ROOT" });
  const living = await db.productionArea.create({ data: { orderId: record.id, name: "客厅", sequence: 1, productionNumber: "TEST-AREA-LIVING", createdBy: users.technical.id } });
  const bathroom = await db.productionArea.create({ data: { orderId: record.id, name: "卫生间", sequence: 2, productionNumber: "TEST-AREA-BATHROOM", createdBy: users.technical.id } });

  const first = await request(`/api/v1/orders/${record.id}/drafts`, "technical", { command: "SUBMIT_TECHNICAL", payload: { productionAreaId: living.id, panelEnabled: true, woodPaintEnabled: false, panelQty: 12, assemblyQty: 9 } }, record.updatedAt.toISOString());
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const second = await request(`/api/v1/orders/${record.id}/drafts`, "technical", { command: "SUBMIT_TECHNICAL", payload: { productionAreaId: bathroom.id, panelEnabled: false, woodPaintEnabled: true, woodQty: 8, paintQty: 7, assemblyQty: 6 } }, first.data.updatedAt);
  assert.equal(second.status, 201, JSON.stringify(second.data));

  const drafts = await db.stageSubmission.findMany({ where: { orderId: record.id, command: "SUBMIT_TECHNICAL", status: "DRAFT" }, orderBy: { createdAt: "asc" } });
  assert.equal(drafts.length, 2);
  assert.deepEqual(drafts.map((draft) => draft.payload), [
    { productionAreaId: living.id, panelEnabled: true, woodPaintEnabled: false, panelQty: 12, assemblyQty: 9 },
    { productionAreaId: bathroom.id, panelEnabled: false, woodPaintEnabled: true, woodQty: 8, paintQty: 7, assemblyQty: 6 },
  ]);
});

test("concurrent design acceptance with one key writes one fact and one task", async () => {
  const record = await order({ stage: "DESIGN_PENDING", depositConfirmed: true, prepaymentRequired: true, prepaymentConfirmed: true });
  const body = { command: "ACCEPT_DESIGN", payload: { designLeadDays: 3, scopeConfirmed: true } };
  const key = randomUUID();
  const results = await Promise.all([1, 2].map(() => request(`/api/v1/orders/${record.id}/commands`, "designer", body, record.updatedAt.toISOString(), key)));
  assert.deepEqual(results.map((r) => r.status), [201, 201], JSON.stringify(results.map((r) => r.data)));
  assert.equal(await db.stageSubmission.count({ where: { orderId: record.id, command: "ACCEPT_DESIGN" } }), 1);
  assert.equal(await db.task.count({ where: { orderId: record.id, stage: "DESIGN_ACCEPTED" } }), 1);
  assert.equal((await request(`/api/v1/orders/${record.id}/commands`, "designer", { ...body, payload: { designLeadDays: 4, scopeConfirmed: true } }, record.updatedAt.toISOString(), key)).status, 409);
});

test("路线采购可按区域分步保存，也可一键释放同类路线的剩余区域", async () => {
  const now = new Date();
  const record = await order({ stage: "MATERIALS", productionExecutionMode: "ROUTE_V2", procurementStartedAt: now, procurementDueAt: new Date(now.getTime() + 86_400_000), tailPaymentConfirmed: true });
  const areaA = await db.productionArea.create({ data: { orderId: record.id, name: "区域A", sequence: 1, productionNumber: `TEST-ROUTE-A-${randomUUID()}`, createdBy: users.technical.id } });
  const areaB = await db.productionArea.create({ data: { orderId: record.id, name: "区域B", sequence: 2, productionNumber: `TEST-ROUTE-B-${randomUUID()}`, createdBy: users.technical.id } });
  const submissionSet = await db.technicalSubmissionSet.create({ data: { orderId: record.id, version: 1, status: "APPROVED", submittedBy: users.technical.id, reviewedBy: users.orderadmin.id, reviewedAt: now } });
  const packageA = await db.technicalPackageVersion.create({ data: { orderId: record.id, productionAreaId: areaA.id, submissionSetId: submissionSet.id, version: 1, designVersion: "V1", status: "APPROVED", haixunAttachmentId: "test", decompositionAttachmentId: "test", materialAttachmentId: "test", panelPlanQty: 10, woodPlanQty: 8, paintPlanQty: 8, assemblyPlanQty: 16, panelAssemblyPlanQty: 8, woodPaintAssemblyPlanQty: 8, panelEnabled: true, woodPaintEnabled: true, validationSummary: "test", rowCount: 1, submittedBy: users.technical.id, reviewedBy: users.orderadmin.id, reviewedAt: now, firstBatchInstallationFee: 100 } });
  const packageB = await db.technicalPackageVersion.create({ data: { orderId: record.id, productionAreaId: areaB.id, submissionSetId: submissionSet.id, version: 1, designVersion: "V1", status: "APPROVED", haixunAttachmentId: "test", decompositionAttachmentId: "test", materialAttachmentId: "test", panelPlanQty: 6, woodPlanQty: 1, paintPlanQty: 1, assemblyPlanQty: 6, panelAssemblyPlanQty: 6, panelEnabled: true, woodPaintEnabled: false, validationSummary: "test", rowCount: 1, submittedBy: users.technical.id, reviewedBy: users.orderadmin.id, reviewedAt: now, firstBatchInstallationFee: 80 } });
  const panelGate = await db.procurementRouteGate.create({ data: { orderId: record.id, submissionSetId: submissionSet.id, kind: "PANEL", startedAt: now, dueAt: new Date(now.getTime() + 86_400_000) } });
  const woodGate = await db.procurementRouteGate.create({ data: { orderId: record.id, submissionSetId: submissionSet.id, kind: "WOOD_PAINT", startedAt: now, dueAt: new Date(now.getTime() + 86_400_000) } });
  const panelA = await db.productionRoute.create({ data: { orderId: record.id, productionAreaId: areaA.id, technicalPackageId: packageA.id, procurementRouteGateId: panelGate.id, kind: "PANEL", assemblyPlanQty: 8 } });
  const panelB = await db.productionRoute.create({ data: { orderId: record.id, productionAreaId: areaB.id, technicalPackageId: packageB.id, procurementRouteGateId: panelGate.id, kind: "PANEL", assemblyPlanQty: 6 } });
  const woodA = await db.productionRoute.create({ data: { orderId: record.id, productionAreaId: areaA.id, technicalPackageId: packageA.id, procurementRouteGateId: woodGate.id, kind: "WOOD_PAINT", assemblyPlanQty: 8 } });
  for (const [route, area] of [[panelA, areaA], [panelB, areaB], [woodA, areaA]] as const) {
    await db.productionProcess.createMany({ data: [
      { orderId: record.id, productionAreaId: area.id, productionRouteId: route.id, workshop: route.kind === "PANEL" ? "PANEL" : "WOOD", workshopLabel: route.kind === "PANEL" ? "板式车间" : "木工（实木）车间", processCode: route.kind === "PANEL" ? "PANEL-01" : "WOOD-01", processName: "开料", sequence: 1, plannedQty: 1 },
      { orderId: record.id, productionAreaId: area.id, productionRouteId: route.id, workshop: "ASSEMBLY", workshopLabel: "路线组装", processCode: "ASSEMBLY-01", processName: "打包", sequence: 1, plannedQty: 1 },
      { orderId: record.id, productionAreaId: area.id, productionRouteId: route.id, workshop: "ASSEMBLY", workshopLabel: "路线组装", processCode: "ASSEMBLY-04", processName: "订单生产完成", sequence: 4, plannedQty: 1, unit: "项", metricMode: "MILESTONE" },
    ] });
  }

  const released = await request(`/api/v1/orders/${record.id}/procurement-routes/PANEL/complete`, "procurement", { attested: true, productionAreaId: areaA.id }, record.updatedAt.toISOString());
  assert.equal(released.status, 201, JSON.stringify(released.data));
  let routeRows = await db.productionRoute.findMany({ where: { orderId: record.id } });
  assert.equal(routeRows.filter((route) => route.kind === "PANEL" && route.releasedAt).length, 1);
  assert.ok(routeRows.find((route) => route.id === panelA.id)?.releasedAt);
  assert.equal(routeRows.find((route) => route.id === panelB.id)?.releasedAt, null);
  assert.equal(routeRows.find((route) => route.id === woodA.id)?.releasedAt, null);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: record.id } })).stage, "PRODUCTION");

  const afterAreaA = await db.order.findUniqueOrThrow({ where: { id: record.id } });
  const releasedRemaining = await request(`/api/v1/orders/${record.id}/procurement-routes/PANEL/complete`, "procurement", { attested: true }, afterAreaA.updatedAt.toISOString());
  assert.equal(releasedRemaining.status, 201, JSON.stringify(releasedRemaining.data));
  routeRows = await db.productionRoute.findMany({ where: { orderId: record.id } });
  assert.equal(routeRows.filter((route) => route.kind === "PANEL" && route.releasedAt).length, 2);
  assert.ok((await db.procurementRouteGate.findUniqueOrThrow({ where: { id: panelGate.id } })).completedAt);
  assert.equal((await db.procurementRouteGate.findUniqueOrThrow({ where: { id: woodGate.id } })).completedAt, null);

  const panelBTaskKey = `${record.id}:PRODUCTION:${panelB.id}:PANEL`;
  assert.equal((await db.task.findUniqueOrThrow({ where: { uniqueKey: panelBTaskKey } })).status, "PENDING");
  const beforeBulk = await db.order.findUniqueOrThrow({ where: { id: record.id } });
  const panelBCompleted = await request(`/api/v1/orders/${record.id}/production/bulk-complete`, "workshop_supervisor", { productionAreaId: areaB.id, productionRouteId: panelB.id }, beforeBulk.updatedAt.toISOString());
  assert.equal(panelBCompleted.status, 201, JSON.stringify(panelBCompleted.data));
  assert.equal((await db.task.findUniqueOrThrow({ where: { uniqueKey: panelBTaskKey } })).status, "COMPLETE");
  assert.equal((await db.productionProcess.findFirstOrThrow({ where: { productionRouteId: panelB.id, workshop: "ASSEMBLY" } })).status, "PENDING");

  await db.productionProcess.updateMany({ where: { productionRouteId: panelA.id, workshop: "PANEL" }, data: { status: "COMPLETE", completedQty: 1, completedAt: now } });
  const supervisorQueue = await request("/api/v1/tasks?scope=mine", "workshop_supervisor");
  assert.equal(supervisorQueue.status, 200, JSON.stringify(supervisorQueue.data));
  assert.equal(supervisorQueue.data.some((task: any) => task.orderId === record.id && task.productionRouteId === panelA.id), false);
  assert.equal((await db.productionProcess.findFirstOrThrow({ where: { productionRouteId: panelA.id, workshop: "ASSEMBLY" } })).status, "PENDING");

  await db.productionProcess.updateMany({ where: { productionRouteId: panelA.id }, data: { status: "COMPLETE", completedQty: 1, completedAt: now } });
  const current = await db.order.findUniqueOrThrow({ where: { id: record.id } });
  const shipped = await request(`/api/v1/orders/${record.id}/commands`, "admin", { command: "RECORD_DELIVERY", payload: { productionRouteBatches: [{ productionRouteId: panelA.id, isFinalBatch: false }], outsourceLineIds: [], vehicle: "测试车A", installationFees: { [areaA.id]: 100 }, assignedInstallerId: users.installer.id, installationTeamLabel: "安装一组", contact: "张师傅", plannedAt: "2026-09-15", supplyChecks: "可进场", deliveredAt: "2026-09-11" } }, current.updatedAt.toISOString());
  assert.equal(shipped.status, 201, JSON.stringify(shipped.data));
  assert.equal(await db.shipmentRouteLine.count({ where: { productionRouteId: panelA.id } }), 1);
  const shipmentArea = await db.shipmentArea.findFirstOrThrow({ where: { productionAreaId: areaA.id } });
  assert.equal(shipmentArea.isFinalBatch, false);
  assert.equal(Number(shipmentArea.installationFee), 100);
  assert.equal(shipmentArea.installationFeeSource, "ORDER_ADMIN_DELIVERY");
  assert.notEqual((await db.shipment.findFirstOrThrow({ where: { id: shipmentArea.shipmentId } })).deliveredAt.toISOString().slice(0, 10), "2026-09-11");
  assert.equal((await db.productionRoute.findUniqueOrThrow({ where: { id: panelA.id } })).shippedAt, null);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: record.id } })).stage, "PRODUCTION");

  const latest = await db.order.findUniqueOrThrow({ where: { id: record.id } });
  const finalBatch = await request(`/api/v1/orders/${record.id}/commands`, "admin", { command: "RECORD_DELIVERY", payload: { productionRouteBatches: [{ productionRouteId: panelA.id, isFinalBatch: true }], outsourceLineIds: [], vehicle: "测试车B", installationFees: { [areaA.id]: 120 }, assignedInstallerId: users.installer.id, installationTeamLabel: "安装二组", contact: "李师傅", plannedAt: "2026-09-16", supplyChecks: "可进场", deliveredAt: "2026-09-12" } }, latest.updatedAt.toISOString());
  assert.equal(finalBatch.status, 201, JSON.stringify(finalBatch.data));
  const routeBatches = await db.shipmentRouteLine.findMany({ where: { productionRouteId: panelA.id }, orderBy: { sequence: "asc" } });
  assert.deepEqual(routeBatches.map((line) => ({ sequence: line.sequence, isFinalBatch: line.isFinalBatch })), [{ sequence: 1, isFinalBatch: false }, { sequence: 2, isFinalBatch: true }]);
  assert.ok((await db.productionRoute.findUniqueOrThrow({ where: { id: panelA.id } })).shippedAt);

  const afterFinal = await db.order.findUniqueOrThrow({ where: { id: record.id } });
  const duplicate = await request(`/api/v1/orders/${record.id}/commands`, "admin", { command: "RECORD_DELIVERY", payload: { productionRouteBatches: [{ productionRouteId: panelA.id, isFinalBatch: false }], outsourceLineIds: [], vehicle: "测试车C", installationFees: { [areaA.id]: 100 }, assignedInstallerId: users.installer.id, installationTeamLabel: "安装三组", contact: "王师傅", plannedAt: "2026-09-17", supplyChecks: "可进场" } }, afterFinal.updatedAt.toISOString());
  assert.equal(duplicate.status, 400);
  assert.match(String(duplicate.data.message), /已确认末批/);
});

test("finance-confirmed orders appear in the assigned designer's queue until design intake", async () => {
  const record = await order({
    stage: "DESIGN_PENDING",
    depositReported: true,
    depositConfirmed: true,
    prepaymentRequired: true,
    prepaymentReported: true,
    prepaymentConfirmed: true,
    currentOwnerLabel: "设计师",
    nextAction: "设计师下单",
  });

  const before = await request("/api/v1/tasks?scope=mine", "designer");
  assert.equal(before.status, 200, JSON.stringify(before.data));
  assert.equal(before.data.find((task: any) => task.order.id === record.id)?.title, "设计下单");

  const accepted = await request(`/api/v1/orders/${record.id}/commands`, "designer", {
    command: "ACCEPT_DESIGN",
    payload: { designLeadDays: 3, scopeConfirmed: true },
  }, record.updatedAt.toISOString());
  assert.equal(accepted.status, 201, JSON.stringify(accepted.data));

  const after = await request("/api/v1/tasks?scope=mine", "designer");
  assert.equal(after.status, 200, JSON.stringify(after.data));
  assert.equal(after.data.some((task: any) => task.order.id === record.id && task.title === "设计下单"), false);
  assert.equal(after.data.find((task: any) => task.order.id === record.id)?.title, "设计提交");
});

test("付款晚于设计师分配时从财务核验时刻创建七个自然日持久下单任务", async () => {
  const assignedAt = new Date("2026-09-01T02:00:00.000Z");
  const record = await order({ stage: "DEPOSIT_PENDING", designerAssignedAt: assignedAt, prepaymentRequired: true, depositReported: true, prepaymentReported: true, depositConfirmed: false, prepaymentConfirmed: false });
  await db.stageSubmission.createMany({ data: [
    { orderId: record.id, stage: "DEPOSIT_PENDING", command: "REPORT_DEPOSIT", status: "SUBMITTED", payload: { receivedAmount: 100, receivedAt: "2026-09-01", account: "测试户", receiptAttachmentIds: ["receipt-1"] }, submittedBy: users.sales.id },
    { orderId: record.id, stage: "DEPOSIT_PENDING", command: "REPORT_PREPAYMENT", status: "SUBMITTED", payload: { receivedAmount: 100, receivedAt: "2026-09-01", account: "测试户", receiptAttachmentIds: ["receipt-2"] }, submittedBy: users.sales.id },
  ] });
  const beforeConfirmedAt = Date.now();
  const confirmed = await request(`/api/v1/orders/${record.id}/commands`, "finance", { command: "CONFIRM_INITIAL_PAYMENTS", payload: { depositVerified: true, prepaymentVerified: true } }, record.updatedAt.toISOString());
  assert.equal(confirmed.status, 201, JSON.stringify(confirmed.data));
  const updated = await db.order.findUniqueOrThrow({ where: { id: record.id } });
  assert.ok(updated.designIntakeAvailableAt!.getTime() >= beforeConfirmedAt);
  assert.equal(updated.designIntakeDueAt!.getTime() - updated.designIntakeAvailableAt!.getTime(), 7 * 86_400_000);
  const task = await db.task.findUniqueOrThrow({ where: { uniqueKey: `${record.id}:DESIGN_PENDING:v1` } });
  assert.equal(task.ownerId, users.designer.id);
  assert.equal(task.dueAt.toISOString(), updated.designIntakeDueAt!.toISOString());
});

test("设计师可在下单前退回并由销售重分配，下单后转交不延长截止时间", async () => {
  const availableAt = new Date();
  const intakeDueAt = new Date(availableAt.getTime() + 7 * 86_400_000);
  const record = await order({
    stage: "DESIGN_PENDING",
    depositConfirmed: true,
    prepaymentRequired: true,
    prepaymentConfirmed: true,
    designIntakeAvailableAt: availableAt,
    designIntakeDueAt: intakeDueAt,
  });
  await db.task.create({ data: { orderId: record.id, ownerId: users.designer.id, stage: "DESIGN_PENDING", department: "设计部", title: "设计下单", dueAt: intakeDueAt, reminderAt: intakeDueAt, uniqueKey: `${record.id}:DESIGN_PENDING:v1` } });

  const returned = await request(`/api/v1/orders/${record.id}/commands`, "designer", { command: "RETURN_DESIGN", payload: { reason: "当前排期无法承接" } }, record.updatedAt.toISOString());
  assert.equal(returned.status, 201, JSON.stringify(returned.data));
  assert.equal(returned.data.accessRevoked, true);
  const afterReturn = await db.order.findUniqueOrThrow({ where: { id: record.id } });
  assert.equal(afterReturn.designerId, null);
  assert.equal(afterReturn.depositConfirmed, true);
  assert.equal(afterReturn.prepaymentConfirmed, true);
  assert.equal(await db.task.count({ where: { orderId: record.id, stage: "DESIGN_PENDING", status: "CANCELLED" } }), 1);
  const salesQueue = await request("/api/v1/tasks?scope=mine", "sales");
  assert.equal(salesQueue.status, 200, JSON.stringify(salesQueue.data));
  const reassignmentTask = salesQueue.data.find((task: any) => task.order.id === record.id);
  assert.ok(reassignmentTask, "设计师退回后订单应进入所属销售的个人待办");
  assert.equal(reassignmentTask.title, "重新分配设计师");
  assert.equal((await request(`/api/v1/orders/${record.id}`, "designer")).status, 404);
  assert.equal((await request(`/api/v1/orders/${record.id}/commands`, "outsider", { command: "ASSIGN_DESIGNER", payload: { designerId: users.designer2.id } }, afterReturn.updatedAt.toISOString())).status, 404);

  const assignments = await Promise.all([
    request(`/api/v1/orders/${record.id}/commands`, "sales", { command: "ASSIGN_DESIGNER", payload: { designerId: users.designer2.id } }, afterReturn.updatedAt.toISOString()),
    request(`/api/v1/orders/${record.id}/commands`, "admin", { command: "ASSIGN_DESIGNER", payload: { designerId: users.designer2.id } }, afterReturn.updatedAt.toISOString()),
  ]);
  assert.deepEqual(assignments.map((result) => result.status).sort(), [201, 409]);
  const reassigned = await db.order.findUniqueOrThrow({ where: { id: record.id } });
  assert.equal(reassigned.designerId, users.designer2.id);
  assert.equal(reassigned.designAssignmentVersion, 2);
  assert.equal(Math.round((reassigned.designIntakeDueAt!.getTime() - reassigned.designIntakeAvailableAt!.getTime()) / 86_400_000), 7);

  const accepted = await request(`/api/v1/orders/${record.id}/commands`, "designer2", { command: "ACCEPT_DESIGN", payload: { designLeadDays: 4, scopeConfirmed: true } }, reassigned.updatedAt.toISOString());
  assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
  const beforeTransfer = await db.order.findUniqueOrThrow({ where: { id: record.id } });
  const transferred = await request(`/api/v1/orders/${record.id}/commands`, "designer2", { command: "TRANSFER_DESIGN", payload: { designerId: users.designer.id, reason: "设计专业方向调整" } }, beforeTransfer.updatedAt.toISOString());
  assert.equal(transferred.status, 201, JSON.stringify(transferred.data));
  assert.equal(transferred.data.accessRevoked, true);
  const afterTransfer = await db.order.findUniqueOrThrow({ where: { id: record.id } });
  assert.equal(afterTransfer.designerId, users.designer.id);
  assert.equal(afterTransfer.designAssignmentVersion, 3);
  assert.equal(afterTransfer.designAcceptedAt?.toISOString(), beforeTransfer.designAcceptedAt?.toISOString());
  assert.equal(afterTransfer.designDueAt?.toISOString(), beforeTransfer.designDueAt?.toISOString());
  assert.equal(afterTransfer.designLeadDays, beforeTransfer.designLeadDays);
  assert.equal((await request(`/api/v1/orders/${record.id}`, "designer2")).status, 404);
});

test("pre-review rejection reopens the assigned designer's revision task", async () => {
  const dueAt = new Date("2026-10-13T09:00:00.000Z");
  const record = await order({
    stage: "PRE_REVIEW",
    salesNumber: `N-REVISION-${randomUUID()}`,
    currentOwnerLabel: "订单管理员",
    nextAction: "前置审单",
    designAcceptedAt: new Date("2026-09-09T09:00:00.000Z"),
    designLeadDays: 6,
    designDueAt: dueAt,
    internalDueAt: dueAt,
  });
  await db.task.create({ data: {
    orderId: record.id,
    ownerId: users.designer.id,
    stage: "DESIGN_ACCEPTED",
    department: "设计部",
    title: "设计提交",
    dueAt,
    reminderAt: dueAt,
    uniqueKey: `${record.id}:DESIGN_ACCEPTED`,
    status: "COMPLETE",
    completedAt: new Date("2026-09-10T09:00:00.000Z"),
  } });
  await db.task.create({ data: {
    orderId: record.id,
    ownerId: users.orderadmin.id,
    stage: "PRE_REVIEW",
    department: "订单中心",
    title: "前置审单",
    dueAt,
    reminderAt: dueAt,
    uniqueKey: `${record.id}:PRE_REVIEW`,
  } });

  const rejected = await request(`/api/v1/orders/${record.id}/commands`, "orderadmin", {
    command: "REJECT_PRE_REVIEW",
    payload: { reason: "设计方案需要修订" },
  }, record.updatedAt.toISOString());
  assert.equal(rejected.status, 201, JSON.stringify(rejected.data));
  assert.equal(rejected.data.stage, "DESIGN_ACCEPTED");

  const queue = await request("/api/v1/tasks?scope=mine", "designer");
  assert.equal(queue.status, 200, JSON.stringify(queue.data));
  const revisionTask = queue.data.find((task: any) => task.order.id === record.id);
  assert.ok(revisionTask, "退回后的订单应重新出现在原设计师的个人待办中");
  assert.equal(revisionTask.title, "设计提交修订版本");
  assert.equal(new Date(revisionTask.dueAt).toISOString(), dueAt.toISOString());
});

test("reported deposit and prepayment appear in finance personal tasks", async () => {
  const record = await order({
    stage: "DEPOSIT_PENDING",
    prepaymentRequired: true,
    depositReported: true,
    prepaymentReported: true,
    depositConfirmed: false,
    prepaymentConfirmed: false,
    currentOwnerLabel: "财务部",
    nextAction: "同时核验定金与预付款是否实际到账",
  });

  const queue = await request("/api/v1/tasks?scope=mine", "finance");
  assert.equal(queue.status, 200, JSON.stringify(queue.data));
  const paymentTask = queue.data.find((task: any) => task.order.id === record.id);
  assert.ok(paymentTask, "两笔签约首付款均已报备后，应出现在财务个人待办中");
  assert.equal(paymentTask.title, "同时核验定金与预付款");
});

test("pending payment-account requests stay in the chairman's personal queue until review", async () => {
  const name = `隔离测试收款账户-${randomUUID()}`;
  const created = await request("/api/v1/payment-accounts", "finance", { name });
  assert.equal(created.status, 201, JSON.stringify(created.data));

  const pendingQueue = await request("/api/v1/tasks?scope=mine", "admin");
  assert.equal(pendingQueue.status, 200, JSON.stringify(pendingQueue.data));
  const approvalTask = pendingQueue.data.find((task: any) => task.paymentAccountId === created.data.id);
  assert.ok(approvalTask, "待审批收款账户应进入董事长管理员个人待办");
  assert.equal(approvalTask.action, "REVIEW_PAYMENT_ACCOUNT");
  assert.equal(approvalTask.dueAt, null);

  const reviewed = await request(`/api/v1/payment-accounts/${created.data.id}/review`, "admin", { decision: "APPROVE" });
  assert.equal(reviewed.status, 201, JSON.stringify(reviewed.data));
  const completedQueue = await request("/api/v1/tasks?scope=mine", "admin");
  assert.equal(completedQueue.data.some((task: any) => task.paymentAccountId === created.data.id), false);
});

test("two simultaneous cumulative reports with the same version cannot overwrite each other", async () => {
  const record = await order({ stage: "PRODUCTION" });
  const process = await db.productionProcess.create({ data: { orderId: record.id, workshop: "PANEL", workshopLabel: "板式", processCode: "PANEL-01", processName: "开料", sequence: 1, plannedQty: 10, unit: "件" } });
  const results = await Promise.all([3, 5].map((completedQty) => request(`/api/v1/orders/${record.id}/production/report`, "worker", { processId: process.id, action: "PROGRESS", completedQty }, record.updatedAt.toISOString())));
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409], JSON.stringify(results.map((r) => r.data)));
  assert.equal(await db.productionReport.count({ where: { orderId: record.id } }), 1);
  assert.ok([3, 5].includes(Number((await db.productionProcess.findUniqueOrThrow({ where: { id: process.id } })).completedQty)));
  const fresh = await db.order.findUniqueOrThrow({ where: { id: record.id } });
  assert.equal((await request(`/api/v1/orders/${record.id}/production/report`, "outsider", { processId: process.id, action: "COMPLETE" }, fresh.updatedAt.toISOString())).status, 403);
});

test("a task creation failure rolls back the accepted design and business event", async () => {
  const record = await order({ stage: "DESIGN_PENDING" });
  const scheduler = new TaskScheduler(db);
  scheduler.planDesign = async () => { throw new Error("test scheduler failure"); };
  const service = new OrdersService(db, new OrderNumberAllocator(), scheduler, {} as never, { assertApproved: async () => undefined } as never);
  await assert.rejects(service.command(record.id, "ACCEPT_DESIGN", users.designer, { designLeadDays: 3, scopeConfirmed: true }, { key: randomUUID(), expectedUpdatedAt: record.updatedAt.toISOString() }), /test scheduler failure/);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: record.id } })).stage, "DESIGN_PENDING");
  assert.equal(await db.orderEvent.count({ where: { orderId: record.id } }), 0);
});

test("parallel number allocation produces unique numbers in the shared monthly pool", async () => {
  const allocator = new OrderNumberAllocator();
  const numbers = await Promise.all(Array.from({ length: 12 }, () => db.$transaction((tx) => allocator.allocate(tx, "NOERLI_FORMAL", new Date("2026-08-30T00:00:00Z")))));
  assert.equal(new Set(numbers).size, 12);
});

test("password reset revokes existing sessions and forces a password change before business access", async () => {
  const reset = await request(`/api/v1/admin/employees/${users.outsider.id}/reset-password`, "admin", { password: "Reset-only-2026" });
  assert.equal(reset.status, 201, JSON.stringify(reset.data));
  assert.equal((await request("/api/v1/orders", "outsider")).status, 401);
  const result = await login("outsider", "Reset-only-2026");
  assert.equal(result.data.employee.mustChangePassword, true);
  assert.equal((await request("/api/v1/orders", "outsider")).status, 403);
  assert.equal((await request("/api/v1/auth/password", "outsider", { currentPassword: "Reset-only-2026", newPassword: "Changed-only-2026" })).status, 201);
  await login("outsider", "Changed-only-2026");
  assert.equal((await request("/api/v1/orders", "outsider")).status, 200);
});

test("an external legacy reservation is idempotent and uses the same allocator pool", async () => {
  const key = randomUUID();
  const body = { businessType: "CHANNEL_FORMAL", reason: "TEST-OLD-001 隔离试验" };
  const results = await Promise.all([1, 2].map(() => request("/api/v1/admin/number-reservations", "admin", body, undefined, key)));
  assert.deepEqual(results.map((r) => r.status), [201, 201]);
  assert.equal(results[0].data.number, results[1].data.number);
  assert.equal(await db.securityAudit.count({ where: { action: "LEGACY_NUMBER_RESERVED" } }), 1);
  const next = await db.$transaction((tx) => new OrderNumberAllocator().allocate(tx, "CHANNEL_FORMAL", new Date()));
  assert.notEqual(next, results[0].data.number);
  assert.equal((await request("/api/v1/admin/number-reservations", "sales", body)).status, 403);
});

test("procurement can complete with the cost feature off and no cost version", async () => {
  const record = await order({ stage: "MATERIALS" });
  const area = await db.productionArea.create({ data: { orderId: record.id, name: "客厅", sequence: 1, productionNumber: `TEST-AREA-${randomUUID()}`, status: "APPROVED", createdBy: users.admin.id } });
  const plan = await db.technicalPackageVersion.create({ data: { orderId: record.id, productionAreaId: area.id, version: 1, designVersion: "TEST-V1", status: "APPROVED", haixunAttachmentId: "test-only", decompositionAttachmentId: "test-only", materialAttachmentId: "test-only", validationSummary: "isolated fixture", rowCount: 1, submittedBy: users.admin.id, reviewedBy: users.admin.id } });
  await db.materialListVersion.create({ data: { orderId: record.id, productionAreaId: area.id, technicalPackageId: plan.id, version: 1, releasedBy: users.admin.id } });
  const key = randomUUID();
  const result = await request(`/api/v1/orders/${record.id}/complete-procurement`, "admin", { attested: true }, record.updatedAt.toISOString(), key);
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.equal(result.data.stage, "PRODUCTION");
  assert.equal(await db.productionProcess.count({ where: { orderId: record.id } }), 23);
  assert.equal(await db.orderMaterialCostVersion.count({ where: { orderId: record.id } }), 0);
  assert.equal((await request(`/api/v1/orders/${record.id}/complete-procurement`, "admin", { attested: true }, record.updatedAt.toISOString(), key)).status, 201);
  assert.equal(await db.procurementCompletion.count({ where: { orderId: record.id } }), 1);
});

test("order administrators record outsourced arrivals cumulatively, ship independently, and enforce role and duplicate guards", async () => {
  const record = await order({ stage: "MATERIALS", tailPaymentConfirmed: true, outsourceRequirementMode: "REQUIRED" });
  const requirement = await db.outsourceRequirementVersion.create({ data: { orderId: record.id, version: 1, status: "APPROVED", declaresNone: false, submittedBy: users.technical.id, submittedAt: new Date(), reviewedBy: users.admin.id, reviewedAt: new Date() } });
  const line = await db.outsourceProductLine.create({ data: { orderId: record.id, requirementVersionId: requirement.id, presetCode: "ALUMINUM_GLASS_DOOR", name: "铝框玻璃门", plannedQty: 2, unit: "件", sequence: 1 } });

  const pendingQueue = await request("/api/v1/tasks?scope=mine", "orderadmin");
  assert.equal(pendingQueue.status, 200, JSON.stringify(pendingQueue.data));
  assert.equal(pendingQueue.data.find((task: any) => task.order.id === record.id)?.title, "确认外购成品到货");

  assert.equal((await request(`/api/v1/orders/${record.id}/outsource/products/${line.id}/arrivals`, "procurement", { quantity: 1, arrivedOn: "2026-09-09" }, record.updatedAt.toISOString())).status, 403);
  assert.equal((await request(`/api/v1/orders/${record.id}/commands`, "procurement", { command: "RECORD_OUTSOURCE_DELIVERY", payload: { lineIds: [line.id], vehicle: "测试车辆", deliveredAt: "2026-09-09" } }, record.updatedAt.toISOString())).status, 403);

  const concurrent = await Promise.all([1, 2].map(() => request(`/api/v1/orders/${record.id}/outsource/products/${line.id}/arrivals`, "orderadmin", { quantity: 2, arrivedOn: "2026-09-09" }, record.updatedAt.toISOString())));
  assert.equal(concurrent.filter((result) => result.status === 201).length, 1, JSON.stringify(concurrent.map((result) => result.data)));
  assert.equal(await db.outsourceArrival.count({ where: { productLineId: line.id, voidedAt: null } }), 1);
  const completeQueue = await request("/api/v1/tasks?scope=mine", "orderadmin");
  assert.equal(completeQueue.status, 200, JSON.stringify(completeQueue.data));
  assert.equal(completeQueue.data.some((task: any) => task.order.id === record.id && task.title === "确认外购成品到货"), false);

  const fresh = await db.order.findUniqueOrThrow({ where: { id: record.id } });
  const shipped = await request(`/api/v1/orders/${record.id}/commands`, "orderadmin", { command: "RECORD_DELIVERY", payload: { areaLines: [], outsourceLineIds: [line.id], vehicle: "浙B12345 / 张师傅", deliveredAt: "2026-09-09" } }, fresh.updatedAt.toISOString());
  assert.equal(shipped.status, 201, JSON.stringify(shipped.data));
  assert.equal(shipped.data.stage, "MATERIALS");
  assert.equal(await db.shipment.count({ where: { orderId: record.id, kind: "OUTSOURCED" } }), 1);
  const afterShipment = await db.order.findUniqueOrThrow({ where: { id: record.id } });
  const duplicate = await request(`/api/v1/orders/${record.id}/commands`, "orderadmin", { command: "RECORD_DELIVERY", payload: { areaLines: [], outsourceLineIds: [line.id], vehicle: "浙B12345 / 张师傅", deliveredAt: "2026-09-09" } }, afterShipment.updatedAt.toISOString());
  assert.equal(duplicate.status, 400);
  assert.match(String(duplicate.data.message), /已发货/);
});

test("manufactured shipment may enter installation while pending outsourced products block installation completion", async () => {
  const record = await order({ stage: "INSTALLATION", tailPaymentConfirmed: true, installationApplied: true, outsourceRequirementMode: "REQUIRED" });
  const area = await db.productionArea.create({ data: { orderId: record.id, name: "客厅", sequence: 1, productionNumber: `TEST-AREA-${randomUUID()}`, status: "SHIPPED", createdBy: users.admin.id } });
  await db.productionProcess.create({ data: { orderId: record.id, productionAreaId: area.id, workshop: "ASSEMBLY", workshopLabel: "组装车间", processCode: "ASSEMBLY-01", processName: "打包", sequence: 1, plannedQty: 1, completedQty: 1, status: "COMPLETE" } });
  const manufactured = await db.shipment.create({ data: { orderId: record.id, kind: "MANUFACTURED", vehicle: "测试车辆", deliveredAt: new Date(), pieceCount: 1, assignedInstallerId: users.installer.id, submittedBy: users.admin.id } });
  await db.shipmentArea.create({ data: { shipmentId: manufactured.id, productionAreaId: area.id, productionNumber: area.productionNumber, areaName: area.name, sequence: 1, pieceCount: 1, isFinalBatch: true, installationFee: 100, installationFeeSource: "ORDER_ADMIN_TECH_REVIEW", installationFeeRecordedBy: users.admin.id } });
  const requirement = await db.outsourceRequirementVersion.create({ data: { orderId: record.id, version: 1, status: "APPROVED", declaresNone: false, submittedBy: users.technical.id, submittedAt: new Date(), reviewedBy: users.admin.id, reviewedAt: new Date() } });
  const line = await db.outsourceProductLine.create({ data: { orderId: record.id, requirementVersionId: requirement.id, name: "涂料门", plannedQty: 1, unit: "件", sequence: 1 } });
  await db.outsourceArrival.create({ data: { productLineId: line.id, quantity: 1, arrivedOn: new Date(), confirmedBy: users.procurement.id } });
  await db.task.create({ data: { orderId: record.id, stage: "INSTALLATION", title: "安装", department: "测试", ownerId: users.installer.id, dueAt: new Date(), reminderAt: new Date(), uniqueKey: `TEST-INSTALL-${record.id}` } });

  const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
  const proof = await uploadEvidence(record.id, "installer", "INSTALLATION_PHOTO", "installation.png", png, "image/png");
  assert.equal(proof.status, 201, JSON.stringify(proof.data));
  const installed = await request(`/api/v1/orders/${record.id}/shipments/${manufactured.id}/complete-installation`, "installer", { installedAt: "2026-09-09", installer: "测试安装", photoAttachmentIds: [proof.data.id], issueConclusion: "无", transportCost: 50 }, record.updatedAt.toISOString());
  assert.equal(installed.status, 201, JSON.stringify(installed.data));
  assert.equal(installed.data.stage, "INSTALLATION");

  const fresh = await db.order.findUniqueOrThrow({ where: { id: record.id } });
  const outsourced = await request(`/api/v1/orders/${record.id}/commands`, "orderadmin", { command: "RECORD_DELIVERY", payload: { areaLines: [], outsourceLineIds: [line.id], vehicle: "浙B12345 / 张师傅", deliveredAt: "2026-09-09" } }, fresh.updatedAt.toISOString());
  assert.equal(outsourced.status, 201, JSON.stringify(outsourced.data));
  assert.equal(outsourced.data.stage, "ACCEPTANCE");
});

test("the only active administrator cannot be disabled", async () => {
  const result = await request(`/api/v1/admin/employees/${users.admin.id}`, "admin", { active: false, updatedAt: users.admin.updatedAt.toISOString() });
  assert.equal(result.status, 400);
  assert.equal((await db.employee.findUniqueOrThrow({ where: { id: users.admin.id } })).active, true);
});

test("repeated bad login attempts are rate limited without disclosing account existence", async () => {
  const statuses = [];
  for (let attempt = 0; attempt < 11; attempt++) statuses.push((await request("/api/v1/auth/login", undefined, { username: "nobody", password: "wrong" })).status);
  assert.equal(statuses[0], 401); assert.equal(statuses[10], 429);
});
