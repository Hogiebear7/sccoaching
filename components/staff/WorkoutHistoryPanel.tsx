"use client";

import { useMemo, useState } from "react";

import { formatRun } from "@/app/(dashboard)/dashboard/workouts/shared/formatters";
import type { WorkoutSessionRecord } from "@/lib/db";
import { formatExerciseLoad } from "@/lib/workout-entries";

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

function SessionCard({ session }: { session: WorkoutSessionRecord }) {
  return (
    <div className="well p-4">
      <p className="text-xs text-muted-foreground">{session.date}</p>
      <h4 className="mt-1 text-base font-semibold">{session.title}</h4>
      {session.notes ? <p className="mt-2 text-sm text-muted-foreground">{session.notes}</p> : null}
      {session.exercises.length > 0 || session.runs.length > 0 ? (
        <div className="mt-3 space-y-1 border-t border-border pt-3">
          {session.exercises.map((ex, i) => {
            const load = formatExerciseLoad(ex);
            return (
              <div key={i} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-medium text-foreground">{ex.name}</span>
                {load ? <span className="text-xs text-muted-foreground">{load}</span> : null}
                {ex.notes ? <span className="text-xs text-muted-foreground">— {ex.notes}</span> : null}
              </div>
            );
          })}
          {session.runs.map((run, i) => (
            <div key={`run-${i}`} className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-medium text-foreground">Run</span>
              <span className="text-xs text-muted-foreground">{formatRun(run)}</span>
              {run.notes ? <span className="text-xs text-muted-foreground">— {run.notes}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      {session.durationMins !== null ? (
        <span className="mt-3 inline-block rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
          {session.durationMins} min
        </span>
      ) : null}
    </div>
  );
}

// Monday-first 6x7 grid, adapted from app/(staff)/staff/classes/ClassesCalendar.tsx
// (this codebase's established calendar pattern — inlined per-consumer
// rather than shared, matching that file's own precedent).
function WorkoutCalendar({ sessions }: { sessions: WorkoutSessionRecord[] }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const sessionsByDate = useMemo(() => {
    const map = new Map<string, WorkoutSessionRecord[]>();
    for (const s of sessions) {
      const list = map.get(s.date) ?? [];
      list.push(s);
      map.set(s.date, list);
    }
    return map;
  }, [sessions]);

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
  const selectedSessions = selectedDate ? (sessionsByDate.get(selectedDate) ?? []) : [];
  const today = todayISO();

  return (
    <div>
      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={prevMonth}
          aria-label="Previous month"
          className="rounded-lg border border-border px-2.5 py-1.5 text-sm text-foreground transition hover:bg-accent"
        >
          ←
        </button>
        <h4 className="min-w-[170px] text-center text-sm font-semibold">{monthLabel}</h4>
        <button
          type="button"
          onClick={nextMonth}
          aria-label="Next month"
          className="rounded-lg border border-border px-2.5 py-1.5 text-sm text-foreground transition hover:bg-accent"
        >
          →
        </button>
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
          const daySessions = sessionsByDate.get(cell.iso) ?? [];
          const isToday = cell.iso === today;
          const isSelected = cell.iso === selectedDate;
          return (
            <button
              key={cell.iso}
              type="button"
              disabled={daySessions.length === 0}
              onClick={() => setSelectedDate(cell.iso)}
              aria-pressed={isSelected}
              className={`flex h-16 flex-col items-center justify-start gap-1 rounded-lg border p-1.5 text-xs transition ${
                isSelected
                  ? "border-primary bg-primary/10"
                  : isToday
                    ? "border-gold/50 bg-gold/[0.06]"
                    : daySessions.length > 0
                      ? "border-border/60 hover:bg-accent/40"
                      : "border-border/30"
              } ${cell.inMonth ? "" : "opacity-35"}`}
            >
              <span className={`font-medium ${isToday ? "text-gold" : "text-foreground"}`}>{cell.day}</span>
              {daySessions.length > 0 ? (
                <span className="rounded-full bg-primary/20 px-1.5 text-[10px] font-semibold text-primary tabular-nums">
                  {daySessions.length}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {selectedSessions.length > 0 ? (
        <div className="mt-5 space-y-3 border-t border-border/60 pt-4">
          {selectedSessions.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function WorkoutHistoryPanel({ sessions }: { sessions: WorkoutSessionRecord[] }) {
  const [view, setView] = useState<"list" | "calendar">("list");
  const [visibleCount, setVisibleCount] = useState<5 | 10>(5);

  return (
    <div className="panel p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">Workout history</h3>
        {sessions.length > 0 ? (
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setView("list")}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                view === "list" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              List
            </button>
            <button
              type="button"
              onClick={() => setView("calendar")}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                view === "calendar" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              Calendar
            </button>
          </div>
        ) : null}
      </div>

      {sessions.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No workouts logged yet.</p>
      ) : view === "calendar" ? (
        <div className="mt-5">
          <WorkoutCalendar sessions={sessions} />
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {sessions.slice(0, visibleCount).map((session) => (
            <SessionCard key={session.id} session={session} />
          ))}
          {visibleCount < 10 && sessions.length > visibleCount ? (
            <button
              type="button"
              onClick={() => setVisibleCount(10)}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Show more
            </button>
          ) : sessions.length > 10 ? (
            <p className="text-xs text-muted-foreground">
              Showing the 10 most recent. Switch to Calendar view to browse older sessions.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
