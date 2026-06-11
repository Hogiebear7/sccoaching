interface Props {
  label: string;
  value: string | number;
  sub?: string;
  trend?: number;
  icon?: React.ReactNode;
}

export default function MetricCard({ label, value, sub, trend, icon }: Props) {
  return (
    <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <p className="text-xs text-zinc-500 uppercase tracking-wide font-medium">{label}</p>
        {icon && <div className="text-zinc-600">{icon}</div>}
      </div>
      <div>
        <p className="text-3xl font-bold text-zinc-50 leading-none">{value}</p>
        {sub && <p className="text-xs text-zinc-500 mt-1">{sub}</p>}
      </div>
      {trend !== undefined && (
        <div className={`flex items-center gap-1 text-xs font-medium ${trend >= 0 ? "text-teal-400" : "text-red-400"}`}>
          <span>{trend >= 0 ? "▲" : "▼"} {Math.abs(trend)}%</span>
          <span className="text-zinc-600 font-normal">vs last month</span>
        </div>
      )}
    </div>
  );
}
