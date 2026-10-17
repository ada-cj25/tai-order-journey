import assert from "node:assert/strict";
import test from "node:test";

const stack = ["/pages/workspace/index"];
let bottomNav: Record<string, any> | undefined;
let shipmentPage: Record<string, any> | undefined;
let shipmentListPage: Record<string, any> | undefined;
let roleCenterPage: Record<string, any> | undefined;

(globalThis as any).wx = {
  getSystemInfoSync: () => ({ platform: "devtools" }),
  getStorageSync: () => undefined,
  redirectTo: ({ url }: { url: string }) => { stack[stack.length - 1] = url; },
  navigateTo: ({ url }: { url: string }) => { stack.push(url); },
  navigateBack: () => { if (stack.length > 1) stack.pop(); },
  reLaunch: ({ url }: { url: string }) => { stack.splice(0, stack.length, url); },
};
(globalThis as any).getCurrentPages = () => stack.map((route) => ({ route }));
(globalThis as any).Component = (definition: Record<string, any>) => { bottomNav = definition; };
(globalThis as any).Page = (definition: Record<string, any>) => { shipmentPage = definition; };

await import("../components/bottom-nav/index.ts");
await import("../pages/shipment/index.ts");
const registeredShipmentPage = shipmentPage;
await import("../pages/shipment-list/index.ts");
shipmentListPage = shipmentPage;
await import("../pages/role-center/index.ts");
roleCenterPage = shipmentPage;
shipmentPage = registeredShipmentPage;

test("底部发货入口打开订单列表，不会默认进入某个客户的表单", () => {
  assert.ok(bottomNav && shipmentListPage);
  stack.splice(0, stack.length, "/pages/workspace/index");
  bottomNav.methods.navigate.call({ data: { active: "workspace" } }, { currentTarget: { dataset: { key: "shipment", route: "/pages/shipment-list/index" } } });
  assert.deepEqual(stack, ["/pages/shipment-list/index"]);
});

test("从待办进入发货页后，顶部返回回到原页面", () => {
  assert.ok(shipmentPage);
  stack.splice(0, stack.length, "/pages/workspace/index");
  (globalThis as any).wx.navigateTo({ url: "/pages/shipment/index?orderId=TEST-DEMO-ZHOU-ORDER-001" });
  shipmentPage.back();
  assert.deepEqual(stack, ["/pages/workspace/index"]);
});

test("岗位工作区作为底部入口时也能返回工作台", () => {
  assert.ok(bottomNav && roleCenterPage);
  stack.splice(0, stack.length, "/pages/workspace/index");
  bottomNav.methods.navigate.call({ data: { active: "workspace" } }, { currentTarget: { dataset: { key: "role-center", route: "/pages/role-center/index?section=finance" } } });
  assert.deepEqual(stack, ["/pages/role-center/index?section=finance"]);
  roleCenterPage.back();
  assert.deepEqual(stack, ["/pages/workspace/index"]);
});
