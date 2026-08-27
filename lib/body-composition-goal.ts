// Weight/body-fat goal timelines — lets a member set a target value (weight
// kg and/or body-fat %) and a date, see an honest projection of whether
// that's realistic, and have the daily calorie target adjust to actually
// aim at it (see goalTimelineAdjustKcal below, wired into computeDailyTarget
// in lib/nutrition-target.ts).
//
// Deliberately reuses computeWeightTrend's least-squares regression rather
// than writing new trend-fitting code — a body-fat % log series is fed
// through it by mapping {date, bodyFatPct} onto the same {date, weightKg}
// shape it expects (a plain unit-agnostic value-over-time regression
// underneath; the field name is just this module's borrowed vocabulary).

import { computeWeightTrend, KCAL_PER_KG_FAT, type WeightPoint, type WeightTrend } from "./nutrition-target";

// Widely-cited safe upper bounds: ~1%/week bodyweight loss for fat loss,
// and a much lower ceiling for gain since lean muscle gain is biologically
// rate-limited in a way fat loss isn't. Applied as a hard clamp on the
// timeline-derived daily adjustment — a member's chosen date can imply a
// faster rate, but the calorie target itself never chases it past this.
const MAX_SAFE_WEEKLY_LOSS_FRACTION = 0.01;
const MAX_SAFE_WEEKLY_GAIN_FRACTION = 0.0025;

export type GoalDirection = "lose" | "gain" | "maintain";

export interface GoalTimelineInput {
  currentValue: number;
  goalValue: number;
  /** The member's chosen target date, or null if they haven't set one —
      only the "at your current logged trend" projection is possible then. */
  targetDateISO: string | null;
  asOfDateISO: string;
  /** Logged history for whichever metric this goal tracks (weight or body
      fat %) — used to compute the "at your current pace" projection. */
  history: WeightPoint[];
}

export interface GoalTimelineResult {
  direction: GoalDirection;
  /** Days from asOfDateISO to targetDateISO — null if no target date set,
      or negative if the date has already passed. */
  daysToTarget: number | null;
  /** The weekly rate of change needed to hit the member's chosen date,
      signed to match direction (negative for "lose"). Null without a
      target date, or when the goal is already met. */
  requiredWeeklyRate: number | null;
  /** requiredWeeklyRate clamped to the safe bounds above — this is what
      actually drives the calorie adjustment. Equal to requiredWeeklyRate
      when the member's date is already realistic. */
  clampedWeeklyRate: number | null;
  /** True when the member's chosen date requires a faster rate than the
      safe clamp allows — the app is honest about this rather than quietly
      under-delivering against an unrealistic date. */
  isAggressive: boolean;
  /** Projected date to reach goalValue at the member's own logged trend
      pace, independent of their chosen date. Null when there isn't enough
      logged history yet, or the current trend isn't moving toward the goal
      at all. */
  projectedDateAtCurrentTrend: string | null;
}

function isoDaysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function addIsoDays(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

function directionFor(currentValue: number, goalValue: number): GoalDirection {
  const diff = goalValue - currentValue;
  if (Math.abs(diff) < 0.05) return "maintain";
  return diff < 0 ? "lose" : "gain";
}

export function computeGoalTimeline(input: GoalTimelineInput): GoalTimelineResult {
  const direction = directionFor(input.currentValue, input.goalValue);
  const diff = input.goalValue - input.currentValue;

  let daysToTarget: number | null = null;
  let requiredWeeklyRate: number | null = null;
  let clampedWeeklyRate: number | null = null;
  let isAggressive = false;

  if (input.targetDateISO && direction !== "maintain") {
    daysToTarget = isoDaysBetween(input.asOfDateISO, input.targetDateISO);
    if (daysToTarget > 0) {
      requiredWeeklyRate = (diff / daysToTarget) * 7;
      const maxLoss = -Math.abs(input.currentValue * MAX_SAFE_WEEKLY_LOSS_FRACTION);
      const maxGain = Math.abs(input.currentValue * MAX_SAFE_WEEKLY_GAIN_FRACTION);
      clampedWeeklyRate = Math.max(maxLoss, Math.min(maxGain, requiredWeeklyRate));
      isAggressive = Math.abs(clampedWeeklyRate - requiredWeeklyRate) > 0.001;
    }
  }

  const trend: WeightTrend | null = computeWeightTrend(input.history);
  let projectedDateAtCurrentTrend: string | null = null;
  if (trend && direction !== "maintain") {
    const slopePerDay = trend.slopeKgPerDay;
    const movingTowardGoal = (direction === "lose" && slopePerDay < 0) || (direction === "gain" && slopePerDay > 0);
    if (movingTowardGoal) {
      const daysNeeded = diff / slopePerDay;
      if (Number.isFinite(daysNeeded) && daysNeeded > 0) {
        projectedDateAtCurrentTrend = addIsoDays(input.asOfDateISO, daysNeeded);
      }
    }
  }

  return { direction, daysToTarget, requiredWeeklyRate, clampedWeeklyRate, isAggressive, projectedDateAtCurrentTrend };
}

// Converts a (already safety-clamped) weekly rate of change into the daily
// calorie adjustment that would produce it — additive, same convention as
// cyclePhaseAdjustmentKcal/complianceAdjustmentKcal in lib/nutrition-target.ts.
export function goalTimelineAdjustKcal(clampedWeeklyRate: number | null): number {
  if (clampedWeeklyRate === null) return 0;
  return Math.round((clampedWeeklyRate * KCAL_PER_KG_FAT) / 7);
}
