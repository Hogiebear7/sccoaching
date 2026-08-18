// Adaptive daily calorie/macro target engine — MacroFactor-inspired.
//
// Two regimes, chosen automatically per member:
//  - "adaptive": once there's enough weight-log + food-diary history, the
//    calorie target is anchored to a TDEE estimated by back-calculating
//    energy balance from real weight-trend change vs logged intake.
//  - "estimated": cold start (not enough history yet) — a bodyweight x
//    training-load multiplier, in the same spirit as the fuel-band macro
//    system in lib/nutrition.ts (which this module builds on rather than
//    replaces).
// Both regimes feed the same goal-bias, training-day, and yesterday's-
// compliance adjustments, so the target behaves consistently whichever
// regime produced its base calorie number.
//
// Pure and deterministic — no DB access here. See lib/nutrition-target-data.ts
// for the orchestration layer that pulls in a member's actual records.

import {
  fuelBandForLoad,
  type Exertion,
  type FuelBand,
  type FuelDay,
  type WeightGoalBias,
} from "./nutrition";
import type { Gender, TrainingActivityType, TrainingDayOfWeek, TrainingIntensity, WeeklyTrainingSession } from "./profile-schema";

// ─── Date helpers ───────────────────────────────────────────────────────

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

// ─── Trend weight (least-squares regression over logged weigh-ins) ─────

export interface WeightPoint {
  date: string; // YYYY-MM-DD
  weightKg: number;
}

export interface IntakePoint {
  date: string;
  calories: number;
}

export interface WeightTrend {
  slopeKgPerDay: number;
  firstDate: string;
  lastDate: string;
  points: number;
}

// Same-date duplicate logs are averaged rather than last-write-wins, since
// a regression should treat "today" as one data point regardless of how
// many times the member weighed in.
export function computeWeightTrend(logs: WeightPoint[]): WeightTrend | null {
  const byDate = new Map<string, number[]>();
  for (const p of logs) {
    const arr = byDate.get(p.date) ?? [];
    arr.push(p.weightKg);
    byDate.set(p.date, arr);
  }

  const daily = [...byDate.entries()]
    .map(([date, ws]) => ({ date, weightKg: ws.reduce((a, b) => a + b, 0) / ws.length }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (daily.length < 2) return null;

  const first = daily[0].date;
  const xs = daily.map((p) => daysBetween(first, p.date));
  const ys = daily.map((p) => p.weightKg);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return null; // every log fell on the same day — no trend to fit

  const slope = num / den;

  return { slopeKgPerDay: slope, firstDate: first, lastDate: daily[daily.length - 1].date, points: n };
}

// ─── Adaptive TDEE (energy-balance back-calculation) ────────────────────

const KCAL_PER_KG_FAT = 7700;
const TDEE_WINDOW_DAYS = 28;
const MIN_WEIGHT_DAYS = 10;
const MIN_INTAKE_DAYS = 10;
const MIN_SPAN_DAYS = 14;
const MIN_PLAUSIBLE_TDEE = 1200;
const MAX_PLAUSIBLE_TDEE = 6000;

export interface TdeeEstimate {
  kcal: number;
  confidence: "adaptive";
  weightChangeKg: number;
  avgIntakeKcal: number;
  windowDays: number;
}

function isoDaysBefore(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// Returns null (not just a low-confidence guess) when there isn't enough
// real history yet — callers fall back to coldStartMaintenanceKcal. This
// mirrors how MacroFactor withholds an expenditure number for new users
// rather than fabricating one from day one.
export function estimateAdaptiveTdee(
  weightLogs: WeightPoint[],
  diaryTotals: IntakePoint[],
  asOfDate: string
): TdeeEstimate | null {
  const cutoff = isoDaysBefore(asOfDate, TDEE_WINDOW_DAYS);
  const weightWindow = weightLogs.filter((p) => p.date >= cutoff && p.date <= asOfDate);
  const intakeWindow = diaryTotals.filter((p) => p.date >= cutoff && p.date <= asOfDate && p.calories > 0);

  const distinctWeightDays = new Set(weightWindow.map((p) => p.date)).size;
  const distinctIntakeDays = new Set(intakeWindow.map((p) => p.date)).size;
  if (distinctWeightDays < MIN_WEIGHT_DAYS || distinctIntakeDays < MIN_INTAKE_DAYS) return null;

  const trend = computeWeightTrend(weightWindow);
  if (!trend) return null;

  const spanDays = daysBetween(trend.firstDate, trend.lastDate);
  if (spanDays < MIN_SPAN_DAYS) return null;

  const weightChangeKg = trend.slopeKgPerDay * spanDays;
  const avgIntakeKcal = intakeWindow.reduce((sum, p) => sum + p.calories, 0) / intakeWindow.length;
  const tdee = avgIntakeKcal - (weightChangeKg * KCAL_PER_KG_FAT) / spanDays;

  if (!Number.isFinite(tdee) || tdee < MIN_PLAUSIBLE_TDEE || tdee > MAX_PLAUSIBLE_TDEE) return null;

  return {
    kcal: Math.round(tdee),
    confidence: "adaptive",
    weightChangeKg: Math.round(weightChangeKg * 100) / 100,
    avgIntakeKcal: Math.round(avgIntakeKcal),
    windowDays: spanDays,
  };
}

// ─── Cold-start estimate (no adaptive history yet) ──────────────────────

const BAND_KCAL_PER_KG: Record<FuelDay, number> = {
  reduced: 24,
  standard: 27,
  full: 30,
  match: 33,
};

const GENDER_MULTIPLIER: Record<Gender, number> = {
  Male: 1.0,
  Female: 0.94,
  Other: 0.97,
};

function ageFromDob(dateOfBirth: string | null, asOfDate: string): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  const now = new Date(`${asOfDate}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return null;

  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
}

// Bodyweight x training-load multiplier — not a BMR equation (no height on
// file), but grounded the same way the rest of the app's nutrition maths
// already is. Gender and age nudge the multiplier gently; neither is a
// medical model, just enough to avoid a flat number for everyone.
export function coldStartMaintenanceKcal(
  bodyWeightKg: number,
  fuelDay: FuelDay,
  gender: Gender,
  dateOfBirth: string | null,
  asOfDate: string
): number {
  let perKg = BAND_KCAL_PER_KG[fuelDay] * GENDER_MULTIPLIER[gender];

  const age = ageFromDob(dateOfBirth, asOfDate);
  if (age !== null && age >= 40) {
    const decades = Math.min(3, Math.floor((age - 40) / 10) + 1);
    perKg *= 1 - decades * 0.02;
  }

  return Math.round(bodyWeightKg * perKg);
}

// ─── Weekly training pattern -> a day's exertion (for projecting days ──
// ─── that have no logged Recovery check-in yet, incl. every future day) ─

export function exertionFromWeeklySessions(sessions: WeeklyTrainingSession[], day: TrainingDayOfWeek): Exertion {
  const daySessions = sessions.filter((s) => s.dayOfWeek === day && s.activityType !== "rest");
  if (daySessions.length === 0) return "low";

  const scoreFor = (activityType: TrainingActivityType, intensity: TrainingIntensity | null): number => {
    if (activityType === "sport" && intensity === "heavy") return 4; // match-like demand
    if (intensity === "heavy") return 3;
    if (intensity === "moderate" || intensity === null) return 2;
    return 1; // light
  };

  const maxScore = Math.max(...daySessions.map((s) => scoreFor(s.activityType, s.intensity)));
  if (maxScore >= 4) return "match";
  if (maxScore === 3) return "high";
  if (maxScore === 2) return "medium";
  return "low";
}

// ─── Yesterday's compliance -> a bounded nudge to today's target ───────

const COMPLIANCE_CATCH_UP_FRACTION = 0.3;
const COMPLIANCE_MAX_ADJUST_KCAL = 250;

// Ate over target yesterday -> nudge today down; ate under -> nudge today
// up. Damped to 30% of the miss and capped at +-250 kcal so one bad (or
// very good) day never causes a shock to today's number.
export function complianceAdjustmentKcal(
  yesterdayTargetKcal: number | null,
  yesterdayActualKcal: number | null
): number {
  if (yesterdayTargetKcal === null || yesterdayActualKcal === null || yesterdayActualKcal <= 0) return 0;
  const miss = yesterdayActualKcal - yesterdayTargetKcal;
  const raw = -miss * COMPLIANCE_CATCH_UP_FRACTION;
  return Math.max(-COMPLIANCE_MAX_ADJUST_KCAL, Math.min(COMPLIANCE_MAX_ADJUST_KCAL, Math.round(raw)));
}

// ─── Goal adjustment + safety floor ─────────────────────────────────────

const GOAL_ADJUSTMENT: Record<WeightGoalBias, number> = {
  maintain: 1.0,
  lose: 0.8,
  gain: 1.1,
};

const SAFETY_FLOOR_KCAL_PER_KG = 18;

export function applyGoalAdjustment(baseKcal: number, bias: WeightGoalBias, bodyWeightKg: number): number {
  const adjusted = baseKcal * GOAL_ADJUSTMENT[bias];
  const floor = bodyWeightKg * SAFETY_FLOOR_KCAL_PER_KG;
  return Math.round(Math.max(adjusted, floor));
}

// ─── Macro split for a calorie target ───────────────────────────────────
//
// Protein and fat come from the same g/kg fuel-band table the rest of the
// app already uses; carbs fill whatever's left so protein+carbs+fat always
// sums to exactly the calorie target (the old per-kg-table approach could
// silently disagree with a separately-set calorie number — this can't).

const MIN_FAT_GKG = 0.5;
const MIN_CARB_G = 50;

export interface DailyMacros {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export function macrosForCalorieTarget(calories: number, bodyWeightKg: number, band: FuelBand): DailyMacros {
  const proteinG = Math.round(bodyWeightKg * band.proteinGkg);
  let fatG = Math.round(bodyWeightKg * band.fatGkg);

  let remainingKcal = calories - proteinG * 4 - fatG * 9;
  if (remainingKcal < MIN_CARB_G * 4) {
    // Relax fat toward its floor to protect protein and a minimum carb
    // intake — happens only at aggressive deficits on a low bodyweight.
    const minFatG = Math.round(bodyWeightKg * MIN_FAT_GKG);
    fatG = Math.max(minFatG, Math.round((calories - proteinG * 4 - MIN_CARB_G * 4) / 9));
    remainingKcal = calories - proteinG * 4 - fatG * 9;
  }

  const carbsG = Math.max(0, Math.round(remainingKcal / 4));

  return { calories, proteinG, carbsG, fatG };
}

// ─── Top-level: one day's target ─────────────────────────────────────────

export interface DailyTargetInput {
  bodyWeightKg: number;
  gender: Gender;
  dateOfBirth: string | null;
  goalBias: WeightGoalBias;
  /** Precompute once per member per request and reuse across every day of
      a week projection — it doesn't vary day to day. */
  tdee: TdeeEstimate | null;
  /** Weighted 3-day load for this specific date (see weightedThreeDayLoad). */
  load: number;
  /** This day's ISO date — used for the cold-start age calculation. */
  date: string;
  /** Only meaningful when this day is the real "today". Omit for any other
      day (past days keep whatever they showed; future days can't know). */
  yesterdayComplianceKcal?: number;
}

export interface DailyTarget extends DailyMacros {
  fuelDay: FuelDay;
  fuelDayLabel: string;
  source: "adaptive" | "estimated";
  /** Estimated total calories burned this day, before any goal-driven
      deficit/surplus is applied to the eating target — i.e. expenditure,
      not intake. Surfaced for hydration (1ml of water per kcal expended is
      the rule of thumb this app uses), not shown as an eating target. */
  expenditureKcal: number;
}

export function computeDailyTarget(input: DailyTargetInput): DailyTarget {
  const band = fuelBandForLoad(input.load);

  const baseKcal =
    input.tdee !== null
      ? input.tdee.kcal
      : coldStartMaintenanceKcal(input.bodyWeightKg, band.day, input.gender, input.dateOfBirth, input.date);

  const goalAdjusted = applyGoalAdjustment(baseKcal, input.goalBias, input.bodyWeightKg);
  const withCompliance = Math.round(goalAdjusted + (input.yesterdayComplianceKcal ?? 0));
  const finalKcal = Math.max(Math.round(input.bodyWeightKg * SAFETY_FLOOR_KCAL_PER_KG), withCompliance);

  const macros = macrosForCalorieTarget(finalKcal, input.bodyWeightKg, band);

  return {
    ...macros,
    fuelDay: band.day,
    fuelDayLabel: band.label,
    source: input.tdee !== null ? "adaptive" : "estimated",
    expenditureKcal: Math.round(baseKcal),
  };
}
