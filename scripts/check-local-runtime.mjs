const checks = [
  { name: "ERP 页面", url: "http://127.0.0.1:5173/", expected: [200] },
  { name: "ERP API", url: "http://127.0.0.1:3000/api/v1/auth/employees", expected: [401] },
];

let failed = false;
for (const check of checks) {
  try {
    const response = await fetch(check.url, { redirect: "manual", signal: AbortSignal.timeout(3000) });
    const ok = check.expected.includes(response.status);
    console.log(`${ok ? "正常" : "异常"}：${check.name}（HTTP ${response.status}）`);
    failed ||= !ok;
  } catch (error) {
    console.error(`异常：${check.name}（${error instanceof Error ? error.message : "无法连接"}）`);
    failed = true;
  }
}

if (failed) process.exitCode = 1;
