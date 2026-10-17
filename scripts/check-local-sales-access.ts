import assert from 'node:assert/strict';
import { LOCAL_SALES } from '../server/domain/local-sales-roster.js';

const base = 'http://127.0.0.1:3000/api/v1';
assert.equal((await fetch(`${base}/public/config`).then(r => r.json())).localTestAccountsEnabled, true, '仅限本地非生产验收');
async function login(username: string) {
  const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'erp123456' }) });
  const result = await response.json();
  assert.equal(response.status, 201, `${username} 测试登录失败；不会重置密码`);
  return { employee: result.employee, headers: { Cookie: response.headers.get('set-cookie')!.split(';')[0], 'x-csrf-token': result.csrfToken } };
}
async function orders(headers: Record<string, string>) {
  const items: any[] = [];
  for (let page = 1; ; page++) {
    const response = await fetch(`${base}/orders?pageSize=100&page=${page}`, { headers });
    assert.equal(response.status, 200);
    const data = await response.json(); items.push(...data.items);
    if (items.length >= data.total) return items;
  }
}
async function logout(headers: Record<string, string>) { await fetch(`${base}/auth/logout`, { method: 'POST', headers }); }
const admin = await login('chairman');
let all: any[];
try { all = await orders(admin.headers); } finally { await logout(admin.headers); }
for (const account of [{ username: 'salesmanager', businessUnit: 'NOERLI' }, { username: 'aikejumgr', businessUnit: 'AIKEJU' }, ...LOCAL_SALES]) {
  const session = await login(account.username);
  try {
    assert.equal(session.employee.businessUnit, account.businessUnit);
    const manager = session.employee.level === 'SUPERVISOR';
    const expected = all.filter(o => o.businessType.startsWith(`${account.businessUnit}_`) && (manager || o.salesId === session.employee.id));
    const actual = await orders(session.headers);
    assert.deepEqual(actual.map(o => o.id).sort(), expected.map(o => o.id).sort(), `${account.username} 列表范围`);
    assert.ok(actual.length > 0);
    for (const item of LOCAL_SALES) {
      const sample = all.find(o => o.trackingSerial === `TEST-SALES-${item.businessUnit}-${item.employeeNo}`);
      assert.ok(sample, `${item.username} 独立测试订单存在`);
      const visible = expected.some(o => o.id === sample.id);
      const response = await fetch(`${base}/orders/${sample.id}`, { headers: session.headers });
      assert.equal(response.status, visible ? 200 : 404, `${account.username} → ${item.username} 详情范围`);
    }
    const otherUnit = account.businessUnit === 'NOERLI' ? 'AIKEJU' : 'NOERLI';
    const rejected = await fetch(`${base}/orders`, { method: 'POST', headers: { ...session.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ businessType: `${otherUnit}_FORMAL` }) });
    assert.equal(rejected.status, 403, '跨品牌建单必须由服务器拒绝');
    console.log(JSON.stringify({ username: account.username, businessUnit: account.businessUnit, level: session.employee.level, visibleOrders: actual.length, status: 'PASS' }));
  } finally { await logout(session.headers); }
}
