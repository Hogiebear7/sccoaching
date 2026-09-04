// Keeps a member's Weekly Training plan in sync with their class bookings —
// booking a class adds a matching one-off session; cancelling/removing that
// booking removes it again (even if the member had edited it in the
// meantime, see removeSyncedWeeklyTrainingSession). This is what lets a
// booked class feed into the calorie/macro target's exertion estimate
// (lib/nutrition-target-data.ts) and the AI coaches' context without the
// member re-entering it by hand.
//
// Both functions are safe to call from a try/catch — a sync failure must
// never block the booking/cancel flow itself, same discipline as the other
// best-effort side effects in app/api/bookings/create/route.ts (see
// resolvePendingCancellationCreditsForClass there).

import {
  findWeeklyTrainingScheduleByUserId,
  saveWeeklyTrainingSchedule,
  type ClassRecord,
} from "./db";
import type { TrainingDayOfWeek, WeeklyTrainingSession } from "./profile-schema";
import { mondayOfWeek } from "./weekly-training";

function weekdayOf(dateISO: string): TrainingDayOfWeek {
  return new Date(`${dateISO}T00:00:00Z`).getUTCDay() as TrainingDayOfWeek;
}

// No exact clock-time field exists on WeeklyTrainingSession, only this
// coarse bucket — matches what the Weekly Training editor and the AI
// coach's weekly-pattern lines already work with.
function timeOfDayFromStartTime(startTime: string): WeeklyTrainingSession["timeOfDay"] {
  const hour = Number(startTime.slice(0, 2));
  if (!Number.isFinite(hour)) return null;
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

export function syncBookingToWeeklyTraining(userId: string, classRecord: ClassRecord, bookingId: string): void {
  const existing = findWeeklyTrainingScheduleByUserId(userId);
  const session: WeeklyTrainingSession = {
    id: crypto.randomUUID(),
    dayOfWeek: weekdayOf(classRecord.date),
    label: classRecord.title,
    activityType: "gym",
    timeOfDay: timeOfDayFromStartTime(classRecord.startTime),
    intensity: "moderate",
    estimatedDurationMins: classRecord.durationMins,
    notes: null,
    recurring: false,
    weekOf: mondayOfWeek(classRecord.date),
    sourceBookingId: bookingId,
    sourceProgramId: null,
  };

  saveWeeklyTrainingSchedule({
    userId,
    sessions: [...(existing?.sessions ?? []), session],
    updatedAt: new Date().toISOString(),
  });
}

export function removeSyncedWeeklyTrainingSession(userId: string, bookingId: string): void {
  const existing = findWeeklyTrainingScheduleByUserId(userId);
  if (!existing) return;

  const sessions = existing.sessions.filter((s) => s.sourceBookingId !== bookingId);
  if (sessions.length === existing.sessions.length) return; // nothing to remove

  saveWeeklyTrainingSchedule({ userId, sessions, updatedAt: new Date().toISOString() });
}
