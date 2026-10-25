// Resolves a member's effective nutrition target for a given date (or a
// full Mon-Sun week), pulling in the records lib/nutrition-target.ts needs
// and honoring the staff-controlled mode (auto/manual/disabled) on
// NutritionTargetRecord. Auto targets are v2 weekly targets: one budget per
// Mon-Sun week, spread evenly or by training (see
// docs/nutrition-targets-v2-plan-2026-10.md). This is the one place both the AI coach context,
// the mobile/web nutrition views, and the new Day/Week screens should call
// through — so every surface always agrees on the same number.

import { computeGoalTimeline, goalTimelineAdjustKcal as kcalFromWeeklyRate } from "./body-composition-goal";
import { resolveCurrentBodyFatPct } from "./body-fat";
import { resolveCurrentWeightKg } from "./body-weight";
import { estimatePhase } from "./cycle-phase";
import {
  findBodyFatLogsByUserId,
  findBodyWeightLogsByUserId,
  findCycleSettingsByUserId,
  findFoodEntriesByUserId,
  findNutritionDayStatusesByUserId,
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
import { exertionFromDayLoad, fuelBandForLoad, weightedThreeDayLoad, type Exertion, type FuelBand, type FuelDay } from "./nutrition";
import { isMembershipTier } from "./member-access";
import { resolveMemberTierForUser } from "./membership-entitlement";
import {
  defaultPaceForGoal,
  distributeWeek,
  exertionFromWeeklySessions,
  formulaExpenditureKcal,
  KCAL_PER_KG_FAT,
  learnExpenditure,
  macrosForCalorieTarget,
  minimumDailyAverageKcal,
  paceAdjustKcal,
  resolveDistribution,
  restingKcal,
  activityExpenditureKcal,
  SEX_FLOOR_KCAL,
  weeklyBudget,
  type CalorieDistribution,
  type DayLogStatus,
  type DiaryDay,
  type DistributionSource,
  type ExpenditureEstimate,
  type WeeklyBudget,
  type WeightPoint,
} from "./nutrition-target";
import { trainingLoadForLog, trainingLoadForSession } from "./recovery";
import type { ActivityLevel, Gender, TrainingDayOfWeek, WeeklyTrainingSession } from "./profile-schema";
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

// One DiaryDay per date the member logged food on: summed calories, how many
// meal slots have food, and their own complete/incomplete mark.
function diaryDaysFrom(
  entries: { date: string; calories: number; mealType: string }[],
  statuses: { date: string; status: DayLogStatus }[]
): DiaryDay[] {
  const byDate = new Map<string, { calories: number; slots: Set<string> }>();
  for (const e of entries) {
    const day = byDate.get(e.date) ?? { calories: 0, slots: new Set<string>() };
    day.calories += e.calories;
    day.slots.add(e.mealType);
    byDate.set(e.date, day);
  }
  const statusByDate = new Map(statuses.map((s) => [s.date, s.status]));
  return [...byDate.entries()].map(([date, d]) => ({
    date,
    calories: d.calories,
    mealSlotsLogged: d.slots.size,
    status: statusByDate.get(date) ?? null,
  }));
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
  /** "adaptive" once expenditure has been learned from complete food days
      and weigh-ins, "estimated" while it's still the formula. */
  source: "adaptive" | "estimated" | "manual" | null;
  notes: string | null;
  /** The member's current weight as resolved from logs (see
      resolveCurrentWeightKg) — surfaced so callers that cite it in text
      (the AI coach) always match what the target math actually used. */
  bodyWeightKg: number | null;
  /** Member-facing "why this number" lines — null when there's no number to
      explain (disabled/no weight on file). See buildWeeklyRationale below. */
  rationale: string[] | null;
  /** True when mode is "manual" and the member set it themselves (via the
      AI Nutrition Coach's "Apply this target" button — see
      app/api/mobile/nutrition/target/member-override/route.ts), as opposed
      to a coach setting it. Always false for auto/disabled. Distinguishes
      the two so the UI doesn't mislabel a member's own override as
      coach-set. */
  setByMember: boolean;
  // ── v2 weekly fields (docs/nutrition-targets-v2-plan-2026-10.md). Null
  //    whenever the target isn't auto-computed (manual, disabled, no weight).
  weekStart: string | null;
  weekBudgetKcal: number | null;
  dailyAverageKcal: number | null;
  expenditureKcal: number | null;
  expenditureSource: "formula" | "learned" | null;
  /** Complete food days in the 14 days before this week's check-in. */
  completeDaysLast14: number | null;
  /** Signed % of bodyweight per week the budget aims for. */
  pacePctPerWeek: number | null;
  paceLimited: boolean;
  minimumApplied: boolean;
  distribution: CalorieDistribution | null;
  distributionSource: DistributionSource | null;
}

const NO_WEEK_FIELDS = {
  weekStart: null,
  weekBudgetKcal: null,
  dailyAverageKcal: null,
  expenditureKcal: null,
  expenditureSource: null,
  completeDaysLast14: null,
  pacePctPerWeek: null,
  paceLimited: false,
  minimumApplied: false,
  distribution: null,
  distributionSource: null,
} as const;

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
    ...NO_WEEK_FIELDS,
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
    ...NO_WEEK_FIELDS,
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
    ...NO_WEEK_FIELDS,
  };
}

interface ResolveContext {
  userId: string;
  todayISO: string;
  overrideRecord: NutritionTargetRecord | undefined;
  bodyWeightKg: number | null;
  gender: Gender;
  dateOfBirth: string | null;
  heightCm: number | null;
  primaryGoal: string;
  /** The member's chosen pace, or null to fall back (see goalAdjustFor). */
  paceSetting: number | null;
  memberDistribution: CalorieDistribution | null;
  activityLevel: ActivityLevel | null;
  isMembershipTier: boolean;
  recoveryLogs: RecoveryLogRecord[];
  sessions: WeeklyTrainingSession[];
  workoutSessions: WorkoutSessionRecord[];
  weightPoints: WeightPoint[];
  diaryDays: DiaryDay[];
  /** Only ever applied to dateISO === todayISO — see loadForDate. */
  tomorrowOverride?: Exertion;
  /** Cycle-tracking inputs, present only when the member has it enabled —
      see estimatePhase in lib/cycle-phase.ts. */
  cycleTracking: {
    lastPeriodStartDate: string | null;
    averageCycleLengthDays: number | null;
    periodLengthDays: number | null;
    regularity: import("./profile-schema").CycleRegularity | null;
  } | null;
  /** From the member's goal weight/body-fat + target date (see buildContext
      and lib/body-composition-goal.ts). Used as the pace only when the
      member hasn't chosen one. Null when no goal timeline is set. */
  goalTimelineAdjustKcal: number | null;
  /** Weekly results, computed once per week per request. */
  weekCache: Map<string, ResolvedWeekPlan>;
}

interface ResolvedWeekPlan {
  weekStart: string;
  fuelBands: FuelBand[];
  lutealDays: boolean[];
  dayKcal: number[];
  expenditure: ExpenditureEstimate;
  budget: WeeklyBudget;
  pacePctPerWeek: number;
  distribution: CalorieDistribution;
  distributionSource: DistributionSource;
}

const SPLIT_DAY_FOR_EXERTION: Record<Exertion, FuelDay> = {
  low: "reduced",
  medium: "standard",
  high: "full",
  match: "match",
};

// The member's chosen pace wins; otherwise a goal timeline's rate; otherwise
// the default for their primary goal.
function goalAdjustFor(ctx: ResolveContext, bodyWeightKg: number): { adjustKcal: number; pacePctPerWeek: number } {
  if (ctx.paceSetting !== null) {
    return { adjustKcal: paceAdjustKcal(ctx.paceSetting, bodyWeightKg), pacePctPerWeek: ctx.paceSetting };
  }
  if (ctx.goalTimelineAdjustKcal !== null) {
    const pct = ((ctx.goalTimelineAdjustKcal * 7) / KCAL_PER_KG_FAT / bodyWeightKg) * 100;
    return { adjustKcal: ctx.goalTimelineAdjustKcal, pacePctPerWeek: Math.round(pct * 100) / 100 };
  }
  const pace = defaultPaceForGoal(ctx.primaryGoal);
  return { adjustKcal: paceAdjustKcal(pace, bodyWeightKg), pacePctPerWeek: pace };
}

function weekPlanFor(ctx: ResolveContext, weekStart: string, bodyWeightKg: number): ResolvedWeekPlan {
  const cached = ctx.weekCache.get(weekStart);
  if (cached) return cached;

  const dates = Array.from({ length: 7 }, (_, i) => isoDaysFrom(weekStart, i));
  const fuelBands = dates.map((d) =>
    fuelBandForLoad(
      loadForDate(d, ctx.recoveryLogs, ctx.sessions, ctx.workoutSessions, d === ctx.todayISO ? ctx.tomorrowOverride : undefined)
    )
  );
  const lutealDays = dates.map((d) =>
    ctx.cycleTracking
      ? estimatePhase(
          ctx.cycleTracking.lastPeriodStartDate,
          ctx.cycleTracking.averageCycleLengthDays,
          ctx.cycleTracking.periodLengthDays,
          ctx.cycleTracking.regularity,
          d
        ).phase === "Luteal"
      : false
  );

  const { adjustKcal, pacePctPerWeek } = goalAdjustFor(ctx, bodyWeightKg);
  const resting = restingKcal(bodyWeightKg, ctx.gender, ctx.dateOfBirth, weekStart, ctx.heightCm);
  // A member-stated activity level sets the starting burn; without one, the
  // week's fuel days do (the original cold-start heuristic).
  const formulaKcal = ctx.activityLevel
    ? activityExpenditureKcal(resting, ctx.activityLevel)
    : formulaExpenditureKcal(bodyWeightKg, ctx.gender, ctx.dateOfBirth, weekStart, ctx.heightCm, fuelBands.map((b) => b.day));
  const expenditure = learnExpenditure({
    formulaKcal,
    weightLogs: ctx.weightPoints,
    diaryDays: ctx.diaryDays,
    goalAdjustKcal: adjustKcal,
    checkInDate: weekStart,
  });
  const budget = weeklyBudget(expenditure.kcal, adjustKcal, minimumDailyAverageKcal(ctx.gender, resting, expenditure.kcal));
  const { distribution, source: distributionSource } = resolveDistribution({
    coachDistribution: ctx.overrideRecord?.distribution ?? null,
    coachLocked: ctx.overrideRecord?.distributionLocked ?? false,
    memberDistribution: ctx.memberDistribution,
    isMembershipTier: ctx.isMembershipTier,
  });
  // The split follows each day's OWN planned/logged session, not the fuel
  // band: bands smooth over yesterday and tomorrow, so three moderate gym
  // days a week come out "reduced" every day and there'd be nothing to
  // spread. A moderate session counts as standard, a rest day as reduced.
  const tomorrowISO = isoDaysFrom(ctx.todayISO, 1);
  const splitDays: FuelDay[] = dates.map((d) => {
    const exertion =
      d === tomorrowISO && ctx.tomorrowOverride
        ? ctx.tomorrowOverride
        : exertionForDate(d, ctx.recoveryLogs, ctx.sessions, ctx.workoutSessions);
    return SPLIT_DAY_FOR_EXERTION[exertion];
  });
  const dayKcal = distributeWeek({
    weekBudgetKcal: budget.weekBudgetKcal,
    distribution,
    fuelDays: splitDays,
    lutealDays,
    dayFloorKcal: SEX_FLOOR_KCAL[ctx.gender],
  });

  const plan: ResolvedWeekPlan = {
    weekStart,
    fuelBands,
    lutealDays,
    dayKcal,
    expenditure,
    budget,
    pacePctPerWeek,
    distribution,
    distributionSource,
  };
  ctx.weekCache.set(weekStart, plan);
  return plan;
}

// Member-facing "why this number" lines for a v2 weekly target, in display
// order — built only from what the week plan actually used.
export function buildWeeklyRationale(input: {
  expenditureKcal: number;
  expenditureSource: "formula" | "learned";
  completeDaysLast14: number;
  usedHeightAndAge: boolean;
  /** e.g. "how active you said you are"; null falls back to "weekly training". */
  activityLabel?: string | null;
  pacePctPerWeek: number;
  bodyWeightKg: number;
  paceLimited: boolean;
  minimumApplied: boolean;
  distribution: CalorieDistribution;
  distributionSource: DistributionSource;
  fuelDayLabel: string;
  dayKcal: number;
  dailyAverageKcal: number;
  lutealToday: boolean;
}): string[] {
  const lines: string[] = [];

  lines.push(
    input.expenditureSource === "learned"
      ? `Built on your burn as learned from your complete food days and weigh-ins — about ${input.expenditureKcal.toLocaleString("en-GB")} kcal a day.`
      : `Built on an estimate of your burn — about ${input.expenditureKcal.toLocaleString("en-GB")} kcal a day — from your weight${
          input.usedHeightAndAge ? ", height and age" : ""
        } and ${input.activityLabel ?? "weekly training"}. Log complete food days and weigh in a few times a week, and after about two weeks it learns your real burn (${input.completeDaysLast14} of the last 14 days counted).`
  );

  const kgPerWeek = Math.round(Math.abs(input.pacePctPerWeek / 100) * input.bodyWeightKg * 100) / 100;
  if (input.paceLimited) {
    lines.push("We've slowed your pace to keep your target at a safe level for you.");
  } else if (input.pacePctPerWeek < 0) {
    lines.push(`Set for losing about ${Math.abs(input.pacePctPerWeek)}% of your bodyweight a week (${kgPerWeek} kg).`);
  } else if (input.pacePctPerWeek > 0) {
    lines.push(`Set for gaining about ${input.pacePctPerWeek}% of your bodyweight a week (${kgPerWeek} kg).`);
  } else {
    lines.push("Set to maintain your weight.");
  }
  if (input.minimumApplied && !input.paceLimited) {
    lines.push("Held at a safe minimum for you rather than going lower.");
  }

  const who =
    input.distributionSource === "coach-locked" || input.distributionSource === "coach"
      ? " (set by your coach)"
      : "";
  if (input.distribution === "even") {
    lines.push(`Your weekly budget is spread evenly — the same number every day${who}.`);
  } else {
    const diff = input.dayKcal - input.dailyAverageKcal;
    const relative =
      Math.abs(diff) < 25
        ? "right on your daily average"
        : `${Math.abs(diff).toLocaleString("en-GB")} kcal ${diff > 0 ? "above" : "below"} your daily average`;
    lines.push(`Your weekly budget follows your training${who} — today is a "${input.fuelDayLabel}", ${relative}.`);
  }

  if (input.lutealToday) {
    lines.push("Includes +120 kcal for the luteal phase of your cycle, taken from your other days this week.");
  }

  lines.push("Your budget is reviewed every Monday.");
  return lines;
}

function resolveTargetForDate(ctx: ResolveContext, dateISO: string): ResolvedNutritionTarget {
  const mode = ctx.overrideRecord?.mode ?? "auto";

  if (mode === "disabled") return disabledResult(dateISO, ctx.overrideRecord?.notes ?? null, ctx.bodyWeightKg);
  if (mode === "manual" && ctx.overrideRecord) return manualResult(dateISO, ctx.overrideRecord, ctx.bodyWeightKg);

  if (ctx.bodyWeightKg === null) return emptyAutoResult(dateISO);
  const bodyWeightKg = ctx.bodyWeightKg;

  const weekStart = mondayOfWeek(dateISO);
  const plan = weekPlanFor(ctx, weekStart, bodyWeightKg);
  const index = daysBetweenISO(weekStart, dateISO);
  const band = plan.fuelBands[index];
  const calories = plan.dayKcal[index];
  const macros = macrosForCalorieTarget(calories, bodyWeightKg, band);

  return {
    date: dateISO,
    mode: "auto",
    calories: macros.calories,
    proteinG: macros.proteinG,
    carbsG: macros.carbsG,
    fatG: macros.fatG,
    fuelDay: band.day,
    fuelDayLabel: band.label,
    source: plan.expenditure.source === "learned" ? "adaptive" : "estimated",
    notes: null,
    bodyWeightKg,
    rationale: buildWeeklyRationale({
      expenditureKcal: plan.expenditure.kcal,
      expenditureSource: plan.expenditure.source,
      completeDaysLast14: plan.expenditure.completeDaysLast14,
      usedHeightAndAge: ctx.heightCm !== null && ctx.dateOfBirth !== null,
      activityLabel: ctx.activityLevel ? "how active you said you are" : null,
      pacePctPerWeek: plan.pacePctPerWeek,
      bodyWeightKg,
      paceLimited: plan.budget.paceLimited,
      minimumApplied: plan.budget.minimumApplied,
      distribution: plan.distribution,
      distributionSource: plan.distributionSource,
      fuelDayLabel: band.label,
      dayKcal: calories,
      dailyAverageKcal: plan.budget.dailyAverageKcal,
      lutealToday: plan.lutealDays[index],
    }),
    setByMember: false,
    weekStart,
    weekBudgetKcal: plan.budget.weekBudgetKcal,
    dailyAverageKcal: plan.budget.dailyAverageKcal,
    expenditureKcal: plan.expenditure.kcal,
    expenditureSource: plan.expenditure.source,
    completeDaysLast14: plan.expenditure.completeDaysLast14,
    pacePctPerWeek: plan.pacePctPerWeek,
    paceLimited: plan.budget.paceLimited,
    minimumApplied: plan.budget.minimumApplied,
    distribution: plan.distribution,
    distributionSource: plan.distributionSource,
  };
}

function daysBetweenISO(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
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
  const diaryDays = diaryDaysFrom(findFoodEntriesByUserId(userId), findNutritionDayStatusesByUserId(userId));

  const weightPoints: WeightPoint[] = weightLogs.map((l) => ({ date: l.date, weightKg: l.weightKg }));

  // Body-fat goal is primary when set (a more direct read on "aggressive
  // but still healthy" than scale weight, which conflates fat and muscle);
  // weight goal is the fallback. Only computed when there's a target date —
  // without one there's no rate to derive. A pace the member picked
  // (profile.goalPacePctPerWeek) takes precedence over this; see goalAdjustFor.
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
    primaryGoal: profile.primaryGoal,
    paceSetting: profile.goalPacePctPerWeek ?? null,
    memberDistribution: profile.calorieDistribution ?? null,
    activityLevel: profile.activityLevel ?? null,
    isMembershipTier: isMembershipTier(resolveMemberTierForUser(userId)),
    recoveryLogs,
    sessions: schedule?.sessions ?? [],
    workoutSessions,
    weightPoints,
    diaryDays,
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
    weekCache: new Map(),
  };
}

// todayISO is injectable (tests, and callers like buildNutritionCoachContext
// that already treat "today" as a parameter rather than the wall clock) —
// it anchors which day's real logs feed the plan and the tomorrowOverride.
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
