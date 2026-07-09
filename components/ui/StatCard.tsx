interface Props {
  label: string;
  value: string | number;
  sub?: string;
  trend?: number; // positive = up, negative = down
  className?: string;
}

export default function StatCard({ label, value, sub, trend, className = "" }: Props) {
  return (
    <div className={`panel flex flex-col gap-2 p-4 ${className}`}>
      <p className="label-caps">{label}</p>
      <p className="text-display text-2xl text-zinc-50 leading-none tabular-nums">{value}</p>
      {(sub || trend !== undefined) && (
        <div className="flex items-center gap-1.5 mt-0.5">
          {trend !== undefined && (
            <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${trend >= 0 ? "bg-teal-500/10 text-teal-400" : "bg-red-500/10 text-red-400"}`}>
              {trend >= 0 ? "↑" : "↓"} {Math.abs(trend)}%
            </span>
          )}
          {sub && <span className="text-xs text-zinc-500">{sub}</span>}
        </div>
      )}
    </div>
  );
}
