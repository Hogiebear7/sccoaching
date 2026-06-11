"use client";
import { useState } from "react";
import CoachScheduleCard from "@/components/admin-mobile/CoachScheduleCard";
import { classes } from "@/lib/mock-data";

const today = new Date("2026-06-11");

function dateKey(d: Date) {
  return d.toISOString().split("T")[0];
}

function formatDay(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

const days = Array.from({ length: 7 }, (_, i) => {
  const d = new Date(today);
  d.setDate(today.getDate() + i);
  return dateKey(d);
});

export default function CoachSchedulePage() {
  const [selected, setSelected] = useState(days[0]);
  const dayClasses = classes.filter((c) => c.date === selected);

  return (
    <div className="px-4 pt-6 pb-4 flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-zinc-50">Schedule</h1>

      {/* Date strip */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {days.map((d) => {
          const date = new Date(d + "T00:00:00");
          const isToday = d === dateKey(today);
          const isSelected = d === selected;
          return (
            <button
              key={d}
              onClick={() => setSelected(d)}
              className={`flex-shrink-0 flex flex-col items-center px-3 py-2.5 rounded-xl border transition-colors ${
                isSelected
                  ? "bg-teal-600 border-teal-600 text-white"
                  : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700"
              }`}
            >
              <span className="text-[10px] uppercase tracking-wide font-medium">
                {isToday ? "Today" : date.toLocaleDateString("en-US", { weekday: "short" })}
              </span>
              <span className="text-lg font-bold mt-0.5">{date.getDate()}</span>
            </button>
          );
        })}
      </div>

      {/* Class count summary */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-400">{formatDay(selected)}</p>
        <span className="text-xs text-zinc-500">{dayClasses.length} {dayClasses.length === 1 ? "class" : "classes"}</span>
      </div>

      {/* Classes */}
      {dayClasses.length > 0 ? (
        <div className="flex flex-col gap-3">
          {dayClasses.map((cls) => (
            <CoachScheduleCard key={cls.id} gymClass={cls} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 gap-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1} className="w-12 h-12 text-zinc-700">
            <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
          <p className="text-zinc-600 text-sm">No classes scheduled</p>
        </div>
      )}
    </div>
  );
}
