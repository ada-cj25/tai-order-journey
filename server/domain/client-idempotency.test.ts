import assert from "node:assert/strict";
import test from "node:test";
import { shouldReleaseIdempotencyKey } from "../../src/idempotency.js";

test("建单请求只在服务端明确成功后释放防重标识", () => {
  assert.equal(shouldReleaseIdempotencyKey({ ok: true }), true);
  assert.equal(shouldReleaseIdempotencyKey({ ok: false }), false);
});
