"use client";
import { useState } from "react";
import Badge from "@/components/ui/Badge";
import type { GymClass } from "@/lib/mock-data";

function formatTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const period = h < 12 ? "am" : "pm";
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, "0")}${period}`;
}

export default function ScheduleCard({ cls, enrolled: initialEnrolled }: { cls: GymClass; enrolled: boolean }) {
  const [enrolled, setEnrolled] = useState(initialEnrolled);
  const spotsLeft = cls.capacity - cls.enrolled;
  const typeKey = cls.type.toLowerCase() as Parameters<typeof Badge>[0]["variant"];

  return (
    <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 flex items-center gap-4">
      <div className="flex-shrink-0 text-center w-14">
        <p className="text-lg font-bold text-zinc-50">{formatTime(cls.time)}</p>
        <p className="text-[10px] text-zinc-500">{cls.durationMins}min</p>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-zinc-100 text-sm">{cls.name}</p>
          <Badge variant={typeKey}>{cls.type}</Badge>
        </div>
        <p className="text-xs text-zinc-500 mt-0.5">{cls.coachName} · {cls.enrolled}/{cls.capacity} enrolled</p>
        {spotsLeft <= 3 && !enrolled && (
          <p className="text-xs text-orange-400 mt-0.5">Only {spotsLeft} spot{spotsLeft !== 1 ? "s" : ""} left</p>
        )}
      </div>
      <button
        onClick={() => setEnrolled(!enrolled)}
        className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${enrolled ? "bg-zinc-700 text-zinc-300 hover:bg-zinc-600" : "bg-teal-600 text-white hover:bg-teal-500"}`}
      >
        {enrolled ? "Cancel" : "Book"}
      </button>
    </div>
  );
}
