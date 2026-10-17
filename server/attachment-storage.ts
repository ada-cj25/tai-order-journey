import COS from "cos-nodejs-sdk-v5";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { PassThrough } from "node:stream";

export class AttachmentStorage {
  private root = resolve(process.env.UPLOAD_ROOT ?? "server/uploads");
  private cos?: COS;
  private client() {
    if (!process.env.COS_BUCKET || !process.env.COS_REGION || !process.env.COS_SECRET_ID || !process.env.COS_SECRET_KEY) throw new Error("COS 配置不完整");
    return this.cos ??= new COS({ SecretId: process.env.COS_SECRET_ID, SecretKey: process.env.COS_SECRET_KEY, Protocol: "https:", Timeout: 30_000 });
  }
  private params(key: string) { return { Bucket: process.env.COS_BUCKET!, Region: process.env.COS_REGION!, Key: key }; }
  private localPath(key: string) {
    if (!/^[a-zA-Z0-9_-]+\.[a-z0-9]+$/.test(key)) throw new Error("无效附件存储键");
    return join(this.root, key);
  }
  async put(provider: string, key: string, buffer: Buffer, mimeType: string) {
    if (provider === "cos") {
      await this.client().putObject({ ...this.params(key), Body: buffer, ContentLength: buffer.length, ContentType: mimeType, ACL: "private" });
    } else if (provider === "local") {
      await mkdir(this.root, { recursive: true });
      await writeFile(this.localPath(key), buffer, { flag: "wx", mode: 0o600 });
    } else throw new Error("未知附件存储类型");
  }
  async read(provider: string, key: string): Promise<Buffer> {
    if (provider === "local") return readFile(this.localPath(key));
    if (provider !== "cos") throw new Error("未知附件存储类型");
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    let size = 0;
    output.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 40 * 1024 * 1024) output.destroy(new Error("附件超过读取上限"));
      else chunks.push(chunk);
    });
    const done = new Promise<void>((resolve, reject) => { output.on("end", resolve); output.on("error", reject); });
    await Promise.all([this.client().getObject({ ...this.params(key), Output: output }), done]);
    return Buffer.concat(chunks);
  }
}
