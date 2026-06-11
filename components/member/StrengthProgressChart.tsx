import type { StrengthPoint } from "@/lib/mock-data";

interface Series {
  label: string;
  data: StrengthPoint[];
  color: string;
}

interface Props {
  series: Series[];
}

const W = 300, H = 90, PAD = { t: 8, r: 4, b: 20, l: 40 };
const cw = W - PAD.l - PAD.r;
const ch = H - PAD.t - PAD.b;

function toPoints(data: StrengthPoint[], allMin: number, allMax: number): string {
  if (data.length < 2) return "";
  const range = allMax - allMin || 1;
  return data.map((p, i) => {
    const x = PAD.l + (i / (data.length - 1)) * cw;
    const y = PAD.t + ((allMax - p.maxWeightKg) / range) * ch;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function formatDate(d: string) {
  const dt = new Date(d);
  return dt.toLocaleDateString("en-US", { month: "short" });
}

export default function StrengthProgressChart({ series }: Props) {
  const allValues = series.flatMap((s) => s.data.map((p) => p.maxWeightKg));
  const allMin = Math.min(...allValues) * 0.9;
  const allMax = Math.max(...allValues) * 1.05;

  const longestSeries = series.reduce((a, b) => a.data.length > b.data.length ? a : b, series[0]);

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {/* Y-axis labels */}
        {[0, 0.5, 1].map((t) => {
          const val = allMin + t * (allMax - allMin);
          const y = PAD.t + (1 - t) * ch;
          return (
            <g key={t}>
              <line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke="#3f3f46" strokeWidth={0.5} strokeDasharray="3,3" />
              <text x={PAD.l - 4} y={y + 3} textAnchor="end" fontSize={7} fill="#71717a">{Math.round(val)}</text>
            </g>
          );
        })}
        {/* X-axis labels */}
        {longestSeries.data.filter((_, i, arr) => i === 0 || i === Math.floor(arr.length / 2) || i === arr.length - 1).map((p, i, arr) => {
          const idx = longestSeries.data.indexOf(p);
          const x = PAD.l + (idx / (longestSeries.data.length - 1)) * cw;
          return (
            <text key={i} x={x} y={H - 2} textAnchor={i === 0 ? "start" : i === arr.length - 1 ? "end" : "middle"} fontSize={7} fill="#71717a">
              {formatDate(p.date)}
            </text>
          );
        })}
        {/* Lines */}
        {series.map((s) => (
          <polyline key={s.label} points={toPoints(s.data, allMin, allMax)} fill="none" stroke={s.color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {/* Dots at last point */}
        {series.map((s) => {
          if (s.data.length === 0) return null;
          const last = s.data[s.data.length - 1];
          const range = allMax - allMin || 1;
          const x = PAD.l + cw;
          const y = PAD.t + ((allMax - last.maxWeightKg) / range) * ch;
          return <circle key={s.label} cx={x} cy={y} r={2.5} fill={s.color} />;
        })}
      </svg>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {series.map((s) => {
          const last = s.data[s.data.length - 1];
          return (
            <div key={s.label} className="flex items-center gap-1.5">
              <span className="w-2.5 h-0.5 rounded-full inline-block" style={{ backgroundColor: s.color }} />
              <span className="text-xs text-zinc-400">{s.label}</span>
              {last && <span className="text-xs font-semibold" style={{ color: s.color }}>{last.maxWeightKg}kg</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
