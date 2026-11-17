"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { Particle } from "@/lib/seasons";
import { useSeason } from "./useSeason";

// The seasonal look on the home page and the member dashboard: falling snow, hearts, shamrocks, eggs or leaves; a sun in summer; cobwebs at Halloween; the
// ground along the bottom (snow, sand and a wave, a pile of leaves); and on 1 to 6 January a New Year message, with fireworks on 1 and 2 January. Light on
// purpose: it pauses when the tab is hidden, uses few pieces, never takes clicks, and does nothing moving for people who ask their device to reduce motion.
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

type SpriteKind = "heart" | "shamrock" | "egg" | "leaf";
const SPRITE_FOR: Partial<Record<Particle, SpriteKind>> = { hearts: "heart", shamrocks: "shamrock", eggs: "egg", leaves: "leaf" };
const COLOURS: Record<SpriteKind, string[]> = {
  heart: ["#ff4d6d", "#ff8fa3", "#ff2e63", "#ffb3c1"],
  shamrock: ["#1fa84f", "#2ecc71", "#178a3f"],
  egg: ["#ffd1dc", "#cde7ff", "#fff1a8", "#d6f5d6", "#e6d3ff"],
  leaf: ["#e07a1f", "#c0392b", "#f1c40f", "#a0521d"],
};
const HEART = "M12 21 C4 14 2 9 2 6.5 C2 3.5 4.5 2 7 2 C9 2 11 3.3 12 5 C13 3.3 15 2 17 2 C19.5 2 22 3.5 22 6.5 C22 9 20 14 12 21 Z";
const LEAF = "M12 2 C20 6 21 15 12 22 C3 15 4 6 12 2 Z";

// Draws one piece, in a 24 x 24 box centred on (0, 0).
function drawSprite(ctx: CanvasRenderingContext2D, kind: SpriteKind, colour: string) {
  ctx.fillStyle = colour;
  ctx.translate(-12, -12);
  if (kind === "heart") ctx.fill(new Path2D(HEART));
  else if (kind === "leaf") ctx.fill(new Path2D(LEAF));
  else if (kind === "shamrock") {
    for (const [cx, cy] of [[12, 7], [7, 13], [17, 13]]) {
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, 6.283);
      ctx.fill();
    }
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(12, 12);
    ctx.lineTo(13.4, 22);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.ellipse(12, 13, 7, 9, 0, 0, 6.283);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(5.4, 12);
    ctx.lineTo(8, 10.5);
    ctx.lineTo(10.5, 12);
    ctx.lineTo(13, 10.5);
    ctx.lineTo(15.5, 12);
    ctx.lineTo(18.6, 10.5);
    ctx.stroke();
  }
}

function FallingCanvas({ particle }: { particle: Particle }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const kind = SPRITE_FOR[particle];
    let w = 0;
    let h = 0;
    let raf = 0;
    type Piece = { x: number; y: number; r: number; v: number; sway: number; phase: number; spin: number; colour: string };
    let pieces: Piece[] = [];
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(kind ? 16 : 24, Math.min(kind ? 38 : 90, Math.round(w / (kind ? 32 : 14))));
      const palette = kind ? COLOURS[kind] : ["#ffffff"];
      pieces = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: kind ? 7 + Math.random() * 7 : 1 + Math.random() * 2.4,
        v: kind ? 0.5 + Math.random() * 0.8 : 0.4 + Math.random() * 0.9,
        sway: 8 + Math.random() * 18,
        phase: Math.random() * 6.28,
        spin: Math.random() * 6.28,
        colour: palette[Math.floor(Math.random() * palette.length)],
      }));
    };
    const tick = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const p of pieces) {
        p.y += p.v;
        if (p.y > h + 20) {
          p.y = -20;
          p.x = Math.random() * w;
        }
        const x = p.x + Math.sin(t / 1400 + p.phase) * p.sway;
        if (kind) {
          ctx.save();
          ctx.translate(x, p.y);
          ctx.rotate(Math.sin(t / 1100 + p.spin) * 0.45);
          const scale = (p.r * 2) / 24;
          ctx.scale(scale, scale);
          ctx.globalAlpha = 0.92;
          drawSprite(ctx, kind, p.colour);
          ctx.restore();
        } else {
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          ctx.beginPath();
          ctx.arc(x, p.y, p.r, 0, 6.283);
          ctx.fill();
        }
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
  }, [particle]);
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

function Ground({ season }: { season: string }) {
  const cls = "pointer-events-none fixed bottom-0 left-0 z-[20] h-7 w-full sm:h-9";
  if (season === "christmas") {
    return (
      <svg aria-hidden="true" viewBox="0 0 1200 40" preserveAspectRatio="none" className={cls}>
        <path d="M0 40 L0 22 C60 10 120 26 190 18 C260 10 330 28 410 20 C490 12 560 26 640 18 C720 10 790 26 870 18 C950 10 1030 28 1110 20 C1150 16 1180 18 1200 22 L1200 40 Z" fill="#f4f8ff" />
        <path d="M0 40 L0 30 C80 24 160 34 250 28 C340 22 430 34 520 28 C610 22 700 34 790 28 C880 22 970 34 1060 28 C1120 24 1170 30 1200 32 L1200 40 Z" fill="#dce8f7" />
      </svg>
    );
  }
  if (season === "summer") {
    return (
      <svg aria-hidden="true" viewBox="0 0 1200 40" preserveAspectRatio="none" className={cls}>
        <path d="M0 40 L0 14 C120 6 240 20 390 12 C540 4 690 20 840 12 C990 5 1110 14 1200 12 L1200 40 Z" fill="#48c1ee" opacity="0.9" />
        <path d="M0 40 L0 26 C150 20 270 30 420 25 C570 20 720 30 870 25 C1020 20 1140 27 1200 25 L1200 40 Z" fill="#f2d7a0" />
        <path d="M0 40 L0 34 C180 30 360 38 600 34 C840 30 1020 36 1200 34 L1200 40 Z" fill="#e8c070" />
      </svg>
    );
  }
  if (season === "autumn") {
    return (
      <svg aria-hidden="true" viewBox="0 0 1200 40" preserveAspectRatio="none" className={cls}>
        <path d="M0 40 L0 18 C120 10 210 24 360 16 C510 8 630 24 780 16 C930 9 1050 22 1200 16 L1200 40 Z" fill="#a0521d" />
        <path d="M0 40 L0 30 C180 24 330 36 540 29 C750 22 990 36 1200 29 L1200 40 Z" fill="#7a3d14" />
      </svg>
    );
  }
  return null;
}

function Cobweb({ flip }: { flip?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 40 40" className={`pointer-events-none fixed top-0 z-[45] h-24 w-24 sm:h-32 sm:w-32 ${flip ? "right-0 -scale-x-100" : "left-0"}`}>
      <g stroke="#e8e8f0" strokeWidth="0.8" opacity="0.7" fill="none">
        <path d="M0 0 L40 0 M0 0 L0 40 M0 0 L34 34 M0 0 L40 16 M0 0 L16 40" />
        <path d="M8 0 Q8 8 0 8 M16 0 Q15 15 0 16 M24 0 Q22 22 0 24 M32 0 Q29 29 0 32" />
      </g>
    </svg>
  );
}

function SummerSun() {
  return (
    <svg aria-hidden="true" viewBox="-30 -30 60 60" className="pointer-events-none fixed right-[-24px] top-20 z-[45] h-28 w-28 animate-[spin_40s_linear_infinite] opacity-90 sm:h-36 sm:w-36">
      <circle r="13" fill="#ffd23f" />
      {Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * Math.PI * 2;
        return <line key={i} x1={Math.cos(a) * 18} y1={Math.sin(a) * 18} x2={Math.cos(a) * 27} y2={Math.sin(a) * 27} stroke="#ffd23f" strokeWidth="4" strokeLinecap="round" />;
      })}
    </svg>
  );
}

export function SeasonalEffects() {
  const pathname = usePathname();
  const { season, overlay } = useSeason();
  const reduceMotion = useReducedMotion();
  const [bannerOpen, setBannerOpen] = useState(true);

  if (!season || !SHOW_ON.has(pathname)) return null;
  const falling = season.particle === "snow" || season.particle in SPRITE_FOR;

  return (
    <>
      {falling && !reduceMotion ? <FallingCanvas particle={season.particle} /> : null}
      {season.particle === "sun" && !reduceMotion ? <SummerSun /> : null}
      {season.particle === "cobwebs" ? (
        <>
          <Cobweb />
          <Cobweb flip />
        </>
      ) : null}
      {season.pile ? <Ground season={season.key} /> : null}
      {overlay && bannerOpen ? (
        <div className="fixed left-1/2 top-16 z-[47] flex max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-full bg-[#e3b341] px-4 py-2 text-sm font-semibold text-[#16294a] shadow-lg sm:top-20">
          <span>{overlay.message}</span>
          <button type="button" onClick={() => setBannerOpen(false)} aria-label="Close message" className="rounded-full px-1.5 leading-none hover:bg-black/10">
            ×
          </button>
        </div>
      ) : null}
      {overlay?.fireworks && !reduceMotion ? <Fireworks /> : null}
    </>
  );
}
