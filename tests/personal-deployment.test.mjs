import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("personal compose only publishes the Caddy HTTPS entry", async () => {
  const compose = await read("deploy/personal/compose.yaml");
  const db = compose.match(/\n  db:\n([\s\S]*?)\n  api:/)?.[1] ?? "";
  const api = compose.match(/\n  api:\n([\s\S]*?)\n  web:/)?.[1] ?? "";
  assert.doesNotMatch(db, /\n\s+ports:/);
  assert.doesNotMatch(api, /\n\s+ports:/);
  assert.match(compose, /ports: \["80:80", "443:443"\]/);
  assert.match(compose, /pg_data:\/var\/lib\/postgresql\/data/);
  assert.match(compose, /COST_MODULE_ENABLED: "false"/);
  assert.match(compose, /ERP_BACKUP_ENV_FILE/);
});

test("production examples fail closed around HTTPS, COS, digests and cost", async () => {
  const [runtime, release] = await Promise.all([
    read("deploy/personal/runtime.env.example"),
    read("deploy/personal/release.env.example"),
  ]);
  assert.match(runtime, /WEB_ORIGIN=https:\/\/taigenlvcheng\.cn/);
  assert.match(runtime, /ATTACHMENT_STORAGE=cos/);
  assert.match(runtime, /COST_MODULE_ENABLED=false/);
  assert.match(runtime, /AMAP_WEATHER_API_KEY=CHANGE_ME_TO_APPROVED_WEB_SERVICE_KEY/);
  assert.match(runtime, /ICP_FILING_NUMBER=/);
  assert.doesNotMatch(runtime, /ATTACHMENT_STORAGE=local/);
  assert.equal((release.match(/@sha256:/g) ?? []).length, 5);
  assert.doesNotMatch(release, /:latest/);
});

test("company cloud test has its own release, isolated bootstrap, and explicit cost override", async () => {
  const [override, release, runtime, bootstrap] = await Promise.all([
    read("deploy/company-test/compose.override.yaml"),
    read("deploy/company-test/release.env.example"),
    read("deploy/company-test/runtime.env.example"),
    read("deploy/company-test/bootstrap.example.json"),
  ]);
  assert.match(override, /APP_ENVIRONMENT: company-test/);
  assert.match(override, /COST_MODULE_ENABLED: "true"/);
  assert.match(override, /LOCAL_TEST_ACCOUNTS_ENABLED: "false"/);
  assert.doesNotMatch(override, /\bports:/);
  assert.match(release, /DEPLOYMENT_NAME=tai-erp-company-test/);
  assert.match(release, /\/etc\/tai-erp\/company-test\//);
  assert.match(runtime, /NODE_ENV=production/);
  assert.match(runtime, /ATTACHMENT_STORAGE=cos/);
  assert.match(runtime, /WEB_ORIGIN=https:\/\//);
  assert.equal(JSON.parse(bootstrap).environment, "company-test");
});

test("Caddy keeps web and API on one origin with automatic HTTPS", async () => {
  const caddy = await read("deploy/personal/Caddyfile");
  assert.match(caddy, /^\{[\s\S]*admin off/m);
  assert.match(caddy, /\{\$ERP_HOST\}/);
  assert.match(caddy, /www\.\{\$ERP_HOST\}/);
  assert.match(caddy, /@api path \/api\/\*/);
  assert.match(caddy, /reverse_proxy api:3000/);
  assert.match(caddy, /try_files \{path\} \/index\.html/);
});

test("backup tooling records integrity and schedules four six-hour runs", async () => {
  const [uploader, downloader, timer, compose, backupScript, restoreScript] = await Promise.all([
    read("scripts/upload-backup.mjs"),
    read("scripts/download-backup.mjs"),
    read("deploy/personal/tai-erp-backup.timer.example"),
    read("deploy/personal/compose.yaml"),
    read("deploy/personal/backup.sh"),
    read("deploy/personal/restore-drill.sh"),
  ]);
  assert.match(uploader, /createHash\("sha256"\)/);
  assert.match(uploader, /ServerSideEncryption: "AES256"/);
  assert.match(downloader, /SHA-256 校验失败/);
  assert.match(timer, /OnCalendar=\*-\*-\* 00,06,12,18:15:00/);
  assert.match(compose, /source: \$\{ERP_BACKUP_DIRECTORY/);
  assert.match(backupScript, /chown 10001:10001 "\$final"/);
  assert.match(restoreScript, /chown 10001:10001 "\$ERP_BACKUP_DIRECTORY\/restores"/);
});

test("Dockerfile keeps legacy Sites handoff and adds personal release targets", async () => {
  const dockerfile = await read("Dockerfile");
  assert.match(dockerfile, /FROM node:24-bookworm-slim AS api/);
  assert.match(dockerfile, /FROM node:24-bookworm-slim AS backup-tool/);
  assert.match(dockerfile, /FROM node:24-bookworm-slim AS backup-tool[\s\S]*?USER 10001:10001/);
  assert.match(dockerfile, /FROM caddy:2-alpine AS personal-web/);
  assert.match(dockerfile, /FROM nginx:stable-alpine AS web/);
  assert.match(dockerfile, /scripts\/prepare-sites-build\.mjs/);
});
