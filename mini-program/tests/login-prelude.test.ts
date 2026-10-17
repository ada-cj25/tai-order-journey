import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  fallbackMiniLoginWeather,
  framesForMiniWeather,
  LOGIN_PRELUDE_FRAME_MS,
  miniWeatherCaption,
  miniWeatherSceneLabel,
  nextMiniWeatherFrame,
  normalizeMiniLoginWeather,
  shouldShowLoginPrelude,
} from "../domain/login-prelude.ts";
import { loadMiniLoginWeather } from "../services/login-weather.ts";

test("登录前置页只对未登录会话显示", () => {
  assert.equal(shouldShowLoginPrelude(false), true);
  assert.equal(shouldShowLoginPrelude(true), false);
});

test("晴雨帧均为可打包的 JPEG 文件，且 650ms 循环保持稳定", async () => {
  const sunny = framesForMiniWeather("sunny");
  const rainy = framesForMiniWeather("rainy");
  assert.equal(LOGIN_PRELUDE_FRAME_MS, 650);
  assert.equal(sunny.length, 6);
  assert.equal(rainy.length, 5);
  for (const source of [...sunny, ...rainy]) {
    assert.equal(source.endsWith(".jpg"), true);
    const data = await readFile(new URL(`..${source}`, import.meta.url));
    assert.deepEqual([...data.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  }
  assert.equal(nextMiniWeatherFrame(5, sunny.length), 0);
  assert.equal(nextMiniWeatherFrame(4, rainy.length), 0);
  assert.equal(nextMiniWeatherFrame(0, 0), 0);
});

test("开发者工具预览不会裁掉动态引用的进入页图片", async () => {
  const config = JSON.parse(await readFile(new URL("../project.config.json", import.meta.url), "utf8"));
  assert.equal(config.setting.ignoreDevUnusedFiles, false);
  assert.equal(config.setting.ignoreUploadUnusedFiles, false);
});

test("天气响应规范化并在畸形数据时安全降级", () => {
  const rainy = normalizeMiniLoginWeather({
    mode: "rainy",
    locationLabel: "宁波镇海",
    date: "2026-09-19",
    dayCondition: "小雨",
    nightCondition: "阴",
    displayCondition: "小雨转阴",
    forecastUpdatedAt: "2026-09-19 08:00:00",
    stale: false,
  });
  assert.equal(rainy.mode, "rainy");
  assert.equal(miniWeatherCaption(rainy), "宁波镇海 · 今日小雨转阴");
  assert.equal(normalizeMiniLoginWeather({ mode: "storm" }).displayCondition, "天气暂不可用");
  assert.deepEqual(normalizeMiniLoginWeather(null), fallbackMiniLoginWeather());
});

test("缓存、离线和本地演示标签不伪造实时天气", () => {
  assert.equal(miniWeatherCaption({ ...fallbackMiniLoginWeather(), displayCondition: "小雨", stale: true }), "宁波镇海 · 今日小雨（缓存）");
  assert.equal(miniWeatherCaption(fallbackMiniLoginWeather()), "宁波镇海 · 天气暂不可用");
  assert.equal(miniWeatherCaption({ ...fallbackMiniLoginWeather(), mode: "rainy", displayCondition: "本地演示" }), "宁波镇海 · 本地演示");
  assert.match(miniWeatherSceneLabel("sunny"), /晴天手绘动画/);
  assert.match(miniWeatherSceneLabel("rainy"), /雨天手绘动画/);
});

test("mock 模式不访问接口，API 模式使用 3.5 秒超时并吞掉天气错误", async () => {
  let calls = 0;
  const mock = await loadMiniLoginWeather({
    runtimeMode: "mock",
    mockWeatherMode: "rainy",
    requester: async () => { calls += 1; throw new Error("不应访问"); },
  });
  assert.equal(mock.mode, "rainy");
  assert.equal(calls, 0);

  const api = await loadMiniLoginWeather({
    runtimeMode: "api",
    requester: async (path, options) => {
      calls += 1;
      assert.equal(path, "/api/v1/public/login-weather");
      assert.equal(options?.timeoutMs, 3_500);
      return { ...fallbackMiniLoginWeather(), mode: "rainy", displayCondition: "雷阵雨", stale: false };
    },
  });
  assert.equal(api.mode, "rainy");
  assert.equal(calls, 1);

  const offline = await loadMiniLoginWeather({ runtimeMode: "api", requester: async () => { throw new Error("offline"); } });
  assert.deepEqual(offline, fallbackMiniLoginWeather());
});

test("页面固定使用雨天画面，具备点击进入、暂停清理和图片失败降级", async () => {
  const [logic, template, styles] = await Promise.all([
    readFile(new URL("../pages/login/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../pages/login/index.wxml", import.meta.url), "utf8"),
    readFile(new URL("../pages/login/index.wxss", import.meta.url), "utf8"),
  ]);
  assert.match(logic, /screen: "checking"/);
  assert.match(logic, /framesForMiniWeather\("rainy"\)/);
  assert.match(logic, /miniWeatherSceneLabel\("rainy"\)/);
  assert.doesNotMatch(logic, /loadMiniLoginWeather|loadWeather\(/);
  assert.match(logic, /onHide\(\) \{ this\.stopAnimation\(\); \}/);
  assert.match(logic, /onUnload\(\) \{ this\.stopAnimation\(\); \}/);
  assert.match(logic, /handleFrameError/);
  assert.match(template, /雨天手帐/);
  assert.match(template, /bindtap="enterLogin"/);
  assert.match(template, /catchtap="enterLogin"/);
  assert.match(template, /aria-label="\{\{sceneLabel\}\}"/);
  assert.match(styles, /#06251f/);
  assert.match(styles, /env\(safe-area-inset-top\)/);
});
