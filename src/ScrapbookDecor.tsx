import { useEffect, useRef } from "react";
import orangeCat from "./assets/scrapbook/orange-cat.png";
import catPupil from "./assets/scrapbook/cat-pupil.png";
import { computeCatGaze } from "./cat-gaze";

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
