import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("订单发货批次按发货日期、同日登记时刻倒序排列", async () => {
  const service = await readFile(new URL("../server/orders.service.ts", import.meta.url), "utf8");
  const orderings = service.match(/shipments:\s*\{[^\n]*orderBy:\s*\[\{ deliveredAt: "desc" \}, \{ createdAt: "desc" \}\]/g) ?? [];
  assert.equal(orderings.length, 2);
});

test("发货日期与服务器登记时刻分开标明", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /发货日期 \/ 登记时间/);
  assert.match(app, /登记：\{formatShipmentRegistrationTime\(shipment\.createdAt\)\}/);
});
