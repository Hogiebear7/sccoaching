"use client";
import { useState } from "react";
import ScheduleCard from "@/components/member/ScheduleCard";
import EmptyState from "@/components/ui/EmptyState";
import { classes, currentMember } from "@/lib/mock-data";

const DATES = [
  { date: "2026-06-11", label: "Thu 11" },
  { date: "2026-06-12", label: "Fri 12" },
  { date: "2026-06-13", label: "Sat 13" },
  { date: "2026-06-14", label: "Sun 14" },
  { date: "2026-06-15", label: "Mon 15" },
  { date: "2026-06-16", label: "Tue 16" },
  { date: "2026-06-17", label: "Wed 17" },
];

export default function SchedulePage() {
  const [selectedDate, setSelectedDate] = useState("2026-06-11");
  const dayClasses = classes.filter((c) => c.date === selectedDate);

  return (
    <div className="anim-rise pb-4">
      {/* Header */}
      <div className="px-4 pt-7 pb-4">
        <h1 className="text-display text-[26px] text-zinc-50">Schedule</h1>
        <p className="text-sm text-zinc-500 mt-1">Browse and book classes</p>
      </div>

      {/* Date strip */}
      <div className="flex gap-2 px-4 pb-4 overflow-x-auto no-scrollbar">
        {DATES.map(({ date, label }) => {
          const active = selectedDate === date;
          const [dow, day] = label.split(" ");
          return (
            <button
              key={date}
              onClick={() => setSelectedDate(date)}
              className={`flex-shrink-0 flex flex-col items-center w-14 py-2.5 rounded-2xl border transition-[background-color,border-color,transform] duration-150 active:scale-95 ${active ? "border-teal-700/60 bg-gradient-to-b from-teal-500 to-teal-600 text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16),0_1px_2px_0_rgba(0,0,0,0.4)]" : "bg-zinc-900 border-white/[0.07] text-zinc-400 hover:border-white/[0.15] hover:text-zinc-200"}`}
            >
              <span className={`text-[10px] tracking-[0.04em] uppercase ${active ? "font-semibold" : "font-medium"}`}>{dow}</span>
              <span className="text-display text-xl leading-tight tabular-nums">{day}</span>
            </button>
          );
        })}
      </div>

      {/* Classes */}
      <div className="px-4 flex flex-col gap-3">
        {dayClasses.length === 0 ? (
          <EmptyState
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            }
            title="No classes on this day"
            description="Pick another date, or log a solo workout instead."
          />
        ) : (
          dayClasses.map((cls) => (
            <ScheduleCard
              key={cls.id}
              cls={cls}
              enrolled={cls.enrolledMemberIds.includes(currentMember.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
