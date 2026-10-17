import { useEffect, useMemo, useRef, useState } from "react";
import { RiRainyLine, RiSparkling2Line, RiSunLine } from "@remixicon/react";
import orangeCat from "./assets/scrapbook/orange-cat.png";
import catPupil from "./assets/scrapbook/cat-pupil.png";
import rainyHouse from "./assets/scrapbook/rainy-house.png";
import { computeCatGaze } from "./cat-gaze";

type EmployeeSummary = { name: string; department: string; roleLabel: string };
type RainDrop = { x: number; y: number; previousY: number; speed: number; length: number };
type RoofDrop = { x: number; y: number; direction: -1 | 1; life: number; speed: number };

const dateLabel = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  weekday: "long",
}).format(new Date());

export function InteractiveOrangeCat() {
  const catRef = useRef<HTMLDivElement>(null);
  const eyeRefs = useRef<Array<HTMLImageElement | null>>([]);
  const frameRef = useRef<number | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });

  const playWiggle = () => {
    const cat = catRef.current;
    if (!cat) return;
    cat.classList.remove("is-wiggling");
    void cat.offsetWidth;
    cat.classList.add("is-wiggling");
  };

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const renderGaze = () => {
      frameRef.current = null;
      const cat = catRef.current;
      if (!cat) return;
      const sockets = Array.from(cat.querySelectorAll<HTMLElement>(".scrapbook-cat-eye"));
      if (!sockets.length) return;
      const centers = sockets.map((socket) => {
        const rect = socket.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });
      const centerX = centers.reduce((sum, center) => sum + center.x, 0) / centers.length;
      const centerY = centers.reduce((sum, center) => sum + center.y, 0) / centers.length;
      const socketRect = sockets[0].getBoundingClientRect();
      const pupilRect = eyeRefs.current[0]?.getBoundingClientRect();
      if (!pupilRect) return;
      const { x, y } = computeCatGaze({
        pointerX: pointerRef.current.x,
        pointerY: pointerRef.current.y,
        eyeCenterX: centerX,
        eyeCenterY: centerY,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        socketWidth: socketRect.width,
        socketHeight: socketRect.height,
        pupilElementWidth: pupilRect.width,
        pupilElementHeight: pupilRect.height,
      });
      for (const eye of eyeRefs.current) {
        if (eye) eye.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      if (media.matches || !catRef.current) return;
      pointerRef.current = { x: event.clientX, y: event.clientY };
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        renderGaze();
      });
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return <div
    ref={catRef}
    className="scrapbook-cat"
    role="button"
    tabIndex={0}
    aria-label="一只会看向鼠标、点击后会晃动的大橘猫"
    onClick={playWiggle}
    onAnimationEnd={() => catRef.current?.classList.remove("is-wiggling")}
    onKeyDown={(event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        playWiggle();
      }
    }}
  >
    <img className="scrapbook-cat-body" src={orangeCat} alt="趴着的大橘猫" />
    <span className="scrapbook-cat-eye scrapbook-cat-eye-left">
      <img ref={(element) => { eyeRefs.current[0] = element; }} src={catPupil} alt="" />
    </span>
    <span className="scrapbook-cat-eye scrapbook-cat-eye-right">
      <img ref={(element) => { eyeRefs.current[1] = element; }} src={catPupil} alt="" />
    </span>
  </div>;
}

function RainCanvas({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animationFrame = 0;
    let drops: RainDrop[] = [];
    let roofDrops: RoofDrop[] = [];
    let width = 0;
    let height = 0;
    let scale = 1;

    const roofY = (x: number) => {
      const peakX = width * 0.5;
      const horizontal = Math.min(1, Math.abs(x - peakX) / (width * 0.39));
      return height * (0.14 + horizontal * 0.39);
    };

    const resetDrop = (drop: RainDrop, fromTop = true) => {
      drop.x = Math.random() * width;
      drop.y = fromTop ? -Math.random() * height * 0.75 : -24;
      drop.previousY = drop.y;
      drop.speed = 3.6 + Math.random() * 3.4;
      drop.length = 7 + Math.random() * 11;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      scale = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      context.setTransform(scale, 0, 0, scale, 0, 0);
      drops = Array.from({ length: Math.max(42, Math.floor(width / 8)) }, () => {
        const drop: RainDrop = { x: 0, y: 0, previousY: 0, speed: 0, length: 0 };
        resetDrop(drop);
        return drop;
      });
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      context.lineCap = "round";
      context.strokeStyle = "rgba(104, 137, 151, .5)";
      context.lineWidth = 1.15;

      for (const drop of drops) {
        drop.previousY = drop.y;
        drop.y += drop.speed;
        context.beginPath();
        context.moveTo(drop.x, drop.y);
        context.lineTo(drop.x - 1.5, drop.y + drop.length);
        context.stroke();

        const hitsRoof = drop.x > width * 0.11 && drop.x < width * 0.89 && drop.previousY <= roofY(drop.x) && drop.y + drop.length >= roofY(drop.x);
        if (hitsRoof) {
          const direction: -1 | 1 = drop.x < width * 0.5 ? -1 : 1;
          roofDrops.push({ x: drop.x, y: roofY(drop.x), direction, life: 1, speed: 0.7 + Math.random() * 0.8 });
          resetDrop(drop, false);
        } else if (drop.y > height + 20) {
          resetDrop(drop, false);
        }
      }

      context.strokeStyle = "rgba(167, 105, 123, .46)";
      context.lineWidth = 1.3;
      roofDrops = roofDrops.filter((drop) => {
        drop.x += drop.direction * drop.speed;
        drop.y = roofY(drop.x) + 2;
        drop.life -= 0.018;
        context.globalAlpha = Math.max(0, drop.life);
        context.beginPath();
        context.moveTo(drop.x, drop.y);
        context.lineTo(drop.x + drop.direction * 5, drop.y + 4);
        context.stroke();
        context.globalAlpha = 1;
        return drop.life > 0 && drop.x > width * 0.09 && drop.x < width * 0.91;
      });

      animationFrame = window.requestAnimationFrame(draw);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();
    if (!motion.matches) draw();
    return () => {
      resizeObserver.disconnect();
      window.cancelAnimationFrame(animationFrame);
      context.clearRect(0, 0, width, height);
    };
  }, [active]);

  return <canvas ref={canvasRef} className={`scrapbook-rain-canvas ${active ? "active" : ""}`} aria-hidden="true" />;
}

export function ScrapbookDashboardHero({ employee, riskCount, pendingShipments }: { employee: EmployeeSummary; riskCount: number; pendingShipments: number }) {
  const [weather, setWeather] = useState<"sunny" | "rainy">(() => {
    try { return window.localStorage.getItem("tai-dashboard-weather") === "sunny" ? "sunny" : "rainy"; }
    catch { return "rainy"; }
  });
  const rainy = weather === "rainy";
  const summary = useMemo(() => riskCount
    ? `${riskCount} 个异常标记需要留意，${pendingShipments} 个订单等待发货。`
    : `今天没有阻断风险，${pendingShipments} 个订单等待发货。`, [pendingShipments, riskCount]);

  const selectWeather = (value: "sunny" | "rainy") => {
    setWeather(value);
    try { window.localStorage.setItem("tai-dashboard-weather", value); } catch { /* local preferences are optional */ }
  };

  return <section className={`scrapbook-dashboard-hero ${rainy ? "rainy" : "sunny"}`}>
    <div className="scrapbook-hero-copy">
      <span className="scrapbook-date"><RiSparkling2Line size={15} /> {dateLabel}</span>
      <h1>今天也把每一笔订单<br />稳稳接住。</h1>
      <p>{employee.name}，{summary}</p>
      <div className="scrapbook-hero-facts">
        <span>{employee.department}</span>
        <span>{employee.roleLabel}</span>
      </div>
      <div className="scrapbook-weather-switch" role="group" aria-label="切换工作台天气">
        <button type="button" className={!rainy ? "active" : ""} aria-pressed={!rainy} onClick={() => selectWeather("sunny")}><RiSunLine size={16} /> 晴天</button>
        <button type="button" className={rainy ? "active" : ""} aria-pressed={rainy} onClick={() => selectWeather("rainy")}><RiRainyLine size={16} /> 雨天</button>
      </div>
    </div>
    <div className="scrapbook-house-scene" aria-label={rainy ? "雨滴落在手绘小屋屋顶上" : "阳光下的手绘小屋"}>
      <span className="scrapbook-weather-note">{rainy ? "雨落在屋顶，今天也慢慢来" : "晴光正好，适合清一清待办"}</span>
      <img src={rainyHouse} alt="一间有人认真跟单的手绘小屋" />
      <RainCanvas active={rainy} />
    </div>
  </section>;
}
