import assert from "node:assert/strict";
import test from "node:test";

const stack = ["/pages/workspace/index"];
let nav: Record<string, any> | undefined;
let salesPage: Record<string, any> | undefined;

(globalThis as any).wx = {
  getSystemInfoSync: () => ({ platform: "devtools" }),
  getStorageSync: () => undefined,
  redirectTo: ({ url }: { url: string }) => { stack[stack.length - 1] = url; },
  navigateTo: ({ url }: { url: string }) => { stack.push(url); },
  navigateBack: () => { if (stack.length > 1) stack.pop(); },
  reLaunch: ({ url }: { url: string }) => { stack.splice(0, stack.length, url); },
};
(globalThis as any).getCurrentPages = () => stack.map((route) => ({ route }));
(globalThis as any).Component = (definition: Record<string, any>) => { nav = definition; };
(globalThis as any).Page = (definition: Record<string, any>) => { salesPage = definition; };

await import("../components/bottom-nav/index.ts");
await import("../pages/sales-create/index.ts");

test("从底部新建进入建单页后，顶部返回回到原工作台", () => {
  assert.ok(nav && salesPage);
  stack.splice(0, stack.length, "/pages/workspace/index");
  nav.methods.navigate.call({ data: { active: "workspace" } }, { currentTarget: { dataset: { key: "sales-create", route: "/pages/sales-create/index" } } });
  assert.deepEqual(stack, ["/pages/workspace/index", "/pages/sales-create/index"]);
  salesPage.back();
  assert.deepEqual(stack, ["/pages/workspace/index"]);
});

test("建单页是页面栈根页时，返回仍可回到工作台", () => {
  assert.ok(salesPage);
  stack.splice(0, stack.length, "/pages/sales-create/index");
  salesPage.back();
  assert.deepEqual(stack, ["/pages/workspace/index"]);
});
