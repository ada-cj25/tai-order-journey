export type RuntimeMode = "mock" | "api";
export type MockWeatherMode = "sunny" | "rainy";
export type RuntimeProfile = "mock" | "local-api" | "company-test-api";

// 打包默认保留纯模拟；开发者工具登录页可显式开启本机 API 联调。
// 公司云测试取得正式 AppID 后，另行把此值改为 company-test-api 并重新打包验收。
export const packagedProfile = "mock" as RuntimeProfile;
const localApiKey = "tai-dev-local-api-enabled";

function isDevtools() {
  return typeof wx !== "undefined" && wx.getSystemInfoSync?.().platform === "devtools";
}

export let runtimeProfile: RuntimeProfile = packagedProfile === "mock" && isDevtools() && wx.getStorageSync(localApiKey) === true
  ? "local-api" : packagedProfile;

function configuration(profile: RuntimeProfile) {
  return {
    mode: (profile === "mock" ? "mock" : "api") as RuntimeMode,
    mockWeatherMode: "sunny" as MockWeatherMode,
    apiBaseUrl: profile === "local-api" ? "http://127.0.0.1:3000" : profile === "company-test-api" ? "https://taifollow.cn" : "",
    productionEnabled: profile === "company-test-api",
    localDevLogin: profile === "local-api",
    webViewEnabled: false,
    webBaseUrl: "",
  };
}

export const runtime = configuration(runtimeProfile);

export function selectLocalApiTest(enabled: boolean) {
  if (packagedProfile !== "mock" || !isDevtools()) throw new Error("本机 API 联调仅能在开发者工具模拟器开启");
  wx.setStorageSync(localApiKey, enabled);
  runtimeProfile = enabled ? "local-api" : "mock";
  Object.assign(runtime, configuration(runtimeProfile));
}

export function assertSafeRuntime() {
  if (runtime.mode !== "api") return;
  if (runtime.localDevLogin && runtime.apiBaseUrl === "http://127.0.0.1:3000" && isDevtools()) return;
  if (runtime.productionEnabled && !runtime.localDevLogin && runtime.apiBaseUrl === "https://taifollow.cn") return;
  throw new Error("当前小程序 API 配置仅允许开发者工具连接本机测试库");
}
