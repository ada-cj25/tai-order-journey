import COS from "cos-nodejs-sdk-v5";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, rename, stat, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, resolve } from "node:path";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少 ${name}`);
  return value;
}

const objectKey = required("BACKUP_OBJECT_KEY");
if (!/^postgresql\/\d{4}\/\d{2}\/\d{2}\/tai_erp_\d{8}T\d{6}Z_[a-f0-9]{8}\.dump$/.test(objectKey)) throw new Error("备份对象键不符合受控格式");
const restoreRoot = resolve("/backups/restores");
const output = resolve(required("RESTORE_FILE"));
if (!output.startsWith(`${restoreRoot}/`) || basename(output) !== basename(objectKey)) throw new Error("恢复文件必须位于 /backups/restores 且保留原名");
await mkdir(dirname(output), { recursive: true });
await access(output).then(() => { throw new Error("目标恢复文件已存在，拒绝覆盖"); }).catch((error) => {
  if (error?.code !== "ENOENT") throw error;
});

const client = new COS({ SecretId: required("BACKUP_COS_SECRET_ID"), SecretKey: required("BACKUP_COS_SECRET_KEY"), Protocol: "https:", Timeout: 120_000 });
const common = { Bucket: required("BACKUP_COS_BUCKET"), Region: required("BACKUP_COS_REGION") };
const invoke = (method, params) => new Promise((resolvePromise, rejectPromise) => {
  client[method](params, (error, data) => error ? rejectPromise(error) : resolvePromise(data));
});

const manifestResult = await invoke("getObject", { ...common, Key: `${objectKey}.json` });
const manifest = JSON.parse(Buffer.from(manifestResult.Body).toString("utf8"));
if (manifest.objectKey !== objectKey || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error("COS 备份清单无效");

const temporary = `${output}.partial`;
try {
  await invoke("getObject", { ...common, Key: objectKey, Output: createWriteStream(temporary, { flags: "wx", mode: 0o600 }) });
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(temporary)) hash.update(chunk);
  const sha256 = hash.digest("hex");
  if (sha256 !== manifest.sha256) throw new Error("COS 备份 SHA-256 校验失败");
  await rename(temporary, output);
  if ((await stat(output)).size !== Number(manifest.size)) throw new Error("COS 备份大小与清单不一致");
  console.log(JSON.stringify({ ok: true, objectKey, output, database: manifest.database, createdAt: manifest.createdAt, size: manifest.size, sha256 }));
} catch (error) {
  await unlink(temporary).catch(() => undefined);
  throw error;
}
