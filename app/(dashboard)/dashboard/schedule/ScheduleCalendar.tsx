"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { formatFriendlyClassDate } from "@/lib/dates";
import type { ScheduleClass } from "./ScheduleView";

const WEEKDAY_HEADER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function isoOf(y: number, m: number, d: number): string {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}
function todayISO(): string {
  const t = new Date();
  return isoOf(t.getFullYear(), t.getMonth(), t.getDate());
}

// Month-grid alternative to the Browse list — same classes, same booking
// actions (renderClass is the Browse list's own card renderer, passed down
// so there's exactly one place booking/waitlist logic lives).
export function ScheduleCalendar({
  classesByDate,
  renderClass,
}: {
  classesByDate: Record<string, ScheduleClass[]>;
  renderClass: (classRecord: ScheduleClass) => ReactNode;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(todayISO());

  // Monday-first 6x7 grid, including leading/trailing days from adjacent
  // months so the grid is always a full rectangle.
  const firstOfMonth = new Date(year, month, 1);
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7; // 0 = Monday
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = useMemo(() => {
    const result: { iso: string; day: number; inMonth: boolean }[] = [];
    for (let i = firstWeekday; i > 0; i--) {
      const d = new Date(year, month, 1 - i);
      result.push({ iso: isoOf(d.getFullYear(), d.getMonth(), d.getDate()), day: d.getDate(), inMonth: false });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      result.push({ iso: isoOf(year, month, day), day, inMonth: true });
    }
    while (result.length < 42) {
      const last = result[result.length - 1];
      const [y, m, d] = last.iso.split("-").map(Number);
      const next = new Date(y, m - 1, d + 1);
      result.push({ iso: isoOf(next.getFullYear(), next.getMonth(), next.getDate()), day: next.getDate(), inMonth: false });
    }
    return result;
  }, [year, month, firstWeekday, daysInMonth]);

  function prevMonth() {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  }
  function nextMonth() {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  }

  const monthLabel = firstOfMonth.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const selectedClasses = selectedDate ? (classesByDate[selectedDate] ?? []) : [];
  const today = todayISO();

  return (
    <div className="surface-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={prevMonth}
            aria-label="Previous month"
            className="rounded-lg border border-white/[0.09] px-2.5 py-1.5 text-sm text-foreground transition hover:bg-white/[0.05]"
          >
            ←
          </button>
          <h3 className="min-w-[150px] text-center text-sm font-semibold uppercase tracking-wide text-zinc-200">
            {monthLabel}
          </h3>
          <button
            type="button"
            onClick={nextMonth}
            aria-label="Next month"
            className="rounded-lg border border-white/[0.09] px-2.5 py-1.5 text-sm text-foreground transition hover:bg-white/[0.05]"
          >
            →
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        {WEEKDAY_HEADER.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell) => {
          const dayClasses = classesByDate[cell.iso] ?? [];
          const isToday = cell.iso === today;
          const isSelected = cell.iso === selectedDate;
          return (
            <button
              key={cell.iso}
              type="button"
              onClick={() => setSelectedDate(cell.iso)}
              aria-pressed={isSelected}
              className={`flex h-14 flex-col items-center justify-start gap-1 rounded-lg border p-1.5 text-xs transition ${
                isSelected
                  ? "border-gold bg-gold/10"
                  : isToday
                    ? "border-gold/40 bg-gold/[0.05]"
                    : "border-white/[0.07] hover:bg-white/[0.04]"
              } ${cell.inMonth ? "" : "opacity-35"}`}
            >
              <span className={`font-medium ${isToday ? "text-gold" : "text-zinc-200"}`}>{cell.day}</span>
              {dayClasses.length > 0 ? (
                <span className="rounded-full bg-gold/20 px-1.5 text-[10px] font-semibold text-gold tabular-nums">
                  {dayClasses.length}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-5 space-y-3 border-t border-white/[0.07] pt-4">
        <p className="text-mono text-[11px] uppercase tracking-[0.24em] text-gold">
          {selectedDate ? formatFriendlyClassDate(selectedDate) : "Select a date"}
        </p>
        {selectedClasses.length === 0 ? (
          <p className="text-sm text-muted-foreground">No classes scheduled.</p>
        ) : (
          <div className="space-y-3">{selectedClasses.map((c) => renderClass(c))}</div>
        )}
      </div>
    </div>
  );
}
