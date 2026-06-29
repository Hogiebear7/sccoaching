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
    <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4">
      <div className="grid grid-cols-[80px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2">
        <div className="col-start-1 row-span-2 text-left">
          <p className="text-lg font-semibold leading-none text-zinc-50">
            {formatTime(cls.time)}
          </p>
          <p className="mt-2 text-xs text-zinc-500">{cls.durationMins}min</p>
        </div>

        <div className="col-start-2 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 text-sm font-semibold leading-snug text-zinc-100">
              {cls.name}
            </p>
            <Badge variant={typeKey}>{cls.type}</Badge>
          </div>
        </div>

        <div className="col-start-3 row-span-2 flex items-start">
          <button
            onClick={() => setEnrolled(!enrolled)}
            className={`min-w-[72px] rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
              enrolled
                ? "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
                : "bg-teal-600 text-white hover:bg-teal-500"
            }`}
          >
            {enrolled ? "Cancel" : "Book"}
          </button>
        </div>

        <div className="col-start-2 min-w-0">
          <p className="text-xs text-zinc-500">
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