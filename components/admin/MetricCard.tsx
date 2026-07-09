interface Props {
  label: string;
  value: string | number;
  sub?: string;
  trend?: number;
  icon?: React.ReactNode;
}

export default function MetricCard({ label, value, sub, trend, icon }: Props) {
  return (
    <div className="panel p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <p className="label-caps">{label}</p>
        {icon && <div className="text-zinc-600">{icon}</div>}
      </div>
      <div>
        <p className="text-display text-[30px] text-zinc-50 leading-none tabular-nums">{value}</p>
        {sub && <p className="text-xs text-zinc-500 mt-1.5">{sub}</p>}
      </div>
      {trend !== undefined && (
        <div className="flex items-center gap-1.5 text-xs">
          <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${trend >= 0 ? "bg-teal-500/10 text-teal-400" : "bg-red-500/10 text-red-400"}`}>
            {trend >= 0 ? "↑" : "↓"} {Math.abs(trend)}%
          </span>
          <span className="text-zinc-600">vs last month</span>
        </div>
      )}
    </div>
  );
}
