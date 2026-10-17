import assert from "node:assert/strict";
import { LOCAL_WORKERS } from "../server/domain/local-worker-roster.js";

// Real authentication + read-only projections. Never submits a production report.
const base = "http://127.0.0.1:3000";
const config = await fetch(`${base}/api/v1/public/config`).then((response) => response.json());
assert.equal(config.localTestAccountsEnabled, true, "仅允许本地非生产账号验收");
for (const worker of LOCAL_WORKERS) {
  const response = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: worker.username, password: "erp123456" }) });
  const login = await response.json();
  assert.equal(response.status, 201, `${worker.username} 无法用测试密码登录（不会重置已有密码）`);
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  const headers = { Cookie: cookie, "x-csrf-token": login.csrfToken };
  try {
    assert.deepEqual(login.employee.processCodes, worker.processCodes);
    const listResponse = await fetch(`${base}/api/v1/orders?search=GD-260829-M001`, { headers });
    assert.equal(listResponse.status, 200);
    const list = await listResponse.json();
    const order = list.items.find((item: { trackingSerial: string }) => item.trackingSerial === "GD-260829-M001");
    assert.ok(order, "本地采购联调样例应可见");
    const detail = await fetch(`${base}/api/v1/orders/${order.id}`, { headers }).then((result) => result.json());
    const allowed = detail.production.processes.filter((process: { canReport: boolean }) => process.canReport).map((process: { processCode: string }) => process.processCode).sort();
    assert.deepEqual(allowed, [...worker.processCodes].sort());
    console.log(`${worker.username}: 登录成功，服务端仅授权 ${allowed.join("、")}`);
  } finally {
    await fetch(`${base}/api/v1/auth/logout`, { method: "POST", headers });
  }
}
