import type { BodyweightEntry } from "@/lib/mock-data";

const W = 300, H = 80, PAD = { t: 8, r: 4, b: 20, l: 36 };
const cw = W - PAD.l - PAD.r;
const ch = H - PAD.t - PAD.b;

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function BodyweightChart({ entries, targetWeight }: { entries: BodyweightEntry[]; targetWeight: number }) {
  if (entries.length < 2) return <p className="text-sm text-zinc-500">Not enough data yet.</p>;

  const weights = entries.map((e) => e.weightKg);
  const allVals = [...weights, targetWeight];
  const min = Math.min(...allVals) - 1;
  const max = Math.max(...allVals) + 1;
  const range = max - min;

  function toY(v: number) { return PAD.t + ((max - v) / range) * ch; }
  function toX(i: number) { return PAD.l + (i / (entries.length - 1)) * cw; }

  const linePoints = entries.map((e, i) => `${toX(i).toFixed(1)},${toY(e.weightKg).toFixed(1)}`).join(" ");
  const targetY = toY(targetWeight);

  const areaPoints = [
    `${toX(0).toFixed(1)},${(PAD.t + ch).toFixed(1)}`,
    ...entries.map((e, i) => `${toX(i).toFixed(1)},${toY(e.weightKg).toFixed(1)}`),
    `${toX(entries.length - 1).toFixed(1)},${(PAD.t + ch).toFixed(1)}`,
  ].join(" ");

  const first = entries[0], last = entries[entries.length - 1];
  const diff = (last.weightKg - first.weightKg).toFixed(1);

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {/* Gridlines */}
        {[0, 0.5, 1].map((t) => {
          const val = min + t * range;
          const y = toY(val);
          return (
            <g key={t}>
              <line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke="#3f3f46" strokeWidth={0.5} strokeDasharray="3,3" />
              <text x={PAD.l - 4} y={y + 3} textAnchor="end" fontSize={7} fill="#71717a">{val.toFixed(0)}</text>
            </g>
          );
        })}
        {/* Target line */}
        <line x1={PAD.l} y1={targetY} x2={W - PAD.r} y2={targetY} stroke="#0d9488" strokeWidth={1} strokeDasharray="4,3" opacity={0.5} />
        <text x={W - PAD.r + 1} y={targetY + 3} fontSize={6} fill="#0d9488" opacity={0.7}>goal</text>
        {/* Area fill */}
        <polygon points={areaPoints} fill="#0d9488" opacity={0.07} />
        {/* Line */}
        <polyline points={linePoints} fill="none" stroke="#0d9488" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {/* Last dot */}
        <circle cx={toX(entries.length - 1)} cy={toY(last.weightKg)} r={3} fill="#0d9488" />
        {/* X labels */}
        {[0, entries.length - 1].map((i) => (
          <text key={i} x={toX(i)} y={H - 3} textAnchor={i === 0 ? "start" : "end"} fontSize={7} fill="#71717a">
            {formatDate(entries[i].date)}
          </text>
        ))}
      </svg>
      <div className="flex items-center justify-between mt-1">
        <p className="text-xs text-zinc-500">Target: <span className="text-teal-400 font-medium">{targetWeight} kg</span></p>
        <p className={`text-xs font-medium ${parseFloat(diff) <= 0 ? "text-teal-400" : "text-zinc-400"}`}>
          {parseFloat(diff) <= 0 ? "▼" : "▲"} {Math.abs(parseFloat(diff))} kg over {entries.length} weeks
        </p>
      </div>
    </div>
  );
}
