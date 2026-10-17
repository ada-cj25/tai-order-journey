import { Injectable, Logger } from "@nestjs/common";

export type LoginWeatherMode = "sunny" | "rainy";

export type LoginWeather = {
  mode: LoginWeatherMode;
  locationLabel: "宁波镇海";
  date: string;
  dayCondition: string | null;
  nightCondition: string | null;
  displayCondition: string;
  forecastUpdatedAt: string | null;
  stale: boolean;
};

type WeatherFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type WeatherRequestOptions = {
  env?: NodeJS.ProcessEnv;
  fetcher?: WeatherFetch;
  now?: Date;
  timeoutMs?: number;
};

type AmapWeatherResponse = {
  status?: string;
  forecasts?: Array<{
    reporttime?: string;
    casts?: Array<{ date?: string; dayweather?: string; nightweather?: string }>;
  }>;
};

const LOCATION_LABEL = "宁波镇海" as const;
const ZHENHAI_ADCODE = "330211";
const SUCCESS_CACHE_MS = 3 * 60 * 60 * 1000;
const PRECIPITATION = /(雨|雪|雷|冰雹)/;

export function shanghaiDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function loginWeatherMode(dayCondition?: string | null, nightCondition?: string | null): LoginWeatherMode {
  return PRECIPITATION.test(`${dayCondition ?? ""} ${nightCondition ?? ""}`) ? "rainy" : "sunny";
}

export function loginWeatherDisplayCondition(dayCondition?: string | null, nightCondition?: string | null) {
  const day = dayCondition?.trim() || null;
  const night = nightCondition?.trim() || null;
  if (day && night && day !== night) return `${day}转${night}`;
  return day ?? night ?? "天气暂不可用";
}

export function fallbackLoginWeather(now = new Date()): LoginWeather {
  return {
    mode: "sunny",
    locationLabel: LOCATION_LABEL,
    date: shanghaiDate(now),
    dayCondition: null,
    nightCondition: null,
    displayCondition: "天气暂不可用",
    forecastUpdatedAt: null,
    stale: true,
  };
}

@Injectable()
export class LoginWeatherService {
  private readonly logger = new Logger(LoginWeatherService.name);
  private fresh: { value: LoginWeather; expiresAt: number } | null = null;
  private lastSuccessful: LoginWeather | null = null;
  private pending: Promise<LoginWeather> | null = null;
  private warnedMissingKey = false;

  async get(options: WeatherRequestOptions = {}): Promise<LoginWeather> {
    const now = options.now ?? new Date();
    const today = shanghaiDate(now);
    if (this.fresh && this.fresh.expiresAt > now.getTime() && this.fresh.value.date === today) return this.fresh.value;
    if (this.pending) return this.pending;

    this.pending = this.load({ ...options, now }).finally(() => { this.pending = null; });
    return this.pending;
  }

  private async load(options: Required<Pick<WeatherRequestOptions, "now">> & WeatherRequestOptions): Promise<LoginWeather> {
    const env = options.env ?? process.env;
    const key = env.AMAP_WEATHER_API_KEY?.trim();
    if (!key) {
      if (!this.warnedMissingKey && env.NODE_ENV === "production") {
        this.warnedMissingKey = true;
        this.logger.warn("登录页天气密钥未配置，已使用静态降级画面");
      }
      return this.staleOrFallback(options.now);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 2_500);
    try {
      const query = new URLSearchParams({ city: ZHENHAI_ADCODE, extensions: "all", output: "JSON", key });
      const response = await (options.fetcher ?? globalThis.fetch)(`https://restapi.amap.com/v3/weather/weatherInfo?${query.toString()}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as AmapWeatherResponse;
      const forecast = payload.forecasts?.[0];
      const today = shanghaiDate(options.now);
      const cast = forecast?.casts?.find((item) => item.date === today);
      const dayCondition = cast?.dayweather?.trim() || null;
      const nightCondition = cast?.nightweather?.trim() || null;
      if (payload.status !== "1" || !cast || (!dayCondition && !nightCondition)) throw new Error("天气响应缺少当日预报");

      const value: LoginWeather = {
        mode: loginWeatherMode(dayCondition, nightCondition),
        locationLabel: LOCATION_LABEL,
        date: today,
        dayCondition,
        nightCondition,
        displayCondition: loginWeatherDisplayCondition(dayCondition, nightCondition),
        forecastUpdatedAt: forecast?.reporttime?.trim() || null,
        stale: false,
      };
      this.lastSuccessful = value;
      this.fresh = { value, expiresAt: options.now.getTime() + SUCCESS_CACHE_MS };
      return value;
    } catch (error) {
      this.logger.warn(`登录页天气暂时不可用：${error instanceof Error ? error.name : "unknown"}`);
      return this.staleOrFallback(options.now);
    } finally {
      clearTimeout(timeout);
    }
  }

  private staleOrFallback(now: Date) {
    return this.lastSuccessful ? { ...this.lastSuccessful, stale: true } : fallbackLoginWeather(now);
  }
}
