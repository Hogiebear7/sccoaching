"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { ClassCategoryRecord } from "@/lib/db";
import { classCategoryLabel } from "@/lib/scheduling-status";
import type { ClassPressureSummary } from "@/lib/staff-operations";

// Condensed month view for Operations — same grid pattern as the staff
// Classes calendar, but built on the lighter ClassPressureSummary the
// Operations page already fetches, so upcoming classes read as a shape
// staff can scan at a glance instead of a long flat list.
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

export function OperationsCalendar({
  classes,
  categories,
  deletedLabels,
}: {
  classes: ClassPressureSummary[];
  categories: ClassCategoryRecord[];
  deletedLabels: Record<string, string>;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(todayISO());

  const classesByDate = useMemo(() => {
    const map = new Map<string, ClassPressureSummary[]>();
    for (const c of classes) {
      const list = map.get(c.date) ?? [];
      list.push(c);
      map.set(c.date, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return map;
  }, [classes]);

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
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">Upcoming classes</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={prevMonth}
            aria-label="Previous month"
            className="rounded-lg border border-border px-2.5 py-1.5 text-sm text-foreground transition hover:bg-accent"
          >
            ←
          </button>
          <h4 className="min-w-[150px] text-center text-sm font-semibold">{monthLabel}</h4>
          <button
            type="button"
            onClick={nextMonth}
            aria-label="Next month"
            className="rounded-lg border border-border px-2.5 py-1.5 text-sm text-foreground transition hover:bg-accent"
          >
            →
          </button>
        </div>
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
          const hasWaitlist = dayClasses.some((c) => c.waitlistCount > 0);
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
                <span
                  className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${
                    hasWaitlist ? "bg-gold/20 text-gold" : "bg-primary/20 text-primary"
                  }`}
                >
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
              <div key={c.classId} className="well flex flex-wrap items-center justify-between gap-2 p-3">
                <div>
                  <p className="text-sm font-medium">{c.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.startTime} · {classCategoryLabel(categories, c.category, deletedLabels)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      c.isFull ? "bg-amber-500/15 text-amber-300" : "bg-secondary text-secondary-foreground"
                    }`}
                  >
                    {c.bookedCount} of {c.capacity} booked
                  </span>
                  {c.waitlistCount > 0 ? (
                    <span className="rounded-full bg-gold/15 px-3 py-1 text-xs font-semibold text-gold">
                      {c.waitlistCount} waitlisted
                    </span>
                  ) : null}
                  <Link
                    href="/staff/classes"
                    className="rounded-xl border border-border px-3 py-1 text-xs font-medium text-foreground transition hover:bg-accent"
                  >
                    Manage
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
