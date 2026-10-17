export type MiniLoginWeatherMode = "sunny" | "rainy";

export type MiniLoginWeather = {
  mode: MiniLoginWeatherMode;
  locationLabel: "宁波镇海";
  date: string;
  dayCondition: string | null;
  nightCondition: string | null;
  displayCondition: string;
  forecastUpdatedAt: string | null;
  stale: boolean;
};

export const LOGIN_PRELUDE_FRAME_MS = 650;

const SUNNY_FRAMES = [
  "/assets/login-weather/sunny/1.jpg",
  "/assets/login-weather/sunny/2.jpg",
  "/assets/login-weather/sunny/3.jpg",
  "/assets/login-weather/sunny/4.jpg",
  "/assets/login-weather/sunny/5.jpg",
  "/assets/login-weather/sunny/6.jpg",
] as const;

const RAINY_FRAMES = [
  "/assets/login-weather/rainy/1.jpg",
  "/assets/login-weather/rainy/2.jpg",
  "/assets/login-weather/rainy/3.jpg",
  "/assets/login-weather/rainy/4.jpg",
  "/assets/login-weather/rainy/5.jpg",
] as const;

export function fallbackMiniLoginWeather(): MiniLoginWeather {
  return {
    mode: "sunny",
    locationLabel: "宁波镇海",
    date: "",
    dayCondition: null,
    nightCondition: null,
    displayCondition: "天气暂不可用",
    forecastUpdatedAt: null,
    stale: true,
  };
}

export function normalizeMiniLoginWeather(value: unknown): MiniLoginWeather {
  if (!value || typeof value !== "object") return fallbackMiniLoginWeather();
  const weather = value as Partial<MiniLoginWeather>;
  if ((weather.mode !== "sunny" && weather.mode !== "rainy")
    || weather.locationLabel !== "宁波镇海"
    || typeof weather.displayCondition !== "string") return fallbackMiniLoginWeather();
  return {
    mode: weather.mode,
    locationLabel: "宁波镇海",
    date: typeof weather.date === "string" ? weather.date : "",
    dayCondition: typeof weather.dayCondition === "string" ? weather.dayCondition : null,
    nightCondition: typeof weather.nightCondition === "string" ? weather.nightCondition : null,
    displayCondition: weather.displayCondition.trim() || "天气暂不可用",
    forecastUpdatedAt: typeof weather.forecastUpdatedAt === "string" ? weather.forecastUpdatedAt : null,
    stale: weather.stale === true,
  };
}

export function framesForMiniWeather(mode: MiniLoginWeatherMode) {
  return mode === "rainy" ? [...RAINY_FRAMES] : [...SUNNY_FRAMES];
}

export function nextMiniWeatherFrame(current: number, frameCount: number) {
  return frameCount > 0 ? (current + 1) % frameCount : 0;
}

export function miniWeatherCaption(weather: MiniLoginWeather) {
  if (weather.displayCondition === "本地演示") return `${weather.locationLabel} · 本地演示`;
  if (weather.displayCondition === "天气暂不可用") return `${weather.locationLabel} · 天气暂不可用`;
  return `${weather.locationLabel} · 今日${weather.displayCondition}${weather.stale ? "（缓存）" : ""}`;
}

export function miniWeatherSceneLabel(mode: MiniLoginWeatherMode) {
  return mode === "rainy"
    ? "雨天手绘动画：女孩在屋内休息，窗外正在下雨"
    : "晴天手绘动画：女孩在屋前给花草浇水，猫在窗台休息";
}

export function shouldShowLoginPrelude(hasStoredSession: boolean) {
  return !hasStoredSession;
}
