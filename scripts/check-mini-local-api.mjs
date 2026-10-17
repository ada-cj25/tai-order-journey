// 本机联调检查：使用现有测试员工，只写入一条随后清理的移动草稿。
const origin = "http://127.0.0.1:3000";
const username = process.env.MINI_SMOKE_ADMIN_USER || "chairman";
const password = process.env.MINI_SMOKE_ADMIN_PASSWORD || "erp123456";
const identity = process.env.MINI_SMOKE_IDENTITY || "sales01";

async function call(path, { method = "GET", body, cookie, csrf, token } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { "x-csrf-token": csrf } : {}),
      ...(token ? { authorization: `Bearer ${token}`, "x-client": "mini" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

function expect(result, status, label) {
  if (result.status !== status) throw new Error(`${label}失败：HTTP ${result.status} ${JSON.stringify(result.data)}`);
  return result.data;
}

const config = expect(await call("/api/v1/public/config"), 200, "读取环境");
if (config.environment !== "development" || !config.localTestAccountsEnabled || !config.miniProgramEnabled || !config.miniProgramDevLoginEnabled) {
  throw new Error("仅允许本机开发环境、测试库和模拟微信登录开关全部开启后运行");
}

const adminLogin = await call("/api/v1/auth/login", { method: "POST", body: { username, password } });
const admin = expect(adminLogin, 201, "管理员登录");
if (admin.employee.role !== "CHAIRMAN" || !adminLogin.cookie || !admin.csrfToken) throw new Error("需要本机董事长管理员桌面会话");
const desktop = { cookie: adminLogin.cookie, csrf: admin.csrfToken };
const employees = expect(await call("/api/v1/admin/mini-program/employees", desktop), 200, "员工列表");
const sales = employees.find((item) => item.role === "SALES" && item.level !== "SUPERVISOR" && item.bindingStatus === "UNBOUND" && item.name.includes("诺尔丽"))
  ?? employees.find((item) => item.role === "SALES" && item.level !== "SUPERVISOR" && item.bindingStatus === "UNBOUND");
if (!sales) throw new Error("没有可绑定的未绑定销售测试账号；请在网页端检查初始密码和绑定状态");

const invite = expect(await call(`/api/v1/admin/mini-program/employees/${sales.id}/invite`, { ...desktop, method: "POST" }), 201, "创建邀请码");
const code = `TEST-WX-LOCAL-${identity.padEnd(20, "_")}`;
const bound = expect(await call("/api/v1/mini/auth/bind", { method: "POST", body: { code, inviteCode: invite.inviteCode } }), 201, "移动绑定");
const token = bound.accessToken;
const mobile = { token };
const workspace = expect(await call("/api/v1/mini/workspace", mobile), 200, "移动工作台");
const references = expect(await call("/api/v1/mini/reference-data", mobile), 200, "建单选项");
const orders = expect(await call("/api/v1/mini/orders", mobile), 200, "移动订单列表");
if (workspace.employee.id !== sales.id || !references.businessTypes.includes(`${bound.employee.businessUnit}_FORMAL`) || !Array.isArray(orders)) {
  throw new Error("移动员工身份、订单类型或订单列表与服务端不一致");
}

const probe = `LOCAL-MINI-API-${Date.now()}`;
expect(await call("/api/v1/mini/drafts/SALES_ORDER/NEW", { ...mobile, method: "POST", body: { payload: { probe } } }), 201, "保存移动草稿");
const draft = expect(await call("/api/v1/mini/drafts/SALES_ORDER/NEW", mobile), 200, "回读移动草稿");
if (draft.payload?.probe !== probe) throw new Error("移动草稿未从数据库回读");
expect(await call("/api/v1/mini/drafts/SALES_ORDER/NEW/clear", { ...mobile, method: "POST" }), 201, "清理移动草稿");
expect(await call("/api/v1/mini/payment-accounts", mobile), 403, "销售越权拦截");
expect(await call("/api/v1/mini/auth/logout", { ...mobile, method: "POST" }), 201, "退出移动会话");

console.log(JSON.stringify({ ok: true, employee: sales.name, identity, ordersVisible: orders.length, businessTypes: references.businessTypes, paymentAccounts: references.paymentAccounts.length, designers: references.designers.length, draftPersistedAndCleared: true, salesForbiddenFromFinance: true }));
