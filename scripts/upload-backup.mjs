import COS from "cos-nodejs-sdk-v5";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少 ${name}`);
  return value;
}

const backupRoot = resolve("/backups");
const backupFile = resolve(required("BACKUP_FILE"));
if (!backupFile.startsWith(`${backupRoot}/`)) throw new Error("备份文件必须位于 /backups 内");
const fileName = basename(backupFile);
if (!/^tai_erp_\d{8}T\d{6}Z_[a-f0-9]{8}\.dump$/.test(fileName)) throw new Error("备份文件名不符合受控格式");

const fileInfo = await stat(backupFile);
if (!fileInfo.isFile() || fileInfo.size < 1) throw new Error("备份文件为空或不是普通文件");

const hash = createHash("sha256");
for await (const chunk of createReadStream(backupFile)) hash.update(chunk);
const sha256 = hash.digest("hex");
const match = fileName.match(/^tai_erp_(\d{4})(\d{2})(\d{2})T/);
const objectKey = `postgresql/${match[1]}/${match[2]}/${match[3]}/${fileName}`;
const database = process.env.BACKUP_DATABASE_NAME?.trim() || "tai_erp";
const createdAt = new Date().toISOString();
const manifest = Buffer.from(`${JSON.stringify({ schemaVersion: 1, objectKey, database, createdAt, size: fileInfo.size, sha256, format: "pg_dump-custom" }, null, 2)}\n`);

const client = new COS({
  SecretId: required("BACKUP_COS_SECRET_ID"),
  SecretKey: required("BACKUP_COS_SECRET_KEY"),
  Protocol: "https:",
  Timeout: 120_000,
});
const common = { Bucket: required("BACKUP_COS_BUCKET"), Region: required("BACKUP_COS_REGION") };
const invoke = (method, params) => new Promise((resolvePromise, rejectPromise) => {
  client[method](params, (error, data) => error ? rejectPromise(error) : resolvePromise(data));
});

await invoke("putObject", {
  ...common,
  Key: objectKey,
  Body: createReadStream(backupFile),
  ContentLength: fileInfo.size,
  ContentType: "application/octet-stream",
  ACL: "private",
  ServerSideEncryption: "AES256",
});
await invoke("putObject", {
  ...common,
  Key: `${objectKey}.json`,
  Body: manifest,
  ContentLength: manifest.length,
  ContentType: "application/json; charset=utf-8",
  ACL: "private",
  ServerSideEncryption: "AES256",
});
const head = await invoke("headObject", { ...common, Key: objectKey });
if (Number(head.headers?.["content-length"]) !== fileInfo.size) throw new Error("COS 上传后大小校验失败");

console.log(JSON.stringify({ ok: true, objectKey, database, createdAt, size: fileInfo.size, sha256 }));
