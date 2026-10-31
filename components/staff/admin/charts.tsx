// Small SVG charts for the admin Overview (DESIGN.md "Admin area"): an area line for a trend, columns for counts per period, and a ring
// for a mix. No chart library: each is a few paths, scales with its container, and carries a text summary for screen readers. Colours are
// fixed for the light workspace: navy for the series, gold for the latest point, data blue for the mix.

import type { DashboardPoint } from "@/lib/staff-dashboard";

const INK = "#0a1526";
const GOLD = "#c6a15b";
const GRID = "#e9edf3";
const AXIS = "#5d6a80";

function niceMax(max: number): number {
  if (max <= 4) return 4;
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  return Math.ceil(max / step) * step;
}

// Monotone cubic path through the points (Fritsch–Carlson), so the line is smooth but never overshoots below zero or past a peak.
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 3) return pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const n = pts.length;
  const d: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]));
  m.push(d[0]);
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  let path = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (pts[i + 1][0] - pts[i][0]) / 3;
    path += ` C${(pts[i][0] + dx).toFixed(1)},${(pts[i][1] + m[i] * dx).toFixed(1)} ${(pts[i + 1][0] - dx).toFixed(1)},${(pts[i + 1][1] - m[i + 1] * dx).toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
  }
  return path;
}

function summary(points: DashboardPoint[], unit: string) {
  return points.map((p) => `${p.full}: ${p.value} ${unit}`).join("; ");
}

export function AreaTrend({ points, unit }: { points: DashboardPoint[]; unit: string }) {
  const W = 600;
  const H = 220;
  const pad = { l: 32, r: 12, t: 12, b: 28 };
  const max = niceMax(Math.max(...points.map((p) => p.value), 0));
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(points.length - 1, 1);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const line = smoothPath(points.map((p, i) => [x(i), y(p.value)]));
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - pad.b} L${x(0).toFixed(1)},${H - pad.b} Z`;
  const ticks = [0, max / 2, max];
  const last = points.length - 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary(points, unit)} className="h-auto w-full">
      <defs>
        <linearGradient id="admin-area-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={INK} stopOpacity="0.14" />
          <stop offset="100%" stopColor={INK} stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeDasharray={t === 0 ? undefined : "3 4"} />
          <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={AXIS}>
            {Math.round(t)}
          </text>
        </g>
      ))}
      <path d={area} fill="url(#admin-area-fill)" />
      <path d={line} fill="none" stroke={INK} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={p.full} cx={x(i)} cy={y(p.value)} r={i === last ? 5 : 3} fill={i === last ? GOLD : "#ffffff"} stroke={i === last ? GOLD : INK} strokeWidth="2">
          <title>{`${p.full}: ${p.value} ${unit}`}</title>
        </circle>
      ))}
      {points.map((p, i) => (
        <text key={`l-${p.full}`} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill={AXIS}>
          {p.label}
        </text>
      ))}
    </svg>
  );
}

export function Columns({ points, unit }: { points: DashboardPoint[]; unit: string }) {
  const W = 600;
  const H = 220;
  const pad = { l: 32, r: 8, t: 12, b: 28 };
  const max = niceMax(Math.max(...points.map((p) => p.value), 0));
  const band = (W - pad.l - pad.r) / points.length;
  const bw = Math.min(36, band * 0.56);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const ticks = [0, max / 2, max];
  const last = points.length - 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary(points, unit)} className="h-auto w-full">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeDasharray={t === 0 ? undefined : "3 4"} />
          <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={AXIS}>
            {Math.round(t)}
          </text>
        </g>
      ))}
      {points.map((p, i) => {
        const cx = pad.l + band * i + band / 2;
        const top = y(p.value);
        const h = Math.max(H - pad.b - top, p.value > 0 ? 2 : 0);
        return (
          <g key={p.full}>
            <rect x={cx - bw / 2} y={H - pad.b - h} width={bw} height={h} rx="4" fill={i === last ? GOLD : INK} opacity={i === last ? 1 : 0.85}>
              <title>{`${p.full}: ${p.value} ${unit}`}</title>
            </rect>
            {p.value > 0 ? (
              <text x={cx} y={H - pad.b - h - 6} textAnchor="middle" fontSize="11" fontWeight="600" fill={INK}>
                {p.value}
              </text>
            ) : null}
            <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill={AXIS}>
              {p.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const MIX_COLOURS = ["#0a1526", "#2563eb", "#c6a15b", "#15803d", "#7c8aa3", "#c9d1dd"];

export function MixRing({ parts, centreLabel }: { parts: { label: string; value: number }[]; centreLabel: string }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  const R = 52;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex flex-col items-center gap-5">
      <svg viewBox="0 0 140 140" className="h-36 w-36 shrink-0" role="img" aria-label={parts.map((p) => `${p.label}: ${p.value}`).join("; ")}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="#eef2f7" strokeWidth="16" />
        {total > 0
          ? parts.map((p, i) => {
              const len = (p.value / total) * C;
              const seg = (
                <circle
                  key={p.label}
                  cx="70"
                  cy="70"
                  r={R}
                  fill="none"
                  stroke={MIX_COLOURS[i % MIX_COLOURS.length]}
                  strokeWidth="16"
                  strokeDasharray={`${Math.max(len - 2, 0)} ${C}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 70 70)"
                />
              );
              offset += len;
              return seg;
            })
          : null}
        <text x="70" y="68" textAnchor="middle" fontSize="26" fontWeight="650" fill={INK}>
          {total}
        </text>
        <text x="70" y="88" textAnchor="middle" fontSize="11" fill={AXIS}>
          {centreLabel}
        </text>
      </svg>
      <ul className="w-full min-w-0 space-y-2.5">
        {parts.map((p, i) => (
          <li key={p.label} className="flex items-center gap-3 text-sm">
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: MIX_COLOURS[i % MIX_COLOURS.length] }} />
            <span className="min-w-0 flex-1 leading-snug text-foreground">{p.label}</span>
            <span className="tabular-nums font-semibold text-foreground">{p.value}</span>
            <span className="w-10 text-right tabular-nums text-muted-foreground">{total ? Math.round((p.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
