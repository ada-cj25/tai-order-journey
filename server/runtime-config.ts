import { GoneException } from "@nestjs/common";

export function localTestAccountsEnabled(env: NodeJS.ProcessEnv = process.env) {
  if (![undefined, "development", "test"].includes(env.NODE_ENV) || env.LOCAL_TEST_ACCOUNTS_ENABLED === "false") return false;
  const local = (host: string) => ["localhost", "127.0.0.1", "[::1]"].includes(host);
  try {
    return local(new URL(env.DATABASE_URL ?? "").hostname)
      && local(new URL(env.WEB_ORIGIN ?? "http://127.0.0.1:5173").hostname);
  } catch { return false; }
}

export function costEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.COST_MODULE_ENABLED === "true" || (env.NODE_ENV !== "production" && env.COST_MODULE_ENABLED !== "false");
}

export function customerDemoEnabled(env: NodeJS.ProcessEnv = process.env) {
  if (env.CUSTOMER_DEMO_ENABLED !== "true" || env.NODE_ENV === "production" || env.APP_ENVIRONMENT === "company-test") return false;
  try {
    const database = new URL(env.DATABASE_URL ?? "");
    const web = new URL(env.WEB_ORIGIN ?? "http://127.0.0.1:5173");
    const loopback = (host: string) => ["localhost", "127.0.0.1", "[::1]"].includes(host);
    return loopback(database.hostname) && database.pathname === "/whole_house_erp_customer_demo"
      && loopback(web.hostname) && loopback(env.API_HOST ?? "127.0.0.1")
      && (env.ATTACHMENT_STORAGE ?? "local") === "local";
  } catch { return false; }
}

export function assertCostEnabled() {
  if (!costEnabled()) throw new GoneException("成本模块尚未验收开放；采购与生产不受影响");
}

export function runtimeConfig(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === "production";
  if (env.APP_ENVIRONMENT === "company-test" && (!production || env.COST_MODULE_ENABLED !== "true")) throw new Error("公司云测试环境必须使用生产安全配置并明确开启成本模块");
  const secret = env.SESSION_SECRET ?? "local-development-only";
  const origin = env.WEB_ORIGIN ?? "http://127.0.0.1:5173";
  const storage = env.ATTACHMENT_STORAGE ?? "local";
  const port = Number(env.API_PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("API_PORT 必须为有效端口");
  if (!["local", "cos"].includes(storage)) throw new Error("ATTACHMENT_STORAGE 必须为 local 或 cos");
  if (production) {
    if (env.MINI_PROGRAM_DEV_LOGIN_ENABLED === "true") throw new Error("生产环境禁止开启小程序模拟微信登录");
    if (secret.length < 32 || /replace|development|example|change_me/i.test(secret)) throw new Error("生产环境必须配置独立的至少32位 SESSION_SECRET");
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.origin !== origin || ["localhost", "127.0.0.1"].includes(url.hostname) || /\.(example|invalid)$/.test(url.hostname)) throw new Error("WEB_ORIGIN 必须为正式 HTTPS origin");
    if (storage !== "cos") throw new Error("生产环境必须使用私有 COS 附件存储");
    if (env.TZ !== "Asia/Shanghai") throw new Error("生产环境 TZ 必须为 Asia/Shanghai");
    if (env.MINI_PROGRAM_ENABLED === "true" && (!env.WECHAT_MINI_APP_ID?.trim() || !env.WECHAT_MINI_APP_SECRET?.trim())) throw new Error("开启小程序接口前必须配置微信 AppID 和 AppSecret");
  }
  if (storage === "cos" && ["COS_BUCKET", "COS_REGION", "COS_SECRET_ID", "COS_SECRET_KEY"].some((key) => !env[key])) throw new Error("COS 配置不完整");
  if (env.TRUST_PROXY_HOPS && !/^[01]$/.test(env.TRUST_PROXY_HOPS)) throw new Error("TRUST_PROXY_HOPS 仅支持0或1，入口代理必须覆盖转发头");
  return { production, secret, origin, storage, host: env.API_HOST ?? "127.0.0.1", port, trustProxy: env.TRUST_PROXY_HOPS === "1" ? 1 : false as const };
}
