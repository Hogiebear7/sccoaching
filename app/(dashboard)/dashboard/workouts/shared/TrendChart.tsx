"use client";

import { useEffect, useRef, useState } from "react";
import type { ExerciseTrendPoint } from "@/lib/workouts";

const CHART_W = 400;
const CHART_H = 120;
const PAD = { top: 20, right: 16, bottom: 28, left: 36 };

// Shared progression sparkline — identical in both view variants. The line
// draws itself in once the chart scrolls into view, rather than appearing
// fully-formed — makes the trend read as a build-up rather than a static
// image. Respects prefers-reduced-motion (renders fully drawn, no animation).
export function TrendChart({ points }: { points: ExerciseTrendPoint[] }) {
  const rootRef = useRef<SVGSVGElement>(null);
  const [visible, setVisible] = useState(false);
  const [animate, setAnimate] = useState(true);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setAnimate(false);
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const useWeight = points.some((p) => p.weightNum !== null);
  const chartPoints = useWeight
    ? points.filter((p) => p.weightNum !== null)
    : points.filter((p) => p.reps !== null);

  if (chartPoints.length < 2) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">
        Not enough data to show a trend.
      </p>
    );
  }

  const innerW = CHART_W - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top - PAD.bottom;

  const yVals = chartPoints.map((p) =>
    useWeight ? (p.weightNum as number) : (p.reps as number)
  );
  const minY = Math.min(...yVals);
  const maxY = Math.max(...yVals);
  const yRange = maxY === minY ? 1 : maxY - minY;

  const toX = (i: number) =>
    PAD.left +
    (chartPoints.length === 1 ? innerW / 2 : (i / (chartPoints.length - 1)) * innerW);
  const toY = (val: number) =>
    PAD.top + innerH - ((val - minY) / yRange) * innerH;

  const plotted = chartPoints.map((p, i) => {
    const yVal = useWeight ? (p.weightNum as number) : (p.reps as number);
    return {
      x: toX(i),
      y: toY(yVal),
      label: useWeight ? (p.rawWeight ?? "") : String(p.reps ?? ""),
      date: p.date,
    };
  });

  const polylinePoints = plotted.map((p) => `${p.x},${p.y}`).join(" ");
  const labelStep = Math.max(1, Math.ceil(chartPoints.length / 5));

  function shortDate(iso: string): string {
    const [, m, d] = iso.split("-").map(Number);
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${months[m - 1]} ${d}`;
  }

  return (
    <svg
      ref={rootRef}
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      width="100%"
      className="overflow-visible text-foreground"
      aria-hidden="true"
    >
      <line
        x1={PAD.left} y1={PAD.top}
        x2={PAD.left} y2={PAD.top + innerH}
        stroke="currentColor" strokeOpacity={0.12} strokeWidth={1}
      />
      <line
        x1={PAD.left} y1={PAD.top + innerH}
        x2={PAD.left + innerW} y2={PAD.top + innerH}
        stroke="currentColor" strokeOpacity={0.12} strokeWidth={1}
      />
      <polyline
        points={polylinePoints}
        pathLength={1}
        fill="none"
        style={{
          stroke: "var(--primary)",
          strokeDasharray: 1,
          strokeDashoffset: visible ? 0 : 1,
          transition: animate ? "stroke-dashoffset 900ms ease-out" : "none",
        }}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {plotted.map(({ x, y, label, date }, i) => (
        <g
          key={i}
          style={{
            opacity: visible ? 1 : 0,
            transition: animate ? "opacity 300ms ease-out" : "none",
            transitionDelay: animate ? `${300 + i * (600 / Math.max(1, plotted.length))}ms` : "0ms",
          }}
        >
          <circle cx={x} cy={y} r={3.5} style={{ fill: "var(--primary)" }} />
          <text x={x} y={y - 7} textAnchor="middle" fontSize={8} fill="currentColor" opacity={0.65}>
            {label}
          </text>
          {i % labelStep === 0 && (
            <text
              x={x}
              y={PAD.top + innerH + 14}
              textAnchor="middle"
              fontSize={8}
              fill="currentColor"
              opacity={0.45}
            >
              {shortDate(date)}
            </text>
          )}
        </g>
      ))}
      <text
        x={PAD.left - 4} y={PAD.top}
        textAnchor="end" dominantBaseline="middle"
        fontSize={8} fill="currentColor" opacity={0.45}
      >
        {maxY}
      </text>
      <text
        x={PAD.left - 4} y={PAD.top + innerH}
        textAnchor="end" dominantBaseline="middle"
        fontSize={8} fill="currentColor" opacity={0.45}
      >
        {minY}
      </text>
    </svg>
  );
}
