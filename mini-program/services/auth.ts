import { runtime } from "../config/runtime";
import { clearSession, saveSession } from "../domain/store";
import type { MiniEmployee } from "../domain/types";
import { miniRequest, publicMiniRequest } from "./client";

type AuthResult = { employee: MiniEmployee; accessToken: string; refreshToken: string; accessExpiresAt: string; refreshExpiresAt: string };

type PublicConfig = { environment: string; localTestAccountsEnabled: boolean; miniProgramEnabled: boolean; miniProgramDevLoginEnabled: boolean };

function localDevCode(identity: string): string {
  const value = identity.trim();
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(value)) throw new Error("请填写3至32位英文、数字的本机测试身份");
  return `TEST-WX-LOCAL-${value.padEnd(20, "_")}`;
}

async function loginCode(devIdentity: string) {
  if (!runtime.localDevLogin) return wechatCode();
  const config = await publicMiniRequest<PublicConfig>("/api/v1/public/config");
  if (!config.miniProgramEnabled || !config.miniProgramDevLoginEnabled || !config.localTestAccountsEnabled || config.environment === "company-test") {
    throw new Error("本机 API 未启用隔离测试登录，请检查后端配置");
  }
  return localDevCode(devIdentity);
}

function wechatCode(): Promise<string> {
  return new Promise((resolve, reject) => wx.login({ success: (result) => result.code ? resolve(result.code) : reject(new Error("微信登录凭证获取失败")), fail: () => reject(new Error("微信登录失败")) }));
}

function persist(result: AuthResult) {
  saveSession(result.employee);
  wx.setStorageSync("tai-mini-access-token", result.accessToken);
  wx.setStorageSync("tai-mini-refresh-token", result.refreshToken);
  return result.employee;
}

export async function bindWithInvite(inviteCode: string, devIdentity = "") {
  if (runtime.mode !== "api") throw new Error("本地模拟请直接选择测试账号");
  const result = await publicMiniRequest<AuthResult>("/api/v1/mini/auth/bind", { method: "POST", body: { code: await loginCode(devIdentity), inviteCode: inviteCode.trim() } });
  return persist(result);
}

export async function loginWithWechat(devIdentity = "") {
  if (runtime.mode !== "api") throw new Error("本地模拟请直接选择测试账号");
  const result = await publicMiniRequest<AuthResult>("/api/v1/mini/auth/login", { method: "POST", body: { code: await loginCode(devIdentity) } });
  return persist(result);
}

export async function logoutMini() {
  if (runtime.mode === "api" && wx.getStorageSync<string>("tai-mini-access-token")) {
    try { await miniRequest<{ ok: boolean }>("/api/v1/mini/auth/logout", { method: "POST" }); } catch { /* Local cleanup is still required. */ }
  }
  clearSession();
}
