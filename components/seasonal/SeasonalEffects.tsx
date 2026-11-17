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

function SnowCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let w = 0;
    let h = 0;
    let raf = 0;
    type Flake = { x: number; y: number; r: number; v: number; sway: number; phase: number };
    let flakes: Flake[] = [];
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(24, Math.min(90, Math.round(w / 14)));
      flakes = Array.from({ length: count }, () => ({ x: Math.random() * w, y: Math.random() * h, r: 1 + Math.random() * 2.4, v: 0.4 + Math.random() * 0.9, sway: 8 + Math.random() * 18, phase: Math.random() * 6.28 }));
    };
    const tick = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      for (const f of flakes) {
        f.y += f.v;
        if (f.y > h + 4) {
          f.y = -4;
          f.x = Math.random() * w;
        }
        const x = f.x + Math.sin(t / 1400 + f.phase) * f.sway;
        ctx.beginPath();
        ctx.arc(x, f.y, f.r, 0, 6.283);
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      cancelAnimationFrame(raf);
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
