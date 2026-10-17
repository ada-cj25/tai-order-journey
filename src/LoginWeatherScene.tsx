import { useEffect, useState } from "react";
import { RiMapPin2Line } from "@remixicon/react";
import {
  LOGIN_WEATHER_FRAME_MS,
  loginWeatherSceneLabel,
  nextWeatherFrameIndex,
  shouldAnimateLoginWeather,
} from "./login-weather-animation";
import sunny1 from "./assets/login-weather/sunny/1.png";
import sunny2 from "./assets/login-weather/sunny/2.png";
import sunny3 from "./assets/login-weather/sunny/3.png";
import sunny4 from "./assets/login-weather/sunny/4.png";
import sunny5 from "./assets/login-weather/sunny/5.png";
import sunny6 from "./assets/login-weather/sunny/6.png";
const FRAMES = [sunny1, sunny2, sunny3, sunny4, sunny5, sunny6] as const;

export function LoginWeatherScene() {
  const [frameIndex, setFrameIndex] = useState(0);
  const [documentVisible, setDocumentVisible] = useState(() => !document.hidden);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    for (const source of FRAMES.slice(1)) {
      const image = new Image();
      image.src = source;
    }
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotionChange = () => setReducedMotion(media.matches);
    const onVisibilityChange = () => setDocumentVisible(!document.hidden);
    media.addEventListener("change", onMotionChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      media.removeEventListener("change", onMotionChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!shouldAnimateLoginWeather({ reducedMotion, documentVisible, frameCount: FRAMES.length })) return;
    const timer = window.setInterval(() => setFrameIndex((current) => nextWeatherFrameIndex(current, FRAMES.length)), LOGIN_WEATHER_FRAME_MS);
    return () => window.clearInterval(timer);
  }, [documentVisible, reducedMotion]);

  return <section className="erp-login-weather-card" data-weather-mode="sunny" role="img" aria-label={loginWeatherSceneLabel("sunny")}>
    <div className="erp-login-weather-art">
      <img src={FRAMES[frameIndex % FRAMES.length]} alt="" aria-hidden="true" draggable={false} fetchPriority="high" />
    </div>
    <span className="erp-login-weather-caption"><RiMapPin2Line size={15} aria-hidden="true" />宁波镇海 · 晴天手帐</span>
  </section>;
}
