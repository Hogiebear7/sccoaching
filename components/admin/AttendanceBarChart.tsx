import type { WeeklyAttendance } from "@/lib/mock-data";

export default function AttendanceBarChart({ data }: { data: WeeklyAttendance[] }) {
  const max = Math.max(...data.map((d) => d.count));
  return (
    <div className="flex items-end gap-1.5 h-40 pt-4">
      {data.map((item, i) => {
        const pct = (item.count / max) * 100;
        const isLast = i === data.length - 1;
        return (
          <div key={item.week} className="flex-1 flex flex-col items-center gap-1" title={`${item.week}: ${item.count} visits`}>
            <span className={`text-[9px] font-medium ${isLast ? "text-teal-400" : "text-zinc-600"}`}>
              {isLast ? item.count : ""}
            </span>
            <div className="w-full relative" style={{ height: "100px" }}>
              <div
                className={`absolute bottom-0 w-full rounded-t-sm transition-all ${isLast ? "bg-teal-500" : "bg-zinc-700 hover:bg-zinc-600"}`}
                style={{ height: `${pct}%` }}
              />
            </div>
            <span className="text-[9px] text-zinc-600 whitespace-nowrap">{item.week.split(" ")[0]}</span>
          </div>
        );
      })}
    </div>
  );
}
