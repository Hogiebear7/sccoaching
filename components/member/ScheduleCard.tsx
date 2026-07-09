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

export default function ScheduleCard({
  cls,
  enrolled: initialEnrolled,
}: {
  cls: GymClass;
  enrolled: boolean;
}) {
  const [enrolled, setEnrolled] = useState(initialEnrolled);
  const spotsLeft = cls.capacity - cls.enrolled;
  const typeKey = cls.type.toLowerCase() as Parameters<typeof Badge>[0]["variant"];

  return (
    <div className="panel p-4">
      <div className="grid grid-cols-[80px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2">
        <div className="col-start-1 row-span-2 text-left">
          <p className="text-display text-lg leading-none text-foreground tabular-nums">
            {formatTime(cls.time)}
          </p>
          <p className="mt-2 text-xs text-muted-foreground tabular-nums">{cls.durationMins}min</p>
        </div>

        <div className="col-start-2 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 text-sm font-semibold leading-snug text-foreground">
              {cls.name}
            </p>
            <Badge variant={typeKey}>{cls.type}</Badge>
          </div>
        </div>

        <div className="col-start-3 row-span-2 flex items-start">
          <button
            onClick={() => setEnrolled(!enrolled)}
            className={`min-w-[72px] rounded-lg px-3 py-2 text-xs font-semibold transition-[background-color,border-color,transform] duration-150 active:translate-y-px ${
              enrolled
                ? "border border-white/[0.1] bg-white/[0.04] text-foreground hover:bg-white/[0.07]"
                : "border border-teal-700/60 bg-gradient-to-b from-teal-500 to-teal-600 text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16),0_1px_2px_0_rgba(0,0,0,0.4)] hover:from-teal-400 hover:to-teal-500"
            }`}
          >
            {enrolled ? "Cancel" : "Book"}
          </button>
        </div>

        <div className="col-start-2 min-w-0">
          <p className="text-xs text-muted-foreground">
            {cls.coachName} · {cls.enrolled}/{cls.capacity} enrolled
          </p>

          {spotsLeft <= 3 && !enrolled && (
            <p className="mt-1 text-xs text-orange-400">
              Only {spotsLeft} spot{spotsLeft !== 1 ? "s" : ""} left
            </p>
          )}
        </div>
      </div>
    </div>
  );
}