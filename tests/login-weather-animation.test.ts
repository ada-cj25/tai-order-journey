import assert from "node:assert/strict";
import test from "node:test";
import {
  LOGIN_WEATHER_FRAME_MS,
  loginWeatherCaption,
  loginWeatherSceneLabel,
  nextWeatherFrameIndex,
  shouldAnimateLoginWeather,
} from "../src/login-weather-animation";

test("登录天气动画按 650ms 逐帧循环", () => {
  assert.equal(LOGIN_WEATHER_FRAME_MS, 650);
  assert.equal(nextWeatherFrameIndex(0, 6), 1);
  assert.equal(nextWeatherFrameIndex(5, 6), 0);
  assert.equal(nextWeatherFrameIndex(0, 0), 0);
});

test("减少动效、后台页或单帧时停止播放", () => {
  assert.equal(shouldAnimateLoginWeather({ reducedMotion: false, documentVisible: true, frameCount: 6 }), true);
  assert.equal(shouldAnimateLoginWeather({ reducedMotion: true, documentVisible: true, frameCount: 6 }), false);
  assert.equal(shouldAnimateLoginWeather({ reducedMotion: false, documentVisible: false, frameCount: 6 }), false);
  assert.equal(shouldAnimateLoginWeather({ reducedMotion: false, documentVisible: true, frameCount: 1 }), false);
});

test("晴雨场景有稳定且不逐帧重复的读屏描述", () => {
  assert.match(loginWeatherSceneLabel("sunny"), /浇水/);
  assert.match(loginWeatherSceneLabel("rainy"), /阅读/);
});

test("天气标签区分实时、缓存和无法获取状态", () => {
  const base = { mode: "sunny" as const, locationLabel: "宁波镇海" as const, date: "2026-09-18", dayCondition: "晴", nightCondition: "多云", forecastUpdatedAt: null };
  assert.equal(loginWeatherCaption({ ...base, displayCondition: "晴转多云", stale: false }), "宁波镇海 · 今日晴转多云");
  assert.equal(loginWeatherCaption({ ...base, displayCondition: "小雨", stale: true }), "宁波镇海 · 今日小雨 · 缓存预报");
  assert.equal(loginWeatherCaption({ ...base, displayCondition: "天气暂不可用", stale: true }), "宁波镇海 · 天气暂不可用");
});
