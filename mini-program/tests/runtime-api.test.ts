import assert from "node:assert/strict";
import test from "node:test";

const storage = new Map<string, unknown>();
let platform = "devtools";
(globalThis as typeof globalThis & { wx: unknown }).wx = {
  getSystemInfoSync: () => ({ platform }),
  getStorageSync: (key: string) => storage.get(key),
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
};

const { runtime, selectLocalApiTest, assertSafeRuntime } = await import("../config/runtime.ts");

test("本机 API 联调须显式开启且仅在开发者工具模拟器可请求", () => {
  assert.equal(runtime.mode, "mock");
  selectLocalApiTest(true);
  assert.equal(runtime.mode, "api");
  assert.equal(runtime.apiBaseUrl, "http://127.0.0.1:3000");
  assert.doesNotThrow(assertSafeRuntime);
  platform = "ios";
  assert.throws(assertSafeRuntime, /仅允许开发者工具/);
  assert.throws(() => selectLocalApiTest(false), /仅能在开发者工具/);
  platform = "devtools";
  selectLocalApiTest(false);
  assert.equal(runtime.mode, "mock");
});
