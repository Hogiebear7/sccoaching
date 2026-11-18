"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { SeasonScene } from "./SeasonScene";
import { useSeason } from "./useSeason";

// The seasonal look on the home page and the member dashboard. Snow falls at Christmas (the only thing that moves); every other season is a calm scene along the
// bottom of the page (see SeasonScene). On 1 to 6 January there is a New Year message, with fireworks on 1 and 2 January. Light on purpose: it pauses when the
// tab is hidden, never takes clicks, and does nothing moving for people who ask their device to reduce motion.
const SHOW_ON = new Set(["/", "/dashboard"]);

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false
  );
}

// Snow in three depths, so it reads as a real fall rather than one sheet of dots: far flakes are small, dim and slow; middle flakes are crisp, some of them
// six-armed crystals that turn as they fall; near flakes are large, soft and out of focus, and they move fastest. A slow wind gusts across all of them (the near
// ones feel it most). Every flake is a pre-drawn sprite, so ~100 of them stay cheap.
function makeSprites(dpr: number) {
  const make = (size: number, draw: (c: CanvasRenderingContext2D, s: number) => void) => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = Math.ceil(size * dpr);
    const c = cv.getContext("2d")!;
    c.scale(dpr, dpr);
    draw(c, size);
    return cv;
  };
  const soft = (blur: number) =>
    make(64, (c, s) => {
      const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(Math.max(0, 1 - blur), "rgba(255,255,255,0.9)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, s, s);
    });
  const crystal = (branches: boolean) =>
    make(64, (c, s) => {
      c.translate(s / 2, s / 2);
      c.strokeStyle = "rgba(255,255,255,0.95)";
      c.lineCap = "round";
      c.shadowColor = "rgba(190,220,255,0.9)";
      c.shadowBlur = 3;
      for (let i = 0; i < 6; i++) {
        c.save();
        c.rotate((i * Math.PI) / 3);
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(0, 0);
        c.lineTo(0, -26);
        c.stroke();
        if (branches) {
          c.lineWidth = 2;
          for (const d of [10, 18]) {
            c.beginPath();
            c.moveTo(0, -d);
            c.lineTo(-7 * (1 - d / 40), -d - 7);
            c.moveTo(0, -d);
            c.lineTo(7 * (1 - d / 40), -d - 7);
            c.stroke();
          }
        }
        c.restore();
      }
      c.fillStyle = "#fff";
      c.beginPath();
      c.arc(0, 0, 2.6, 0, 6.283);
      c.fill();
    });
  return { dot: soft(0.35), bokeh: soft(0.8), crystalPlain: crystal(false), crystalFine: crystal(true) };
}

function SnowCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const sprites = makeSprites(dpr);
    let w = 0;
    let h = 0;
    let raf = 0;
    let last = 0;
    type Layer = "far" | "mid" | "near";
    type Flake = { x: number; y: number; size: number; v: number; sway: number; phase: number; alpha: number; layer: Layer; img: HTMLCanvasElement; spin: number; angle: number };
    let flakes: Flake[] = [];
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const spawn = (layer: Layer, y: number): Flake => {
      if (layer === "far") return { x: rnd(0, w), y, size: rnd(3, 6), v: rnd(14, 26), sway: rnd(4, 10), phase: rnd(0, 6.28), alpha: rnd(0.35, 0.65), layer, img: sprites.dot, spin: 0, angle: 0 };
      if (layer === "mid") {
        const cr = Math.random() < 0.3;
        return { x: rnd(0, w), y, size: cr ? rnd(11, 17) : rnd(5, 9), v: rnd(30, 52), sway: rnd(10, 22), phase: rnd(0, 6.28), alpha: rnd(0.7, 0.95), layer, img: cr ? sprites.crystalFine : sprites.dot, spin: cr ? rnd(-0.9, 0.9) : 0, angle: rnd(0, 6.28) };
      }
      const cr = Math.random() < 0.25;
      return { x: rnd(0, w), y, size: cr ? rnd(20, 30) : rnd(14, 26), v: rnd(70, 110), sway: rnd(18, 34), phase: rnd(0, 6.28), alpha: cr ? rnd(0.3, 0.45) : rnd(0.28, 0.5), layer, img: cr ? sprites.crystalPlain : sprites.bokeh, spin: cr ? rnd(-1.2, 1.2) : 0, angle: rnd(0, 6.28) };
    };
    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const k = Math.max(0.5, Math.min(1.4, w / 1100));
      flakes = [
        ...Array.from({ length: Math.round(70 * k) }, () => spawn("far", rnd(0, h))),
        ...Array.from({ length: Math.round(46 * k) }, () => spawn("mid", rnd(0, h))),
        ...Array.from({ length: Math.round(11 * k) }, () => spawn("near", rnd(0, h))),
      ];
    };
    const tick = (t: number) => {
      const dt = Math.min((t - (last || t)) / 1000, 0.05);
      last = t;
      // A slow wind that gusts: mostly a gentle lean to one side, now and then a stronger push.
      const wind = Math.sin(t / 5200) * 14 + Math.sin(t / 1700 + 1.3) * 7;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      for (const f of flakes) {
        const depth = f.layer === "near" ? 1.6 : f.layer === "mid" ? 1 : 0.5;
        f.y += f.v * dt;
        f.x += wind * depth * dt;
        f.angle += f.spin * dt;
        if (f.y > h + f.size) {
          Object.assign(f, spawn(f.layer, -f.size));
        }
        if (f.x > w + 40) f.x = -40;
        else if (f.x < -40) f.x = w + 40;
        const x = f.x + Math.sin(t / (f.layer === "near" ? 2200 : 1500) + f.phase) * f.sway;
        ctx.globalAlpha = f.alpha;
        if (f.spin) {
          ctx.save();
          ctx.translate(x, f.y);
          ctx.rotate(f.angle);
          ctx.drawImage(f.img, -f.size / 2, -f.size / 2, f.size, f.size);
          ctx.restore();
        } else {
          ctx.drawImage(f.img, x - f.size / 2, f.y - f.size / 2, f.size, f.size);
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      last = 0;
      if (!document.hidden) raf = requestAnimationFrame(tick);
    };
    resize();
    start();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", start);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", start);
    };
  }, []);
  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[45] h-full w-full" />;
}

function Fireworks() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // Once per visit (tab session). Later renders leave the canvas empty.
    try {
      if (sessionStorage.getItem("sc-fireworks") === "1") return;
      sessionStorage.setItem("sc-fireworks", "1");
    } catch {
      // Private mode: just play them.
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const PALETTE = ["#e3b341", "#ffffff", "#5ea0ff", "#f4d57a"];
    type P = { x: number; y: number; vx: number; vy: number; life: number; c: string };
    let parts: P[] = [];
    const burst = () => {
      const cx = w * (0.15 + Math.random() * 0.7);
      const cy = h * (0.12 + Math.random() * 0.4);
      const c = PALETTE[Math.floor(Math.random() * PALETTE.length)];
      for (let i = 0; i < 46; i++) {
        const a = (i / 46) * 6.283;
        const s = 1.2 + Math.random() * 2.4;
        parts.push({ x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, c });
      }
    };
    const started = performance.now();
    let last = 0;
    let raf = 0;
    const tick = (t: number) => {
      const elapsed = t - started;
      if (elapsed < 9000 && t - last > 650) {
        burst();
        last = t;
      }
      ctx.clearRect(0, 0, w, h);
      parts = parts.filter((p) => p.life > 0);
      for (const p of parts) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.035;
        p.vx *= 0.99;
        p.life -= 0.014;
        ctx.globalAlpha = Math.max(p.life, 0);
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, 6.283);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (elapsed < 11000 || parts.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[46] h-full w-full" />;
}

export function SeasonalEffects() {
  const pathname = usePathname();
  const { season, overlay, greeting } = useSeason();
  const bannerText = overlay?.message ?? greeting;
  const reduceMotion = useReducedMotion();
  const [bannerOpen, setBannerOpen] = useState(true);

  if (!season || !SHOW_ON.has(pathname)) return null;

  return (
    <>
      {season.particle === "snow" && !reduceMotion ? <SnowCanvas /> : null}
      <SeasonScene season={overlay ? "christmas" : season.key} />
      {bannerText && bannerOpen ? (
        <div className="fixed left-1/2 top-16 z-[47] flex max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-full bg-[#e3b341] px-4 py-2 text-sm font-semibold text-[#16294a] shadow-lg sm:top-20">
          <span>{bannerText}</span>
          <button type="button" onClick={() => setBannerOpen(false)} aria-label="Close message" className="rounded-full px-1.5 leading-none hover:bg-black/10">
            ×
          </button>
        </div>
      ) : null}
      {overlay?.fireworks && !reduceMotion ? <Fireworks /> : null}
    </>
  );
}
