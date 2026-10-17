import assert from "node:assert/strict";
import test from "node:test";
import { localTestAccountsEnabled } from "../runtime-config.js";
import { showLocalTestAccounts } from "../../src/local-test-access.js";

test("local account helpers stay unavailable for production, remote databases and invalid config", () => {
  const local = { DATABASE_URL: "postgresql://127.0.0.1/local_test", WEB_ORIGIN: "http://localhost:5173" };
  assert.equal(localTestAccountsEnabled(local), true);
  assert.equal(localTestAccountsEnabled({ ...local, NODE_ENV: "test" }), true);
  assert.equal(localTestAccountsEnabled({ ...local, NODE_ENV: "production", LOCAL_TEST_ACCOUNTS_ENABLED: "true" }), false);
  assert.equal(localTestAccountsEnabled({ ...local, NODE_ENV: "staging" }), false);
  assert.equal(localTestAccountsEnabled({ ...local, DATABASE_URL: "postgresql://db.example.com/live" }), false);
  assert.equal(localTestAccountsEnabled({ ...local, WEB_ORIGIN: "https://erp.example.com" }), false);
  assert.equal(localTestAccountsEnabled({ ...local, LOCAL_TEST_ACCOUNTS_ENABLED: "false" }), false);
  assert.equal(localTestAccountsEnabled({}), false);
});

test("the local account picker requires dev build, backend approval, loopback and desktop together", () => {
  const local = { devBuild: true, backendEnabled: true, hostname: "localhost", mobileReadonly: false };
  assert.equal(showLocalTestAccounts(local), true);
  assert.equal(showLocalTestAccounts({ ...local, hostname: "127.0.0.1" }), true);
  assert.equal(showLocalTestAccounts({ ...local, hostname: "[::1]" }), true);
  assert.equal(showLocalTestAccounts({ ...local, devBuild: false }), false);
  assert.equal(showLocalTestAccounts({ ...local, backendEnabled: undefined }), false);
  assert.equal(showLocalTestAccounts({ ...local, hostname: "localhost.evil.example" }), false);
  assert.equal(showLocalTestAccounts({ ...local, hostname: "192.168.1.1" }), false);
  assert.equal(showLocalTestAccounts({ ...local, mobileReadonly: true }), false);
});
