import type { WorkoutSessionRecord } from "@/lib/db";

const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

export interface DayDot {
  iso: string;
  letter: string;
  trained: boolean;
  isToday: boolean;
}

// The current calendar week, Monday through Sunday (not a trailing 7-day
// window) — so the row's day order never shifts and "today" always lands in
// the position matching its actual weekday. Days after today are included
// (rendered as plain, untrained dots by the caller) so the row's shape is
// stable all week rather than growing day by day.
export function computeCurrentWeekDays(sessions: WorkoutSessionRecord[], todayISO: string): DayDot[] {
  const sessionDates = new Set(sessions.map((s) => s.date));
  const today = new Date(`${todayISO}T00:00:00Z`);
  const todayWeekdayIdx = (today.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  const monday = new Date(today);
  monday.setUTCDate(monday.getUTCDate() - todayWeekdayIdx);

  const days: DayDot[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    days.push({ iso, letter: WEEKDAY_LETTERS[i], trained: sessionDates.has(iso), isToday: iso === todayISO });
  }
  return days;
}

export interface WeekFrequency {
  mondayIso: string;
  count: number;
}

// Session count per ISO week, last N weeks (default 6) — a training-
// frequency sparkline. Deliberately session COUNT, not kg volume: volume is
// already computed by weeklyWorkoutStats for the current week only, and
// re-deriving historical kg here would risk exactly the "two
// implementations" drift these variants are required to avoid.
export function computeWeeklyFrequency(
  sessions: WorkoutSessionRecord[],
  todayISO: string,
  weeks = 6
): WeekFrequency[] {
  function mondayOf(iso: string): string {
    const d = new Date(`${iso}T00:00:00Z`);
    const day = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
    return d.toISOString().slice(0, 10);
  }
  const thisMonday = mondayOf(todayISO);
  const result: WeekFrequency[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const d = new Date(`${thisMonday}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - w * 7);
    const mondayIso = d.toISOString().slice(0, 10);
    const sundayD = new Date(`${mondayIso}T00:00:00Z`);
    sundayD.setUTCDate(sundayD.getUTCDate() + 6);
    const sundayIso = sundayD.toISOString().slice(0, 10);
    const count = sessions.filter((s) => s.date >= mondayIso && s.date <= sundayIso).length;
    result.push({ mondayIso, count });
  }
  return result;
}
