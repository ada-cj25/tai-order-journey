import { assertSafeRuntime, runtime } from "../config/runtime";
import { clearSession, saveSession } from "../domain/store";
import type { MiniEmployee } from "../domain/types";

type RequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  idempotencyKey?: string;
  expectedUpdatedAt?: string;
  timeoutMs?: number;
};

function request<T>(path: string, options: RequestOptions, token?: string): Promise<T> {
  assertSafeRuntime();
  if (runtime.mode !== "api") return Promise.reject(new Error("模拟模式不得调用真实接口"));
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${runtime.apiBaseUrl}${path}`,
      method: options.method ?? "GET",
      data: options.body,
      timeout: options.timeoutMs,
      header: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "X-Client": "mini",
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
        ...(options.expectedUpdatedAt ? { "X-Expected-Updated-At": options.expectedUpdatedAt } : {}),
      },
      success: (response: { statusCode: number; data: T | { message?: string } }) => {
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data as T);
        else reject(Object.assign(new Error((response.data as { message?: string }).message ?? `请求失败（${response.statusCode}）`), { statusCode: response.statusCode }));
      },
      fail: () => reject(new Error("网络不可用，请稍后重试")),
    });
  });
}

type RefreshResult = { employee: MiniEmployee; accessToken: string; refreshToken: string; accessExpiresAt: string; refreshExpiresAt: string };
let refreshing: Promise<string> | null = null;

function refreshAccessToken() {
  if (refreshing) return refreshing;
  const refreshToken = wx.getStorageSync<string>("tai-mini-refresh-token");
  if (!refreshToken) return Promise.reject(new Error("移动会话已过期，请重新登录"));
  refreshing = request<RefreshResult>("/api/v1/mini/auth/refresh", { method: "POST", body: { refreshToken } })
    .then((result) => {
      saveSession(result.employee);
      wx.setStorageSync("tai-mini-access-token", result.accessToken);
      wx.setStorageSync("tai-mini-refresh-token", result.refreshToken);
      return result.accessToken;
    })
    .catch((error) => {
      clearSession();
      throw error;
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}

export function publicMiniRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return request<T>(path, options);
}

export function miniRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = wx.getStorageSync<string>("tai-mini-access-token");
  if (!token) return Promise.reject(new Error("移动会话不存在，请重新登录"));
  return request<T>(path, options, token).catch(async (error: Error & { statusCode?: number }) => {
    if (error.statusCode !== 401 || path.endsWith("/auth/logout")) throw error;
    try { return await request<T>(path, options, await refreshAccessToken()); }
    catch (retryError) { wx.reLaunch({ url: "/pages/login/index" }); throw retryError; }
  });
}

export function miniUpload<T>(path: string, filePath: string, formData: Record<string, string>): Promise<T> {
  assertSafeRuntime();
  if (runtime.mode !== "api") return Promise.reject(new Error("模拟模式不得调用真实上传接口"));
  const token = wx.getStorageSync<string>("tai-mini-access-token");
  if (!token) return Promise.reject(new Error("移动会话不存在，请重新登录"));

  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${runtime.apiBaseUrl}${path}`,
      filePath,
      name: "file",
      formData,
      header: { Authorization: `Bearer ${token}`, "X-Client": "mini" },
      success: (response: { statusCode: number; data: string }) => {
        let data: T | { message?: string };
        try { data = JSON.parse(response.data) as T | { message?: string }; }
        catch { reject(new Error("附件接口返回了无法识别的数据")); return; }
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(data as T);
        else reject(new Error((data as { message?: string }).message ?? `上传失败（${response.statusCode}）`));
      },
      fail: () => reject(new Error("网络不可用，照片仍保留在本机，请稍后重试")),
    });
  });
}

export function miniDownload(path: string): Promise<string> {
  assertSafeRuntime();
  if (runtime.mode !== "api") return Promise.reject(new Error("模拟模式没有真实附件"));
  const token = wx.getStorageSync<string>("tai-mini-access-token");
  if (!token) return Promise.reject(new Error("移动会话不存在，请重新登录"));
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: `${runtime.apiBaseUrl}${path}`,
      header: { Authorization: `Bearer ${token}`, "X-Client": "mini" },
      success: (response: { statusCode: number; tempFilePath: string }) => {
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.tempFilePath);
        else reject(new Error(`附件读取失败（${response.statusCode}）`));
      },
      fail: () => reject(new Error("网络不可用，无法读取附件")),
    });
  });
}
