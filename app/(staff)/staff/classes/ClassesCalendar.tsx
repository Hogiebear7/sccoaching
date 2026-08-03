"use client";

import { useMemo, useState } from "react";

import type { ClassCategoryRecord } from "@/lib/db";
import { classCategoryLabel } from "@/lib/scheduling-status";

export type CalendarClass = {
  id: string;
  title: string;
  category: string;
  date: string; // YYYY-MM-DD
  startTime: string;
  coachUserId: string;
  coachLabel: string;
  capacity: number;
  bookedCount: number;
};

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

export function ClassesCalendar({
  classes,
  categories,
  deletedLabels,
  coaches,
}: {
  classes: CalendarClass[];
  categories: ClassCategoryRecord[];
  deletedLabels: Record<string, string>;
  coaches: { userId: string; label: string }[];
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [coachFilter, setCoachFilter] = useState<string>("all");
  const [selectedDate, setSelectedDate] = useState<string | null>(todayISO());

  const filteredClasses = useMemo(
    () => (coachFilter === "all" ? classes : classes.filter((c) => c.coachUserId === coachFilter)),
    [classes, coachFilter]
  );

  const classesByDate = useMemo(() => {
    const map = new Map<string, CalendarClass[]>();
    for (const c of filteredClasses) {
      const list = map.get(c.date) ?? [];
      list.push(c);
      map.set(c.date, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return map;
  }, [filteredClasses]);

  // Monday-first 6x7 grid, including leading/trailing days from adjacent
  // months so the grid is always a full rectangle.
  const firstOfMonth = new Date(year, month, 1);
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7; // 0 = Monday
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: { iso: string; day: number; inMonth: boolean }[] = [];
  for (let i = firstWeekday; i > 0; i--) {
    const d = new Date(year, month, 1 - i);
    cells.push({ iso: isoOf(d.getFullYear(), d.getMonth(), d.getDate()), day: d.getDate(), inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ iso: isoOf(year, month, day), day, inMonth: true });
  }
  while (cells.length < 42) {
    const last = cells[cells.length - 1];
    const [y, m, d] = last.iso.split("-").map(Number);
    const next = new Date(y, m - 1, d + 1);
    cells.push({ iso: isoOf(next.getFullYear(), next.getMonth(), next.getDate()), day: next.getDate(), inMonth: false });
  }

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

  const monthLabel = firstOfMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const selectedClasses = selectedDate ? (classesByDate.get(selectedDate) ?? []) : [];
  const today = todayISO();

  return (
    <div className="panel p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={prevMonth}
            aria-label="Previous month"
            className="rounded-lg border border-border px-2.5 py-1.5 text-sm text-foreground transition hover:bg-accent"
          >
            ←
          </button>
          <h3 className="min-w-[170px] text-center text-lg font-semibold">{monthLabel}</h3>
          <button
            type="button"
            onClick={nextMonth}
            aria-label="Next month"
            className="rounded-lg border border-border px-2.5 py-1.5 text-sm text-foreground transition hover:bg-accent"
          >
            →
          </button>
        </div>
        <select
          value={coachFilter}
          onChange={(e) => setCoachFilter(e.target.value)}
          aria-label="Filter by coach"
          className="input-field px-3 py-2 text-sm"
        >
          <option value="all">All coaches</option>
          {coaches.map((c) => (
            <option key={c.userId} value={c.userId}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-muted-foreground">
        {WEEKDAY_HEADER.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell) => {
          const dayClasses = classesByDate.get(cell.iso) ?? [];
          const isToday = cell.iso === today;
          const isSelected = cell.iso === selectedDate;
          return (
            <button
              key={cell.iso}
              type="button"
              onClick={() => setSelectedDate(cell.iso)}
              aria-pressed={isSelected}
              className={`flex h-16 flex-col items-center justify-start gap-1 rounded-lg border p-1.5 text-xs transition ${
                isSelected
                  ? "border-primary bg-primary/10"
                  : isToday
                    ? "border-gold/50 bg-gold/[0.06]"
                    : "border-border/60 hover:bg-accent/40"
              } ${cell.inMonth ? "" : "opacity-35"}`}
            >
              <span className={`font-medium ${isToday ? "text-gold" : "text-foreground"}`}>{cell.day}</span>
              {dayClasses.length > 0 ? (
                <span className="rounded-full bg-primary/20 px-1.5 text-[10px] font-semibold text-primary tabular-nums">
                  {dayClasses.length}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-5 border-t border-border/60 pt-4">
        <h4 className="text-sm font-semibold">
          {selectedDate
            ? new Date(`${selectedDate}T00:00:00`).toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })
            : "Select a date"}
        </h4>
        {selectedClasses.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No classes scheduled.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {selectedClasses.map((c) => (
              <div key={c.id} className="well flex flex-wrap items-center justify-between gap-2 p-3">
                <div>
                  <p className="text-sm font-medium">{c.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.startTime} · {classCategoryLabel(categories, c.category, deletedLabels)} · {c.coachLabel}
                  </p>
                </div>
                <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                  {c.bookedCount} of {c.capacity} booked
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
