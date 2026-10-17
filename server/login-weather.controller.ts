import { Controller, Get, Header, Inject } from "@nestjs/common";
import { Public } from "./auth.js";
import { LoginWeatherService } from "./login-weather.service.js";

@Controller("api/v1/public")
export class LoginWeatherController {
  constructor(@Inject(LoginWeatherService) private readonly weather: LoginWeatherService) {}

  @Public()
  @Get("login-weather")
  @Header("Cache-Control", "public, max-age=300, stale-while-revalidate=10800")
  getLoginWeather() {
    return this.weather.get();
  }
}
