import { exertionFromWeeklySessions } from "./nutrition-target";
import type { Exertion } from "./nutrition";
import type { TrainingDayOfWeek, WeeklyTrainingScheduleRecord, WeeklyTrainingSession } from "./profile-schema";

export function mondayOfWeek(dateISO: string): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  const day = d.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return d.toISOString().slice(0, 10);
}

// A recurring session always applies. A one-off (adhoc) session only
// applies during the specific week it was created for — once that week has
// passed it's excluded here rather than deleted, so nothing needs a
// scheduled cleanup job and there's no risk of pruning something a
// still-in-flight request needed. Every reader of weekly training sessions
// (exertion estimate, the editor screen, the AI coach context) should filter
// through this rather than reading the raw stored list.
export function activeWeeklySessions(sessions: WeeklyTrainingSession[], asOfDateISO: string): WeeklyTrainingSession[] {
  const currentWeekMonday = mondayOfWeek(asOfDateISO);
  return sessions.filter((s) => s.recurring || s.weekOf === currentWeekMonday);
}

// What the member's Weekly Training plan (including any class-booking-
// synced entries — see lib/weekly-training-sync.ts) already says about a
// given date's exertion. Shared by the calorie/macro target resolver, the
// AI coaches' context, and the Workout Helper's tier decision, so all three
// agree on the same "what's already planned for that day" read.
export function plannedExertionForDate(
  schedule: WeeklyTrainingScheduleRecord | null | undefined,
  dateISO: string
): Exertion {
  const weekday = new Date(`${dateISO}T00:00:00Z`).getUTCDay() as TrainingDayOfWeek;
  return exertionFromWeeklySessions(activeWeeklySessions(schedule?.sessions ?? [], dateISO), weekday);
}
