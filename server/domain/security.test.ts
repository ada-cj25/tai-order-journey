import test from "node:test";
import assert from "node:assert/strict";
import { runtimeConfig, costEnabled } from "../runtime-config.js";
import { orderScope, attachmentIds, validateOrderAttachments, redactOrderCosts, canReadAttachment, canUploadAttachment, redactPaymentReceiptReferences, canReadFinancialEvidence, canReadContractAmount, redactOrderFinancialAmounts } from "../order-access.js";
import { validatePassword, validateAccount } from "../account-policy.js";
import { validateUpload, MAX_UPLOAD_BYTES } from "../upload-policy.js";
import { mutationFingerprint, assertCurrentVersion } from "../mutations.js";

test("production fails closed without HTTPS, COS and a real session secret", () => {
  assert.throws(() => runtimeConfig({ NODE_ENV: "production" }), /SESSION_SECRET/);
  const good = { NODE_ENV: "production", SESSION_SECRET: "c2bdef873405672abc678192aec457982da", WEB_ORIGIN: "https://erp.company.cn", ATTACHMENT_STORAGE: "cos", COS_BUCKET: "private-123", COS_REGION: "ap-shanghai", COS_SECRET_ID: "test", COS_SECRET_KEY: "test", TZ: "Asia/Shanghai", TRUST_PROXY_HOPS: "1" };
  assert.equal(runtimeConfig(good).trustProxy, 1);
  assert.throws(() => runtimeConfig({ ...good, MINI_PROGRAM_DEV_LOGIN_ENABLED: "true" }), /禁止开启小程序模拟微信登录/);
  assert.throws(() => runtimeConfig({ ...good, MINI_PROGRAM_ENABLED: "true" }), /AppID 和 AppSecret/);
  assert.equal(runtimeConfig({ ...good, MINI_PROGRAM_ENABLED: "true", WECHAT_MINI_APP_ID: "wx-test-app", WECHAT_MINI_APP_SECRET: "test-secret" }).production, true);
  assert.throws(() => runtimeConfig({ ...good, WEB_ORIGIN: "http://erp.company.cn" }), /HTTPS/);
  assert.throws(() => runtimeConfig({ ...good, ATTACHMENT_STORAGE: "local" }), /COS/);
  assert.throws(() => runtimeConfig({ ...good, COS_SECRET_KEY: "" }), /COS/);
  assert.throws(() => runtimeConfig({ ...good, API_PORT: "bad" }), /API_PORT/);
  assert.equal(costEnabled({ NODE_ENV: "production" }), false);
  assert.equal(costEnabled({ NODE_ENV: "development" }), true);
  assert.equal(costEnabled({ NODE_ENV: "development", COST_MODULE_ENABLED: "false" }), false);
  assert.throws(() => runtimeConfig({ ...good, APP_ENVIRONMENT: "company-test" }), /公司云测试环境/);
  assert.throws(() => runtimeConfig({ ...good, APP_ENVIRONMENT: "company-test", COST_MODULE_ENABLED: "true", WEB_ORIGIN: "http://erp.company.cn" }), /HTTPS/);
  assert.equal(runtimeConfig({ ...good, APP_ENVIRONMENT: "company-test", COST_MODULE_ENABLED: "true" }).production, true);
});

test("row scope never grants a warehouse or unassigned workshop global access", () => {
  const actor = { id: "mine", role: "SALES", level: "STAFF", businessUnit: "NOERLI", workshop: null } as never;
  assert.deepEqual(orderScope(actor), { businessType: { in: ["NOERLI_FORMAL", "NOERLI_SUPPLEMENT"] }, creationMode: "SALES_STANDARD", salesId: "mine" });
  assert.deepEqual(orderScope({ ...actor as object, role: "DESIGNER" } as never), { designerId: "mine" });
  assert.deepEqual(orderScope({ ...actor as object, role: "SALES", level: "SUPERVISOR" } as never), { businessType: { in: ["NOERLI_FORMAL", "NOERLI_SUPPLEMENT"] }, creationMode: "SALES_STANDARD" });
  assert.deepEqual(orderScope({ ...actor as object, role: "SALES", level: "SUPERVISOR", businessUnit: "AIKEJU" } as never), { businessType: { in: ["AIKEJU_FORMAL", "AIKEJU_SUPPLEMENT"] }, creationMode: "SALES_STANDARD" });
  assert.deepEqual(orderScope({ ...actor as object, role: "SALES", level: "STAFF", businessUnit: "AIKEJU" } as never), { businessType: { in: ["AIKEJU_FORMAL", "AIKEJU_SUPPLEMENT"] }, creationMode: "SALES_STANDARD", salesId: "mine" });
  assert.deepEqual(orderScope({ ...actor as object, role: "WAREHOUSE" } as never), { id: { in: [] } });
  assert.deepEqual(orderScope({ ...actor as object, role: "WORKSHOP" } as never), { OR: [{ id: { in: [] } }, { createdById: "mine", parentOrderId: { not: null } }] });
});

test("安装、车间和售后可继续查看本人从正单创建的关联补单", () => {
  assert.deepEqual(orderScope({ id: "installer", role: "INSTALLER" } as never), { OR: [{ tasks: { some: { ownerId: "installer" } } }, { createdById: "installer", parentOrderId: { not: null } }] });
  assert.deepEqual(orderScope({ id: "workshop", role: "WORKSHOP", workshop: "ASSEMBLY" } as never), { OR: [{ productionProcesses: { some: { workshop: "ASSEMBLY" } } }, { createdById: "workshop", parentOrderId: { not: null } }] });
  assert.deepEqual(orderScope({ id: "aftersales", role: "AFTERSALES" } as never), { OR: [{ stage: "BUSINESS_COMPLETE" }, { createdById: "aftersales", parentOrderId: { not: null } }] });
});

test("nested attachments must belong to the order and match receipt classification", async () => {
  assert.deepEqual(attachmentIds({ x: { cadAttachmentIds: ["one", "one"], attachmentId: "two" } }), ["one", "two"]);
  const db = { attachment: { findMany: async () => [{ id: "a", category: "DESIGN_CAD" }] } } as never;
  await assert.rejects(validateOrderAttachments(db, "order", { receiptAttachmentIds: ["a"] }, { role: "SALES" } as never, "REPORT_DEPOSIT"), /类别/);
  await assert.rejects(validateOrderAttachments(db, "order", { attachmentIds: ["a", "foreign"] }, { role: "SALES" } as never), /属于当前订单/);
});

test("payment receipts are uploaded only by the assigned salesperson and read only by that salesperson or finance", () => {
  const owner = { id: "sales-owner", role: "SALES" } as never;
  const otherSales = { id: "sales-other", role: "SALES" } as never;
  const finance = { id: "finance", role: "FINANCE" } as never;
  const chairman = { id: "chairman", role: "CHAIRMAN" } as never;
  const orderAdmin = { id: "order-admin", role: "ORDER_ADMIN" } as never;
  const designer = { id: "designer", role: "DESIGNER" } as never;
  for (const category of ["DEPOSIT_RECEIPT", "PREPAYMENT_RECEIPT", "TAIL_PAYMENT_RECEIPT"]) {
    assert.equal(canUploadAttachment(owner, category, "sales-owner"), true);
    assert.equal(canUploadAttachment(finance, category, "sales-owner"), false);
    assert.equal(canUploadAttachment(chairman, category, "sales-owner"), false);
    assert.equal(canReadAttachment(owner, category, "sales-owner"), true);
    assert.equal(canReadAttachment(finance, category, "sales-owner"), true);
    assert.equal(canReadAttachment(otherSales, category, "sales-owner"), false);
    assert.equal(canReadAttachment(chairman, category, "sales-owner"), false);
    assert.equal(canReadAttachment(orderAdmin, category, "sales-owner"), false);
    assert.equal(canReadAttachment(designer, category, "sales-owner"), false);
  }
  assert.deepEqual(redactPaymentReceiptReferences({ receivedAmount: 1000, receiptAttachmentIds: ["secret-id"], nested: { receiptAttachmentIds: ["secret-id-2"] } }), { receivedAmount: 1000, nested: {} });
});

test("非常规收费单凭证仅订单管理员与财务可访问，金额对董事长可见", () => {
  const order = { creationMode: "INTERNAL_EXCEPTION" as const, chargeMode: "CHARGED" as const, commercialConfirmedAt: new Date(), salesId: null };
  const orderAdmin = { id: "order-admin", role: "ORDER_ADMIN" } as never;
  const finance = { id: "finance", role: "FINANCE" } as never;
  const chairman = { id: "chairman", role: "CHAIRMAN" } as never;
  const sales = { id: "sales", role: "SALES" } as never;
  assert.equal(canUploadAttachment(orderAdmin, "DEPOSIT_RECEIPT", order), true);
  assert.equal(canReadAttachment(orderAdmin, "DEPOSIT_RECEIPT", order), true);
  assert.equal(canReadAttachment(finance, "DEPOSIT_RECEIPT", order), true);
  assert.equal(canReadAttachment(chairman, "DEPOSIT_RECEIPT", order), false);
  assert.equal(canReadAttachment(sales, "DEPOSIT_RECEIPT", order), false);
  assert.equal(canReadFinancialEvidence(orderAdmin, order), true);
  assert.equal(canReadFinancialEvidence(finance, order), true);
  assert.equal(canReadFinancialEvidence(chairman, order), true);
});

test("cost redaction reaches nested material items without rewriting source records", () => {
  const input = { amount: "1000", costTotal: "500", materialVersion: { lines: [{ quantity: 3, item: { name: "板", unitCost: "9" } }] } };
  const hidden = redactOrderCosts(input, "SALES");
  assert.equal(JSON.stringify(hidden).includes("unitCost"), false);
  assert.equal(hidden.costTotal, undefined);
  assert.equal(hidden.amount, "1000");
  assert.equal(input.materialVersion.lines[0].item.unitCost, "9");
});

test("合同金额扩大可见角色但付款金额仍只授予所属销售、财务和董事长", () => {
  assert.equal(canReadFinancialEvidence({ id: "sales-owner", role: "SALES" } as never, "sales-owner"), true);
  assert.equal(canReadFinancialEvidence({ id: "sales-other", role: "SALES" } as never, "sales-owner"), false);
  assert.equal(canReadFinancialEvidence({ id: "finance", role: "FINANCE" } as never, "sales-owner"), true);
  assert.equal(canReadFinancialEvidence({ id: "chairman", role: "CHAIRMAN" } as never, "sales-owner"), true);
  for (const role of ["ORDER_ADMIN", "DESIGNER", "TECHNICAL", "PROCUREMENT", "WORKSHOP", "INSTALLER", "AFTERSALES"]) {
    assert.equal(canReadFinancialEvidence({ id: role.toLowerCase(), role } as never, "sales-owner"), false, `${role} 不应看到付款金额`);
  }
  for (const role of ["ORDER_ADMIN", "DESIGNER", "FINANCE", "SALES", "CHAIRMAN"]) assert.equal(canReadContractAmount({ id: role.toLowerCase(), role } as never), true);
  for (const role of ["TECHNICAL", "PROCUREMENT", "WORKSHOP", "INSTALLER", "AFTERSALES"]) assert.equal(canReadContractAmount({ id: role.toLowerCase(), role } as never), false);
  const hidden = redactOrderFinancialAmounts({ amount: 50000, paymentSummary: { depositReceived: 10000, prepaymentReceived: 9000, tailReceivable: 31000 }, nested: { receivedAmount: 10000 }, safe: "付款门禁已通过" }, { id: "order-admin", role: "ORDER_ADMIN" } as never, "sales-owner");
  assert.deepEqual(hidden, { amount: 50000, paymentSummary: {}, nested: {}, safe: "付款门禁已通过" });
  const ownerView = { amount: 50000, nested: { receivedAmount: 10000 } };
  assert.deepEqual(redactOrderFinancialAmounts(ownerView, { id: "sales-owner", role: "SALES" } as never, "sales-owner"), ownerView);
});

test("file policy rejects executable disguises, oversized files and mismatched signatures", () => {
  assert.equal(validateUpload("合同.pdf", Buffer.from("%PDF-1.7\n")).mimeType, "application/pdf");
  assert.throws(() => validateUpload("合同.pdf", Buffer.from("<script>alert(1)</script>")));
  assert.throws(() => validateUpload("photo.svg", Buffer.from("<svg/>")));
  assert.throws(() => validateUpload("材料.csv", Buffer.from("<html>unsafe</html>")));
  assert.throws(() => validateUpload("large.pdf", Buffer.alloc(MAX_UPLOAD_BYTES + 1)));
});

test("account policy forbids warehouse accounts and ambiguous workshop assignments", () => {
  assert.throws(() => validatePassword("erp123456"));
  assert.throws(() => validatePassword("1234567890123"));
  assert.doesNotThrow(() => validatePassword("Example2026-safe"));
  const base = { employeeNo: "W1", username: "worker1", name: "测试", department: "板式", role: "WORKSHOP", level: "STAFF", workshop: "PANEL" };
  assert.throws(() => validateAccount(base));
  assert.equal(validateAccount({ ...base, processCode: "PANEL-01" }).processCode, "PANEL-01");
  assert.throws(() => validateAccount({ ...base, role: "WAREHOUSE" }));
});

test("mutation fingerprints are key-order independent and stale versions conflict", () => {
  assert.equal(mutationFingerprint({ b: 1, a: [2, 3] }), mutationFingerprint({ a: [2, 3], b: 1 }));
  const now = new Date("2026-08-30T00:00:00.000Z");
  assert.doesNotThrow(() => assertCurrentVersion(now, { expectedUpdatedAt: now.toISOString() }));
  assert.throws(() => assertCurrentVersion(now, { expectedUpdatedAt: "2026-08-29T00:00:00.000Z" }), /订单已被更新/);
});
