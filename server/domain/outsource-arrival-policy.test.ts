import assert from "node:assert/strict";
import test from "node:test";
import { canManageOutsourceArrivals } from "./outsource-arrival-policy.js";

test("外购成品到货由订单管理员登记，董事长保留覆盖权限", () => {
  assert.equal(canManageOutsourceArrivals("ORDER_ADMIN"), true);
  assert.equal(canManageOutsourceArrivals("CHAIRMAN"), true);
  assert.equal(canManageOutsourceArrivals("PROCUREMENT"), false);
  assert.equal(canManageOutsourceArrivals("FINANCE"), false);
});
