// Extra calories for a day's logged training, on top of that day's share of
// the weekly budget. Planned training is already in the budget (see
// trainingBurnKcal in lib/nutrition-target.ts), so only what goes beyond the
// plan counts: an unplanned session, or one well beyond what was planned.
//
// A session's burn: half of what the member's watch reported (wrist
// wearables usually overestimate), otherwise net METs x bodyweight x hours,
// with effort from the session RPE. Capped per session.

import type { WorkoutSessionRecord } from "./db";
import type { TrainingIntensity, WeeklyTrainingSession } from "./profile-schema";

export const WATCH_SHARE = 0.5;
export const SESSION_CAP_KCAL = 600;
const DEFAULT_SESSION_MINS = 60;
const NET_MET: Record<TrainingIntensity, number> = { light: 2.5, moderate: 4, heavy: 5.5 };

function intensityFromRpe(rpe: number | null | undefined): TrainingIntensity {
  if (rpe == null) return "moderate";
  if (rpe <= 4) return "light";
  if (rpe >= 8) return "heavy";
  return "moderate";
}

export function loggedSessionKcal(
  session: Pick<WorkoutSessionRecord, "durationMins" | "sessionRpe" | "wearableCalories">,
  bodyWeightKg: number
): { kcal: number; watchKcal: number | null } {
  if (session.wearableCalories != null && session.wearableCalories > 0) {
    return { kcal: Math.min(SESSION_CAP_KCAL, Math.round(session.wearableCalories * WATCH_SHARE)), watchKcal: session.wearableCalories };
  }
  const mins = session.durationMins ?? DEFAULT_SESSION_MINS;
  const kcal = NET_MET[intensityFromRpe(session.sessionRpe)] * bodyWeightKg * (mins / 60);
  return { kcal: Math.min(SESSION_CAP_KCAL, Math.round(kcal)), watchKcal: null };
}

export function plannedSessionKcal(session: WeeklyTrainingSession, bodyWeightKg: number): number {
  return Math.round(NET_MET[session.intensity ?? "moderate"] * bodyWeightKg * ((session.estimatedDurationMins ?? DEFAULT_SESSION_MINS) / 60));
}

export interface WorkoutExtra {
  extraKcal: number;
  /** Total the watch reported for the day's sessions, when any did. */
  watchKcal: number | null;
}

/**
 * @param logged the member's sessions logged on the day
 * @param plannedToday that weekday's planned (non-rest) sessions
 * @param fallbackPlan true when the budget used sign-up training days
 *   instead of a weekly plan: then one moderate hour counts as planned on
 *   any day something was logged.
 */
export function workoutExtraForDay(
  logged: Pick<WorkoutSessionRecord, "durationMins" | "sessionRpe" | "wearableCalories">[],
  plannedToday: WeeklyTrainingSession[],
  bodyWeightKg: number,
  fallbackPlan: boolean
): WorkoutExtra {
  if (logged.length === 0) return { extraKcal: 0, watchKcal: null };
  const sessions = logged.map((s) => loggedSessionKcal(s, bodyWeightKg));
  const actual = sessions.reduce((sum, s) => sum + s.kcal, 0);
  const planned =
    plannedToday.length > 0
      ? plannedToday.reduce((sum, s) => sum + plannedSessionKcal(s, bodyWeightKg), 0)
      : fallbackPlan
        ? Math.round(NET_MET.moderate * bodyWeightKg)
        : 0;
  const watch = sessions.filter((s) => s.watchKcal !== null).reduce((sum, s) => sum + (s.watchKcal ?? 0), 0);
  return { extraKcal: Math.max(0, actual - planned), watchKcal: watch > 0 ? watch : null };
}

export function workoutExtraLine(extra: WorkoutExtra): string | null {
  if (extra.extraKcal <= 0) return null;
  return extra.watchKcal !== null
    ? `+${extra.extraKcal} kcal today for training beyond your plan (half of the ${extra.watchKcal} kcal your watch reported, as watches tend to overestimate).`
    : `+${extra.extraKcal} kcal today for training beyond your plan, estimated from its length and effort.`;
}
