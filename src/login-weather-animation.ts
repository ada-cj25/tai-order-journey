import type { LoginWeather, LoginWeatherMode } from "../server/login-weather.service";

export const LOGIN_WEATHER_FRAME_MS = 650;

export function nextWeatherFrameIndex(current: number, frameCount: number) {
  return frameCount > 0 ? (current + 1) % frameCount : 0;
}

export function shouldAnimateLoginWeather(input: { reducedMotion: boolean; documentVisible: boolean; frameCount: number }) {
  return !input.reducedMotion && input.documentVisible && input.frameCount > 1;
}

export function loginWeatherSceneLabel(mode: LoginWeatherMode) {
  return mode === "rainy"
    ? "雨天手绘动画：屋外落雨，女孩和猫在屋内安静阅读"
    : "晴天手绘动画：女孩在屋前给花草浇水，猫在窗台休息";
}

export function loginWeatherCaption(weather: LoginWeather) {
  const unavailable = weather.displayCondition === "天气暂不可用";
  return `${weather.locationLabel} · ${unavailable ? weather.displayCondition : `今日${weather.displayCondition}`}${weather.stale && !unavailable ? " · 缓存预报" : ""}`;
}
