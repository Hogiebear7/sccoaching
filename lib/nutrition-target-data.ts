// Resolves a member's effective nutrition target for a given date (or a
// full Mon-Sun week), pulling in the records lib/nutrition-target.ts needs
// and honoring the staff-controlled mode (auto/manual/disabled) on
// NutritionTargetRecord. This is the one place both the AI coach context,
// the mobile/web nutrition views, and the new Day/Week screens should call
// through — so every surface always agrees on the same number.

import { computeGoalTimeline, goalTimelineAdjustKcal as kcalFromWeeklyRate } from "./body-composition-goal";
import { resolveCurrentBodyFatPct } from "./body-fat";
import { resolveCurrentWeightKg } from "./body-weight";
import { estimatePhase, type PhaseName } from "./cycle-phase";
import {
  findBodyFatLogsByUserId,
  findBodyWeightLogsByUserId,
  findCycleSettingsByUserId,
  findFoodEntriesByUserId,
  findNutritionTargetByUserId,
  findProfileByUserId,
  findRecoveryLogsByUserId,
  findWeeklyTrainingScheduleByUserId,
  findWorkoutSessionsByUserId,
  type NutritionTargetMode,
  type NutritionTargetRecord,
  type RecoveryLogRecord,
  type WorkoutSessionRecord,
} from "./db";
import { exertionFromDayLoad, goalBiasFromPrimaryGoal, weightedThreeDayLoad, type Exertion } from "./nutrition";
import {
  buildTargetRationale,
  complianceAdjustmentKcal,
  computeDailyTarget,
  estimateAdaptiveTdee,
  exertionFromWeeklySessions,
  type DailyTarget,
  type IntakePoint,
  type TdeeEstimate,
  type WeightPoint,
} from "./nutrition-target";
import { trainingLoadForLog, trainingLoadForSession } from "./recovery";
import type { TrainingDayOfWeek, WeeklyTrainingSession } from "./profile-schema";
import { activeWeeklySessions } from "./weekly-training";

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
// date. Otherwise, an actual logged workout for that date is the next-best
// signal — it's what genuinely happened, ahead of the pre-set weekly plan's
// mere projection. The recurring weekly pattern only fills in when neither
// exists — past days with no check-in or logged workout, and every future
// day (a projection, since it hasn't happened yet — a workout can only ever
// be logged for today or earlier, so this tier naturally never fires for a
// future date).
export function exertionForDate(
  dateISO: string,
  recoveryLogs: RecoveryLogRecord[],
  sessions: WeeklyTrainingSession[],
  workoutSessions: WorkoutSessionRecord[]
): Exertion {
  const log = recoveryLogs.find((l) => l.date === dateISO);
  if (log) {
    const load = trainingLoadForLog(log);
    if (load !== null) return exertionFromDayLoad(load);
  }

  // Sum same-date sessions rather than taking one — mirrors
  // computeRollingTrainingLoad in lib/recovery.ts, the existing precedent
  // for this exact fallback (Recovery wins when present, logged workouts
  // fill in per day otherwise, never double-counted against each other).
  // A session missing duration/RPE contributes nothing (not zero) — same
  // null-means-"no data", not "no exertion", distinction trainingLoadForLog
  // already draws above.
  const sameDateWorkoutLoads = workoutSessions
    .filter((s) => s.date === dateISO)
    .map((s) => trainingLoadForSession(s))
    .filter((load): load is number => load !== null);
  if (sameDateWorkoutLoads.length > 0) {
    return exertionFromDayLoad(sameDateWorkoutLoads.reduce((sum, load) => sum + load, 0));
  }

  return exertionFromWeeklySessions(activeWeeklySessions(sessions, dateISO), weekdayOf(dateISO));
}

// tomorrowOverride lets a caller preview "what if tomorrow is a match" (the
// web dashboard's Yesterday/Today/Tomorrow picker) without touching the
// member's actual Weekly Training pattern — see resolveTargetForDate, which
// only ever passes one in for the real current date.
function loadForDate(
  dateISO: string,
  recoveryLogs: RecoveryLogRecord[],
  sessions: WeeklyTrainingSession[],
  workoutSessions: WorkoutSessionRecord[],
  tomorrowOverride?: Exertion
): number {
  const yesterday = exertionForDate(isoDaysFrom(dateISO, -1), recoveryLogs, sessions, workoutSessions);
  const today = exertionForDate(dateISO, recoveryLogs, sessions, workoutSessions);
  const tomorrow = tomorrowOverride ?? exertionForDate(isoDaysFrom(dateISO, 1), recoveryLogs, sessions, workoutSessions);
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
  /** Member-facing "why this number" lines — null when there's no number to
      explain (disabled/no weight on file). See buildTargetRationale in
      lib/nutrition-target.ts. */
  rationale: string[] | null;
  /** True when mode is "manual" and the member set it themselves (via the
      AI Nutrition Coach's "Apply this target" button — see
      app/api/mobile/nutrition/target/member-override/route.ts), as opposed
      to a coach setting it. Always false for auto/disabled. Distinguishes
      the two so the UI doesn't mislabel a member's own override as
      coach-set. */
  setByMember: boolean;
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
    rationale: null,
    setByMember: false,
  };
}

function manualResult(dateISO: string, record: NutritionTargetRecord, bodyWeightKg: number | null): ResolvedNutritionTarget {
  // A member-applied override (see the AI Nutrition Coach's "Apply this
  // target" button) writes setByStaffId as the member's own id, since
  // there's no separate "set by member" flag on NutritionTargetRecord —
  // this is how the resolver tells the two apart for display purposes.
  const setByMember = record.setByStaffId === record.userId;
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
    rationale: [
      setByMember
        ? "Set by you via the AI Nutrition Coach — it doesn't change automatically day to day."
        : "Set directly by your coach — it doesn't change automatically day to day.",
    ],
    setByMember,
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
    rationale: null,
    setByMember: false,
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
    rationale: buildTargetRationale(target),
    setByMember: false,
  };
}

interface ResolveContext {
  userId: string;
  todayISO: string;
  overrideRecord: NutritionTargetRecord | undefined;
  bodyWeightKg: number | null;
  gender: import("./profile-schema").Gender;
  dateOfBirth: string | null;
  heightCm: number | null;
  goalBias: import("./nutrition").WeightGoalBias;
  recoveryLogs: RecoveryLogRecord[];
  sessions: WeeklyTrainingSession[];
  workoutSessions: WorkoutSessionRecord[];
  tdee: TdeeEstimate | null;
  foodEntries: { date: string; calories: number }[];
  /** Only ever applied to dateISO === todayISO — see loadForDate. */
  tomorrowOverride?: Exertion;
  /** Cycle-tracking inputs, present only when the member has it enabled —
      see estimatePhase in lib/cycle-phase.ts. Phase is resolved per-date
      inside resolveTargetForDate (it varies day to day), not precomputed
      once here. */
  cycleTracking: {
    lastPeriodStartDate: string | null;
    averageCycleLengthDays: number | null;
    periodLengthDays: number | null;
    regularity: import("./profile-schema").CycleRegularity | null;
  } | null;
  /** Precomputed once (anchored to todayISO, not per-date) from the
      member's goal fields + logged trend — see buildContext and
      lib/body-composition-goal.ts. Null when no goal timeline is set,
      which keeps computeDailyTarget's original flat goalBias behavior. */
  goalTimelineAdjustKcal: number | null;
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

  const load = loadForDate(
    dateISO,
    ctx.recoveryLogs,
    ctx.sessions,
    ctx.workoutSessions,
    dateISO === ctx.todayISO ? ctx.tomorrowOverride : undefined
  );
  const cyclePhase = ctx.cycleTracking
    ? estimatePhase(
        ctx.cycleTracking.lastPeriodStartDate,
        ctx.cycleTracking.averageCycleLengthDays,
        ctx.cycleTracking.periodLengthDays,
        ctx.cycleTracking.regularity,
        dateISO
      ).phase
    : null;
  const target = computeDailyTarget({
    bodyWeightKg: ctx.bodyWeightKg,
    gender: ctx.gender,
    dateOfBirth: ctx.dateOfBirth,
    heightCm: ctx.heightCm,
    goalBias: ctx.goalBias,
    tdee: ctx.tdee,
    load,
    date: dateISO,
    yesterdayComplianceKcal,
    cyclePhase,
    goalTimelineAdjustKcal: ctx.goalTimelineAdjustKcal,
  });

  return autoResult(dateISO, target, ctx.bodyWeightKg);
}

function buildContext(userId: string, todayISO: string, tomorrowOverride?: Exertion): ResolveContext | null {
  const profile = findProfileByUserId(userId);
  if (!profile) return null;

  const weightLogs = findBodyWeightLogsByUserId(userId);
  const bodyWeightKg = resolveCurrentWeightKg(profile.currentWeightKg, weightLogs);
  const bodyFatLogs = findBodyFatLogsByUserId(userId);
  const bodyFatPct = resolveCurrentBodyFatPct(profile.bodyFatPct, bodyFatLogs);

  const recoveryLogs = findRecoveryLogsByUserId(userId);
  const schedule = findWeeklyTrainingScheduleByUserId(userId);
  const workoutSessions = findWorkoutSessionsByUserId(userId);
  const foodEntries = findFoodEntriesByUserId(userId);

  const weightPoints: WeightPoint[] = weightLogs.map((l) => ({ date: l.date, weightKg: l.weightKg }));
  const intakePoints: IntakePoint[] = [...dailyCaloriesByDate(foodEntries).entries()].map(([date, calories]) => ({
    date,
    calories,
  }));
  const tdee = bodyWeightKg !== null ? estimateAdaptiveTdee(weightPoints, intakePoints, todayISO) : null;

  // Body-fat goal is primary when set (a more direct read on "aggressive
  // but still healthy" than scale weight, which conflates fat and muscle);
  // weight goal is the fallback. Only computed when there's a target date —
  // without one there's no rate to derive, so the member just sees their
  // "at current trend" projection (built client-side from the same logs).
  const goalTimelineAdjustKcal: number | null = (() => {
    if (bodyWeightKg === null || !profile.goalTargetDate) return null;

    if (profile.goalBodyFatPct != null && bodyFatPct !== null) {
      const bodyFatPoints: WeightPoint[] = bodyFatLogs.map((l) => ({ date: l.date, weightKg: l.bodyFatPct }));
      const timeline = computeGoalTimeline({
        currentValue: bodyFatPct,
        goalValue: profile.goalBodyFatPct,
        targetDateISO: profile.goalTargetDate,
        asOfDateISO: todayISO,
        history: bodyFatPoints,
      });
      if (timeline.clampedWeeklyRate === null) return null;
      // %-points/week of body fat -> kg/week of fat mass, at current weight.
      const kgPerWeek = (timeline.clampedWeeklyRate / 100) * bodyWeightKg;
      return kcalFromWeeklyRate(kgPerWeek);
    }

    if (profile.goalWeightKg != null) {
      const timeline = computeGoalTimeline({
        currentValue: bodyWeightKg,
        goalValue: profile.goalWeightKg,
        targetDateISO: profile.goalTargetDate,
        asOfDateISO: todayISO,
        history: weightPoints,
      });
      return kcalFromWeeklyRate(timeline.clampedWeeklyRate);
    }

    return null;
  })();

  return {
    userId,
    todayISO,
    overrideRecord: findNutritionTargetByUserId(userId),
    bodyWeightKg,
    gender: profile.gender,
    dateOfBirth: profile.dateOfBirth,
    heightCm: profile.heightCm ?? null,
    goalBias: goalBiasFromPrimaryGoal(profile.primaryGoal),
    recoveryLogs,
    sessions: schedule?.sessions ?? [],
    workoutSessions,
    tdee,
    foodEntries,
    tomorrowOverride,
    cycleTracking: (() => {
      if (!profile.cycleTrackingEnabled) return null;
      const settings = findCycleSettingsByUserId(userId);
      if (!settings) return null;
      return {
        lastPeriodStartDate: settings.lastPeriodStartDate,
        averageCycleLengthDays: settings.averageCycleLengthDays,
        periodLengthDays: settings.periodLengthDays,
        regularity: settings.regularity,
      };
    })(),
    goalTimelineAdjustKcal,
  };
}

// todayISO is injectable (tests, and callers like buildNutritionCoachContext
// that already treat "today" as a parameter rather than the wall clock) —
// it anchors both the compliance-nudge comparison and the TDEE window.
// Defaults to the real current date for normal API-route callers.
export function getResolvedNutritionTarget(
  userId: string,
  dateISO?: string,
  todayISO?: string,
  tomorrowOverride?: Exertion
): ResolvedNutritionTarget | null {
  const effectiveToday = todayISO ?? new Date().toISOString().slice(0, 10);
  const ctx = buildContext(userId, effectiveToday, tomorrowOverride);
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
  todayISO?: string,
  tomorrowOverride?: Exertion
): ResolvedWeek | null {
  const effectiveToday = todayISO ?? new Date().toISOString().slice(0, 10);
  const ctx = buildContext(userId, effectiveToday, tomorrowOverride);
  if (!ctx) return null;

  const weekStart = mondayOfWeek(anyDateInWeekISO ?? effectiveToday);
  const days = Array.from({ length: 7 }, (_, i) => resolveTargetForDate(ctx, isoDaysFrom(weekStart, i)));

  return { weekStart, days };
}
