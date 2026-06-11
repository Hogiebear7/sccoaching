"use client";
import { useState } from "react";
import ScheduleCard from "@/components/member/ScheduleCard";
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
    <div className="pb-4">
      {/* Header */}
      <div className="px-4 pt-6 pb-4">
        <h1 className="text-2xl font-bold text-zinc-50">Schedule</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Browse and book classes</p>
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
              className={`flex-shrink-0 flex flex-col items-center w-14 py-2.5 rounded-2xl border transition-colors ${active ? "bg-teal-600 border-teal-600 text-white" : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-600"}`}
            >
              <span className="text-[10px] font-medium">{dow}</span>
              <span className="text-xl font-bold leading-tight">{day}</span>
            </button>
          );
        })}
      </div>

      {/* Classes */}
      <div className="px-4 flex flex-col gap-3">
        {dayClasses.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-zinc-500 text-sm">No classes on this day.</p>
          </div>
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
