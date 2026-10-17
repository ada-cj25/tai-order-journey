// 比较同一名销售在小程序与桌面 API 中可见的订单 ID，不修改订单。
const origin = "http://127.0.0.1:3000";
const username = process.env.MINI_SMOKE_SALES_USER || "noerlisales1";
const password = process.env.MINI_SMOKE_SALES_PASSWORD || "erp123456";
const identity = process.env.MINI_SMOKE_IDENTITY || "sales02";

async function call(path, { method = "GET", body, cookie, token } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...(token ? { authorization: `Bearer ${token}`, "x-client": "mini" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${JSON.stringify(data)}`);
  return { data, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

const { data: config } = await call("/api/v1/public/config");
if (config.environment !== "development" || !config.localTestAccountsEnabled || !config.miniProgramDevLoginEnabled) throw new Error("仅允许本机隔离测试环境");
const { data: desktopLogin, cookie } = await call("/api/v1/auth/login", { method: "POST", body: { username, password } });
if (desktopLogin.employee.role !== "SALES" || !cookie) throw new Error("需要同一名销售的桌面会话");
const { data: mobileLogin } = await call("/api/v1/mini/auth/login", { method: "POST", body: { code: `TEST-WX-LOCAL-${identity.padEnd(20, "_")}` } });
if (mobileLogin.employee.id !== desktopLogin.employee.id) throw new Error("两个终端登录的不是同一名员工");
const { data: desktopOrders } = await call("/api/v1/orders?pageSize=100", { cookie });
const { data: miniOrders } = await call("/api/v1/mini/orders", { token: mobileLogin.accessToken });
const desktopIds = new Set(desktopOrders.items.map((item) => item.id));
const miniIds = new Set(miniOrders.map((item) => item.id));
if (desktopOrders.total !== miniOrders.length || desktopIds.size !== miniIds.size || [...miniIds].some((id) => !desktopIds.has(id))) {
  throw new Error(`跨端订单范围不一致：桌面 ${desktopOrders.total} 单，小程序 ${miniOrders.length} 单`);
}
const trackingSerial = process.env.MINI_SMOKE_TRACKING_SERIAL;
let checkedOrder;
if (trackingSerial) {
  const summary = miniOrders.find((order) => order.trackingSerial === trackingSerial);
  if (!summary) throw new Error(`小程序订单中找不到 ${trackingSerial}`);
  const [{ data: desktopDetail }, { data: miniDetail }] = await Promise.all([
    call(`/api/v1/orders/${encodeURIComponent(summary.id)}`, { cookie }),
    call(`/api/v1/mini/orders/${encodeURIComponent(summary.id)}`, { token: mobileLogin.accessToken }),
  ]);
  const desktopDue = desktopDetail.currentTask?.dueAt ?? desktopDetail.internalDueAt;
  if (new Date(miniDetail.currentTaskDueAt).getTime() !== new Date(desktopDue).getTime()) {
    throw new Error(`当前任务截止不一致：网页 ${desktopDue}，小程序 ${miniDetail.currentTaskDueAt}`);
  }
  checkedOrder = { trackingSerial, stage: miniDetail.stageLabel, currentTaskDueAt: miniDetail.currentTaskDueAt };
}
console.log(JSON.stringify({ ok: true, employee: mobileLogin.employee.name, sharedOrders: miniOrders.length, sameIds: true, ...(checkedOrder ? { checkedOrder } : {}) }));
