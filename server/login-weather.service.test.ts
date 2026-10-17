import assert from "node:assert/strict";
import test from "node:test";
import {
  fallbackLoginWeather,
  LoginWeatherService,
  loginWeatherDisplayCondition,
  loginWeatherMode,
  shanghaiDate,
} from "./login-weather.service.js";

const now = new Date("2026-09-18T01:00:00.000Z");

function weatherResponse(dayweather = "晴", nightweather = "多云", date = "2026-09-18") {
  return new Response(JSON.stringify({
    status: "1",
    forecasts: [{ reporttime: "2026-09-18 08:00:00", casts: [{ date, dayweather, nightweather }] }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("登录天气按白天或夜间任一降水现象切换雨天", () => {
  assert.equal(loginWeatherMode("晴", "多云"), "sunny");
  assert.equal(loginWeatherMode("阴", "小雨"), "rainy");
  assert.equal(loginWeatherMode("雷阵雨伴有冰雹", "多云"), "rainy");
  assert.equal(loginWeatherMode("雨夹雪", "阴"), "rainy");
  assert.equal(loginWeatherDisplayCondition("晴", "多云"), "晴转多云");
  assert.equal(loginWeatherDisplayCondition("小雨", "小雨"), "小雨");
});

test("上海日期在 UTC 前一天 16 点进入次日", () => {
  assert.equal(shanghaiDate(new Date("2026-09-17T15:59:59.999Z")), "2026-09-17");
  assert.equal(shanghaiDate(new Date("2026-09-17T16:00:00.000Z")), "2026-09-18");
});

test("成功预报严格匹配今日并缓存三小时", async () => {
  const service = new LoginWeatherService();
  let calls = 0;
  const fetcher = async () => { calls += 1; return weatherResponse("多云", "阵雨"); };
  const first = await service.get({ env: { AMAP_WEATHER_API_KEY: "test-key" }, fetcher, now });
  const second = await service.get({ env: { AMAP_WEATHER_API_KEY: "test-key" }, fetcher, now: new Date(now.getTime() + 2 * 60 * 60 * 1000) });
  assert.equal(first.mode, "rainy");
  assert.equal(first.displayCondition, "多云转阵雨");
  assert.equal(first.stale, false);
  assert.deepEqual(second, first);
  assert.equal(calls, 1);
});

test("并发登录天气请求只访问一次上游", async () => {
  const service = new LoginWeatherService();
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fetcher = async () => { calls += 1; await gate; return weatherResponse(); };
  const one = service.get({ env: { AMAP_WEATHER_API_KEY: "test-key" }, fetcher, now });
  const two = service.get({ env: { AMAP_WEATHER_API_KEY: "test-key" }, fetcher, now });
  release();
  assert.deepEqual(await one, await two);
  assert.equal(calls, 1);
});

test("上游失败使用最后成功预报并标记陈旧", async () => {
  const service = new LoginWeatherService();
  await service.get({ env: { AMAP_WEATHER_API_KEY: "test-key" }, fetcher: async () => weatherResponse("小雨", "多云"), now });
  const stale = await service.get({
    env: { AMAP_WEATHER_API_KEY: "test-key" },
    fetcher: async () => new Response("bad gateway", { status: 502 }),
    now: new Date(now.getTime() + 4 * 60 * 60 * 1000),
  });
  assert.equal(stale.mode, "rainy");
  assert.equal(stale.stale, true);
});

test("缺少密钥、当日数据或合法响应时都安全降级", async () => {
  const missing = await new LoginWeatherService().get({ env: {}, now });
  const wrongDate = await new LoginWeatherService().get({ env: { AMAP_WEATHER_API_KEY: "test-key" }, fetcher: async () => weatherResponse("晴", "晴", "2026-09-19"), now });
  const malformed = await new LoginWeatherService().get({ env: { AMAP_WEATHER_API_KEY: "test-key" }, fetcher: async () => new Response("{}"), now });
  assert.deepEqual(missing, fallbackLoginWeather(now));
  assert.deepEqual(wrongDate, fallbackLoginWeather(now));
  assert.deepEqual(malformed, fallbackLoginWeather(now));
  assert.equal(JSON.stringify(missing).includes("test-key"), false);
});

test("超时不会阻塞登录页", async () => {
  const service = new LoginWeatherService();
  const fetcher: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
  const result = await service.get({ env: { AMAP_WEATHER_API_KEY: "test-key" }, fetcher, now, timeoutMs: 5 });
  assert.deepEqual(result, fallbackLoginWeather(now));
});
