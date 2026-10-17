import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("桌面端使用天气前置页且移动端跳过，并保留本地账号门禁", async () => {
  const app = await read("src/App.tsx");
  assert.match(app, /function LoginPrelude/);
  assert.match(app, /loginPreludeOpen && !mobileRoute/);
  assert.match(app, /<LoginWeatherScene \/>/);
  assert.match(app, /localAccounts && LocalTestAccounts/);
  assert.doesNotMatch(app, /翻到测试账号/);
  assert.doesNotMatch(app, /返回天气动画/);
  assert.match(app, /const LocalTestAccounts = import\.meta\.env\.DEV \? lazy/);
  assert.match(app, /showLocalTestAccounts\(\{ devBuild: import\.meta\.env\.DEV/);
  assert.match(app, /sessionStorage\.setItem\(LOCAL_TEST_LOGIN_PAGE_KEY, "1"\)/);
});

test("两套原始手绘帧完整且网页前置页固定使用晴天", async () => {
  const [sunny, rainy, scene] = await Promise.all([
    readdir(new URL("../src/assets/login-weather/sunny/", import.meta.url)),
    readdir(new URL("../src/assets/login-weather/rainy/", import.meta.url)),
    read("src/LoginWeatherScene.tsx"),
  ]);
  assert.equal(sunny.filter((name) => name.endsWith(".png")).length, 6);
  assert.equal(rainy.filter((name) => name.endsWith(".png")).length, 5);
  assert.match(scene, /const FRAMES = \[sunny1, sunny2, sunny3, sunny4, sunny5, sunny6\]/);
  assert.match(scene, /data-weather-mode="sunny"/);
  assert.match(scene, /晴天手帐/);
  assert.doesNotMatch(scene, /fetch\(/);
  assert.doesNotMatch(scene, /import rainy\d/);
  assert.match(scene, /FRAMES\.slice\(1\)/);
  assert.match(scene, /clearInterval\(timer\)/);
  assert.match(scene, /visibilitychange/);
  assert.match(scene, /prefers-reduced-motion/);
});

test("天气前置纸窗有响应式与减少动效样式", async () => {
  const css = await read("src/styles.css");
  assert.match(css, /@keyframes erp-login-prelude-in/);
  assert.match(css, /\.erp-login-prelude-window/);
  assert.match(css, /\.erp-login-weather-card/);
  assert.match(css, /@media \(max-height:780px\) and \(min-width:1051px\)/);
  assert.match(css, /@media \(max-width:1050px\)/);
  assert.match(css, /\.erp-login-prelude-window \{ animation:none !important; \}/);
});
