interface Props {
  label: string;
  value: string | number;
  sub?: string;
  trend?: number; // positive = up, negative = down
  className?: string;
}

export default function StatCard({ label, value, sub, trend, className = "" }: Props) {
  return (
    <div className={`bg-zinc-900 rounded-2xl border border-zinc-800 p-4 flex flex-col gap-1 ${className}`}>
      <p className="text-xs text-zinc-500 uppercase tracking-wide font-medium">{label}</p>
      <p className="text-2xl font-bold text-zinc-50 leading-none">{value}</p>
      {(sub || trend !== undefined) && (
        <div className="flex items-center gap-1.5 mt-0.5">
          {trend !== undefined && (
            <span className={`text-xs font-medium ${trend >= 0 ? "text-teal-400" : "text-red-400"}`}>
              {trend >= 0 ? "▲" : "▼"} {Math.abs(trend)}%
            </span>
          )}
          {sub && <span className="text-xs text-zinc-500">{sub}</span>}
        </div>
      )}
    </div>
  );
}
