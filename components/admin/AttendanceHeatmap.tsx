import type { AttendanceCell } from "@/lib/mock-data";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 16 }, (_, i) => {
  const h = i + 6;
  return h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`;
});

function intensity(count: number, max: number): string {
  if (count === 0) return "bg-zinc-900";
  const t = count / max;
  if (t < 0.2) return "bg-teal-900/40";
  if (t < 0.4) return "bg-teal-800/60";
  if (t < 0.6) return "bg-teal-700/70";
  if (t < 0.8) return "bg-teal-600/80";
  return "bg-teal-500";
}

export default function AttendanceHeatmap({ cells }: { cells: AttendanceCell[] }) {
  const max = Math.max(...cells.map((c) => c.count));
  const grid = new Map(cells.map((c) => [`${c.dayOfWeek}-${c.hour}`, c.count]));

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[480px]">
        {/* Day headers */}
        <div className="flex pl-10 gap-px mb-1">
          {DAYS.map((d) => (
            <div key={d} className="flex-1 text-center text-[10px] font-medium text-zinc-500">{d}</div>
          ))}
        </div>
        {/* Rows: hour × day */}
        {HOURS.map((label, hi) => {
          const hour = hi + 6;
          return (
            <div key={hour} className="flex items-center gap-px mb-px">
              <div className="w-10 text-[9px] text-zinc-600 text-right pr-1.5 flex-shrink-0">{label}</div>
              {DAYS.map((_, di) => {
                const count = grid.get(`${di}-${hour}`) ?? 0;
                return (
                  <div
                    key={di}
                    title={`${DAYS[di]} ${label}: ${count} visits`}
                    className={`flex-1 h-5 rounded-[2px] ${intensity(count, max)} transition-colors`}
                  />
                );
              })}
            </div>
          );
        })}
        {/* Legend */}
        <div className="flex items-center gap-1.5 mt-3 pl-10">
          <span className="text-[10px] text-zinc-600">Less</span>
          {["bg-zinc-900", "bg-teal-900/40", "bg-teal-700/70", "bg-teal-500"].map((c, i) => (
            <div key={i} className={`w-4 h-4 rounded-sm ${c}`} />
          ))}
          <span className="text-[10px] text-zinc-600">More</span>
        </div>
      </div>
    </div>
  );
}
