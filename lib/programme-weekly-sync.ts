// Keeps a member's Weekly Training plan in sync with a saved AI training
// programme — mirrors lib/weekly-training-sync.ts's booking-sync pattern
// exactly: one-off sessions per real week, never a recurring template (so
// there's nothing to auto-expire once the programme's totalWeeks is up),
// tagged with a server-owned id so they can be found and removed again.

import {
  findWeeklyTrainingScheduleByUserId,
  saveWeeklyTrainingSchedule,
  type TrainingProgramRecord,
} from "./db";
import type { TrainingDayOfWeek, WeeklyTrainingSession } from "./profile-schema";
import { mondayOfWeek } from "./weekly-training";

function addDays(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// weekdayMap has one entry per type:"workout" day in program.days[], in the
// same order those days appear — the member assigns this when they tap
// "Add to schedule" (the programme's own day-cycle has no calendar anchor,
// see lib/db.ts's TrainingProgramRecord comment). Rest days are skipped
// entirely (no schedule entry). Sessions run from the current week for
// totalWeeks weeks; any testCheckpoints entry due within that range gets its
// own session too, placed on that week's first mapped weekday.
export function syncProgrammeToWeeklyTraining(
  userId: string,
  program: TrainingProgramRecord,
  weekdayMap: TrainingDayOfWeek[]
): void {
  const workoutDays = program.days.filter((d) => d.type === "workout");
  if (workoutDays.length === 0 || weekdayMap.length !== workoutDays.length) return;
  if (!program.totalWeeks || program.totalWeeks <= 0) return;

  const startMonday = mondayOfWeek(todayISO());
  const newSessions: WeeklyTrainingSession[] = [];

  for (let weekIndex = 0; weekIndex < program.totalWeeks; weekIndex++) {
    const weekOf = addDays(startMonday, weekIndex * 7);
    const weekNumber = weekIndex + 1;

    workoutDays.forEach((day, i) => {
      newSessions.push({
        id: crypto.randomUUID(),
        dayOfWeek: weekdayMap[i],
        label: day.label,
        activityType: "gym",
        timeOfDay: null,
        intensity: null,
        estimatedDurationMins: null,
        notes: null,
        recurring: false,
        weekOf,
        sourceBookingId: null,
        sourceProgramId: program.id,
      });
    });

    const checkpoint = (program.testCheckpoints ?? []).find((c) => c.weekNumber === weekNumber);
    if (checkpoint) {
      newSessions.push({
        id: crypto.randomUUID(),
        dayOfWeek: weekdayMap[0],
        label: checkpoint.day.label,
        activityType: "gym",
        timeOfDay: null,
        intensity: null,
        estimatedDurationMins: null,
        notes: null,
        recurring: false,
        weekOf,
        sourceBookingId: null,
        sourceProgramId: program.id,
      });
    }
  }

  const existing = findWeeklyTrainingScheduleByUserId(userId);
  saveWeeklyTrainingSchedule({
    userId,
    sessions: [...(existing?.sessions ?? []), ...newSessions],
    updatedAt: new Date().toISOString(),
  });
}

export function removeSyncedProgrammeSessions(userId: string, programId: string): void {
  const existing = findWeeklyTrainingScheduleByUserId(userId);
  if (!existing) return;

  const sessions = existing.sessions.filter((s) => s.sourceProgramId !== programId);
  if (sessions.length === existing.sessions.length) return; // nothing to remove

  saveWeeklyTrainingSchedule({ userId, sessions, updatedAt: new Date().toISOString() });
}

// Used by the "expedite timeline" adjustment (section 3 of the plan) —
// trims synced sessions down to the first keepWeeks distinct weekOf values,
// leaving already-passed/current weeks untouched rather than removing
// everything and requiring a full re-sync. Counting distinct weekOf values
// (rather than comparing against a recomputed cutoff date) sidesteps ever
// needing to know what "today" was back when the original sync ran.
export function trimSyncedProgrammeSessionsToWeeks(userId: string, programId: string, keepWeeks: number): void {
  const existing = findWeeklyTrainingScheduleByUserId(userId);
  if (!existing) return;

  const ownWeeksAsc = [...new Set(existing.sessions.filter((s) => s.sourceProgramId === programId).map((s) => s.weekOf))]
    .filter((w): w is string => w !== null)
    .sort();
  const keepSet = new Set(ownWeeksAsc.slice(0, keepWeeks));

  const sessions = existing.sessions.filter(
    (s) => s.sourceProgramId !== programId || s.weekOf === null || keepSet.has(s.weekOf)
  );
  if (sessions.length === existing.sessions.length) return;

  saveWeeklyTrainingSchedule({ userId, sessions, updatedAt: new Date().toISOString() });
}
