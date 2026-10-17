import { runtime, type MockWeatherMode, type RuntimeMode } from "../config/runtime";
import {
  fallbackMiniLoginWeather,
  normalizeMiniLoginWeather,
  type MiniLoginWeather,
} from "../domain/login-prelude";
import { publicMiniRequest } from "./client";

type WeatherRequester = (path: string, options?: { method?: "GET" | "POST"; timeoutMs?: number }) => Promise<unknown>;

type WeatherLoadOptions = {
  runtimeMode?: RuntimeMode;
  mockWeatherMode?: MockWeatherMode;
  requester?: WeatherRequester;
};

function mockWeather(mode: MockWeatherMode): MiniLoginWeather {
  return {
    ...fallbackMiniLoginWeather(),
    mode,
    displayCondition: "本地演示",
  };
}

export async function loadMiniLoginWeather(options: WeatherLoadOptions = {}) {
  const runtimeMode = options.runtimeMode ?? runtime.mode;
  if (runtimeMode === "mock") return mockWeather(options.mockWeatherMode ?? runtime.mockWeatherMode);
  try {
    const requester: WeatherRequester = options.requester ?? publicMiniRequest;
    const value = await requester("/api/v1/public/login-weather", { timeoutMs: 3_500 });
    return normalizeMiniLoginWeather(value);
  } catch {
    return fallbackMiniLoginWeather();
  }
}
