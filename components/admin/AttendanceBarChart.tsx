import type { WeeklyAttendance } from "@/lib/mock-data";

export default function AttendanceBarChart({ data }: { data: WeeklyAttendance[] }) {
  const max = Math.max(...data.map((d) => d.count));
  return (
    <div className="flex items-end gap-1.5 h-40 pt-4">
      {data.map((item, i) => {
        const pct = (item.count / max) * 100;
        const isLast = i === data.length - 1;
        return (
          <div key={item.week} className="flex-1 flex flex-col items-center gap-1.5" title={`${item.week}: ${item.count} visits`}>
            <span className={`text-[10px] font-medium tabular-nums ${isLast ? "text-blue-300" : "text-zinc-600"}`}>
              {isLast ? item.count : ""}
            </span>
            <div className="w-full relative" style={{ height: "100px" }}>
              <div
                className={`absolute bottom-0 w-full rounded-t transition-colors duration-150 ${isLast ? "bg-blue-400" : "bg-zinc-800 hover:bg-zinc-700"}`}
                style={{ height: `${pct}%` }}
              />
            </div>
            <span className="text-[10px] text-zinc-600 whitespace-nowrap tabular-nums">{item.week.split(" ")[0]}</span>
          </div>
        );
      })}
    </div>
  );
}
