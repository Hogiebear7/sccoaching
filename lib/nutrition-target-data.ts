// Resolves a member's effective nutrition target for a given date (or a
// full Mon-Sun week), pulling in the records lib/nutrition-target.ts needs
// and honoring the staff-controlled mode (auto/manual/disabled) on
// NutritionTargetRecord. This is the one place both the AI coach context,
// the mobile/web nutrition views, and the new Day/Week screens should call
// through — so every surface always agrees on the same number.

import { resolveCurrentWeightKg } from "./body-weight";
import {
  findBodyWeightLogsByUserId,
  findFoodEntriesByUserId,
  findNutritionTargetByUserId,
  findProfileByUserId,
  findRecoveryLogsByUserId,
  findWeeklyTrainingScheduleByUserId,
  type NutritionTargetMode,
  type NutritionTargetRecord,
  type RecoveryLogRecord,
} from "./db";
import { exertionFromDayLoad, goalBiasFromPrimaryGoal, weightedThreeDayLoad, type Exertion } from "./nutrition";
import {
  complianceAdjustmentKcal,
  computeDailyTarget,
  estimateAdaptiveTdee,
  exertionFromWeeklySessions,
  type DailyTarget,
  type IntakePoint,
  type TdeeEstimate,
  type WeightPoint,
} from "./nutrition-target";
import { trainingLoadForLog } from "./recovery";
import type { TrainingDayOfWeek, WeeklyTrainingSession } from "./profile-schema";

function isoDaysFrom(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekdayOf(dateISO: string): TrainingDayOfWeek {
  return new Date(`${dateISO}T00:00:00Z`).getUTCDay() as TrainingDayOfWeek;
}

function mondayOfWeek(dateISO: string): string {
  const day = weekdayOf(dateISO);
  const diffToMonday = day === 0 ? -6 : 1 - day;
  return isoDaysFrom(dateISO, diffToMonday);
}

// Real logged training load wins when a Recovery check-in exists for that
// date; the member's recurring weekly pattern fills in every other day —
// past days with no check-in, and every future day (a projection, not a
// log, since it hasn't happened yet).
function exertionForDate(dateISO: string, recoveryLogs: RecoveryLogRecord[], sessions: WeeklyTrainingSession[]): Exertion {
  const log = recoveryLogs.find((l) => l.date === dateISO);
  if (log) {
    const load = trainingLoadForLog(log);
    if (load !== null) return exertionFromDayLoad(load);
  }
  return exertionFromWeeklySessions(sessions, weekdayOf(dateISO));
}

function loadForDate(dateISO: string, recoveryLogs: RecoveryLogRecord[], sessions: WeeklyTrainingSession[]): number {
  const yesterday = exertionForDate(isoDaysFrom(dateISO, -1), recoveryLogs, sessions);
  const today = exertionForDate(dateISO, recoveryLogs, sessions);
  const tomorrow = exertionForDate(isoDaysFrom(dateISO, 1), recoveryLogs, sessions);
  return weightedThreeDayLoad(yesterday, today, tomorrow);
}

function dailyCaloriesByDate(entries: { date: string; calories: number }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of entries) {
    map.set(e.date, (map.get(e.date) ?? 0) + e.calories);
  }
  return map;
}

export interface ResolvedNutritionTarget {
  date: string;
  mode: NutritionTargetMode;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fuelDay: string | null;
  fuelDayLabel: string | null;
  source: "adaptive" | "estimated" | "manual" | null;
  notes: string | null;
  /** The member's current weight as resolved from logs (see
      resolveCurrentWeightKg) — surfaced so callers that cite it in text
      (the AI coach) always match what the target math actually used. */
  bodyWeightKg: number | null;
}

function disabledResult(dateISO: string, notes: string | null, bodyWeightKg: number | null): ResolvedNutritionTarget {
  return {
    date: dateISO,
    mode: "disabled",
    calories: null,
    proteinG: null,
    carbsG: null,
    fatG: null,
    fuelDay: null,
    fuelDayLabel: null,
    source: null,
    notes,
    bodyWeightKg,
  };
}

function manualResult(dateISO: string, record: NutritionTargetRecord, bodyWeightKg: number | null): ResolvedNutritionTarget {
  return {
    date: dateISO,
    mode: "manual",
    calories: record.calories,
    proteinG: record.proteinG,
    carbsG: record.carbsG,
    fatG: record.fatG,
    fuelDay: null,
    fuelDayLabel: null,
    source: "manual",
    notes: record.notes,
    bodyWeightKg,
  };
}

function emptyAutoResult(dateISO: string): ResolvedNutritionTarget {
  return {
    date: dateISO,
    mode: "auto",
    calories: null,
    proteinG: null,
    carbsG: null,
    fatG: null,
    fuelDay: null,
    fuelDayLabel: null,
    source: null,
    notes: null,
    bodyWeightKg: null,
  };
}

function autoResult(dateISO: string, target: DailyTarget, bodyWeightKg: number): ResolvedNutritionTarget {
  return {
    date: dateISO,
    mode: "auto",
    calories: target.calories,
    proteinG: target.proteinG,
    carbsG: target.carbsG,
    fatG: target.fatG,
    fuelDay: target.fuelDay,
    fuelDayLabel: target.fuelDayLabel,
    source: target.source,
    notes: null,
    bodyWeightKg,
  };
}

interface ResolveContext {
  userId: string;
  todayISO: string;
  overrideRecord: NutritionTargetRecord | undefined;
  bodyWeightKg: number | null;
  gender: import("./profile-schema").Gender;
  dateOfBirth: string | null;
  goalBias: import("./nutrition").WeightGoalBias;
  recoveryLogs: RecoveryLogRecord[];
  sessions: WeeklyTrainingSession[];
  tdee: TdeeEstimate | null;
  foodEntries: { date: string; calories: number }[];
}

function resolveTargetForDate(ctx: ResolveContext, dateISO: string): ResolvedNutritionTarget {
  const mode = ctx.overrideRecord?.mode ?? "auto";

  if (mode === "disabled") return disabledResult(dateISO, ctx.overrideRecord?.notes ?? null, ctx.bodyWeightKg);
  if (mode === "manual" && ctx.overrideRecord) return manualResult(dateISO, ctx.overrideRecord, ctx.bodyWeightKg);

  if (ctx.bodyWeightKg === null) return emptyAutoResult(dateISO);

  let yesterdayComplianceKcal: number | undefined;
  if (dateISO === ctx.todayISO) {
    const yesterdayISO = isoDaysFrom(dateISO, -1);
    const yesterdayTarget = resolveTargetForDate(ctx, yesterdayISO); // dateISO !== todayISO inside, so this doesn't recurse further
    const yesterdayActual = dailyCaloriesByDate(ctx.foodEntries).get(yesterdayISO) ?? null;
    yesterdayComplianceKcal =
      yesterdayTarget.calories !== null && yesterdayActual !== null
        ? complianceAdjustmentKcal(yesterdayTarget.calories, yesterdayActual)
        : 0;
  }

  const load = loadForDate(dateISO, ctx.recoveryLogs, ctx.sessions);
  const target = computeDailyTarget({
    bodyWeightKg: ctx.bodyWeightKg,
    gender: ctx.gender,
    dateOfBirth: ctx.dateOfBirth,
    goalBias: ctx.goalBias,
    tdee: ctx.tdee,
    load,
    date: dateISO,
    yesterdayComplianceKcal,
  });

  return autoResult(dateISO, target, ctx.bodyWeightKg);
}

function buildContext(userId: string, todayISO: string): ResolveContext | null {
  const profile = findProfileByUserId(userId);
  if (!profile) return null;

  const weightLogs = findBodyWeightLogsByUserId(userId);
  const bodyWeightKg = resolveCurrentWeightKg(profile.currentWeightKg, weightLogs);

  const recoveryLogs = findRecoveryLogsByUserId(userId);
  const schedule = findWeeklyTrainingScheduleByUserId(userId);
  const foodEntries = findFoodEntriesByUserId(userId);

  const weightPoints: WeightPoint[] = weightLogs.map((l) => ({ date: l.date, weightKg: l.weightKg }));
  const intakePoints: IntakePoint[] = [...dailyCaloriesByDate(foodEntries).entries()].map(([date, calories]) => ({
    date,
    calories,
  }));
  const tdee = bodyWeightKg !== null ? estimateAdaptiveTdee(weightPoints, intakePoints, todayISO) : null;

  return {
    userId,
    todayISO,
    overrideRecord: findNutritionTargetByUserId(userId),
    bodyWeightKg,
    gender: profile.gender,
    dateOfBirth: profile.dateOfBirth,
    goalBias: goalBiasFromPrimaryGoal(profile.primaryGoal),
    recoveryLogs,
    sessions: schedule?.sessions ?? [],
    tdee,
    foodEntries,
  };
}

// todayISO is injectable (tests, and callers like buildNutritionCoachContext
// that already treat "today" as a parameter rather than the wall clock) —
// it anchors both the compliance-nudge comparison and the TDEE window.
// Defaults to the real current date for normal API-route callers.
export function getResolvedNutritionTarget(
  userId: string,
  dateISO?: string,
  todayISO?: string
): ResolvedNutritionTarget | null {
  const effectiveToday = todayISO ?? new Date().toISOString().slice(0, 10);
  const ctx = buildContext(userId, effectiveToday);
  if (!ctx) return null;
  return resolveTargetForDate(ctx, dateISO ?? effectiveToday);
}

export interface ResolvedWeek {
  weekStart: string;
  days: ResolvedNutritionTarget[];
}

// A Mon-Sun week containing anyDateInWeekISO (defaults to today).
export function getResolvedNutritionTargetsForWeek(
  userId: string,
  anyDateInWeekISO?: string,
  todayISO?: string
): ResolvedWeek | null {
  const effectiveToday = todayISO ?? new Date().toISOString().slice(0, 10);
  const ctx = buildContext(userId, effectiveToday);
  if (!ctx) return null;

  const weekStart = mondayOfWeek(anyDateInWeekISO ?? effectiveToday);
  const days = Array.from({ length: 7 }, (_, i) => resolveTargetForDate(ctx, isoDaysFrom(weekStart, i)));

  return { weekStart, days };
}
