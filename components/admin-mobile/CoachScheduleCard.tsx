import Badge from "@/components/ui/Badge";
import type { GymClass } from "@/lib/mock-data";

function formatTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const period = h < 12 ? "am" : "pm";
  return `${h % 12 || 12}:${m.toString().padStart(2, "0")}${period}`;
}

export default function CoachScheduleCard({ cls }: { cls: GymClass }) {
  const typeKey = cls.type.toLowerCase() as Parameters<typeof Badge>[0]["variant"];
  const spotsLeft = cls.capacity - cls.enrolled;
  const pct = Math.round((cls.enrolled / cls.capacity) * 100);
  return (
    <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-zinc-100">{cls.name}</p>
            <Badge variant={typeKey}>{cls.type}</Badge>
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">{formatTime(cls.time)} · {cls.durationMins}min</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-lg font-bold text-zinc-50">{cls.enrolled}<span className="text-sm text-zinc-500">/{cls.capacity}</span></p>
          <p className="text-[10px] text-zinc-600">{spotsLeft} spot{spotsLeft !== 1 ? "s" : ""} left</p>
        </div>
      </div>
      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${pct >= 90 ? "bg-orange-500" : "bg-teal-600"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
