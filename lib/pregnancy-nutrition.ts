// How pregnancy, the weeks after the birth and breastfeeding change the
// calorie target. Pure; the resolver (lib/nutrition-target-data.ts) applies
// it. Figures and sources: docs/pregnancy-support-sources-2026-10.md.
//
// - Pregnant: no deficit (any loss or gain goal becomes maintenance), plus
//   the HSE extra for the trimester: none, +250, then +500 kcal a day.
// - First 12 weeks after the birth: still no deficit; +500 a day while
//   breastfeeding (EFSA).
// - After that, while still breastfeeding: the normal goal returns, with
//   +500 a day and any loss pace capped at a gentle rate.
// - Learning the member's burn from weigh-ins is paused from conception
//   until the 12 weeks are up and breastfeeding has stopped, because
//   pregnancy weight gain, the birth and milk production would all be read
//   as changes in burn.

import type { PregnancyStatusRecord } from "./profile-schema";

const DAY_MS = 86_400_000;
const FULL_TERM_DAYS = 280;
export const POSTPARTUM_WEEKS = 12;

export const TRIMESTER_EXTRA_KCAL: Record<1 | 2 | 3, number> = { 1: 0, 2: 250, 3: 500 };
export const BREASTFEEDING_EXTRA_KCAL = 500;
/** Fastest loss pace allowed while breastfeeding after the first 12 weeks. */
export const BREASTFEEDING_MAX_LOSS_PCT_PER_WEEK = -0.5;

export type NutritionStage =
  | { kind: "pregnant"; trimester: 1 | 2 | 3; weeksPregnant: number }
  | { kind: "postpartum"; weeksSinceBirth: number; breastfeeding: boolean }
  | { kind: "breastfeeding"; weeksSinceBirth: number };

function daysBetween(fromISO: string, toISO: string): number {
  return Math.floor((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / DAY_MS);
}

function isoPlusDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Estimated start of the pregnancy (40 weeks before the due date). */
export function pregnancyStartISO(dueDate: string): string {
  return isoPlusDays(dueDate, -FULL_TERM_DAYS);
}

export function nutritionStageFor(
  pregnancy: PregnancyStatusRecord | null | undefined,
  asOfISO: string
): NutritionStage | null {
  if (!pregnancy?.isPregnant || !pregnancy.dueDate) return null;
  const bornBy = pregnancy.birthDate ?? pregnancy.dueDate;

  if (asOfISO < bornBy) {
    const weeksPregnant = Math.max(0, Math.floor(daysBetween(pregnancyStartISO(pregnancy.dueDate), asOfISO) / 7));
    const trimester = weeksPregnant < 14 ? 1 : weeksPregnant < 28 ? 2 : 3;
    return { kind: "pregnant", trimester, weeksPregnant };
  }

  const weeksSinceBirth = Math.floor(daysBetween(bornBy, asOfISO) / 7);
  const breastfeeding = pregnancy.breastfeeding === true;
  if (weeksSinceBirth < POSTPARTUM_WEEKS) return { kind: "postpartum", weeksSinceBirth, breastfeeding };
  if (breastfeeding) return { kind: "breastfeeding", weeksSinceBirth };
  return null;
}

export interface StageAdjustment {
  kind: NutritionStage["kind"];
  extraKcal: number;
  /** Goal adjustments are clamped into this range (kcal/day). */
  minAdjustKcal: number | null;
  maxAdjustKcal: number | null;
  /** Member-facing line for "Why this number?". */
  line: string;
}

// kcal/day for a loss pace in % bodyweight a week (7700 kcal per kg).
function paceKcal(pctPerWeek: number, bodyWeightKg: number): number {
  return Math.round(((pctPerWeek / 100) * bodyWeightKg * 7700) / 7);
}

export function stageAdjustment(stage: NutritionStage, bodyWeightKg: number): StageAdjustment {
  if (stage.kind === "pregnant") {
    const extra = TRIMESTER_EXTRA_KCAL[stage.trimester];
    const which = ["first", "second", "third"][stage.trimester - 1];
    return {
      kind: "pregnant",
      extraKcal: extra,
      minAdjustKcal: 0,
      maxAdjustKcal: 0,
      line:
        extra > 0
          ? `Includes +${extra} kcal a day for your ${which} trimester (HSE guidance), with no weight-loss deficit while you're pregnant.`
          : `Set to maintain your weight in your ${which} trimester. No extra calories are needed yet (HSE guidance) and there's no weight-loss deficit while you're pregnant.`,
    };
  }
  if (stage.kind === "postpartum") {
    return {
      kind: "postpartum",
      extraKcal: stage.breastfeeding ? BREASTFEEDING_EXTRA_KCAL : 0,
      minAdjustKcal: 0,
      maxAdjustKcal: 0,
      line: stage.breastfeeding
        ? `Includes +${BREASTFEEDING_EXTRA_KCAL} kcal a day while you're breastfeeding, with no weight-loss deficit for the first ${POSTPARTUM_WEEKS} weeks after the birth. Let the app know when you stop breastfeeding.`
        : `Set to maintain your weight for the first ${POSTPARTUM_WEEKS} weeks after the birth, with no weight-loss deficit.`,
    };
  }
  return {
    kind: "breastfeeding",
    extraKcal: BREASTFEEDING_EXTRA_KCAL,
    minAdjustKcal: paceKcal(BREASTFEEDING_MAX_LOSS_PCT_PER_WEEK, bodyWeightKg),
    maxAdjustKcal: null,
    line: `Includes +${BREASTFEEDING_EXTRA_KCAL} kcal a day while you're breastfeeding, and any weight loss is kept gentle. Let the app know when you stop breastfeeding.`,
  };
}

/**
 * The span of dates whose weigh-ins and food days must not teach the burn
 * estimate: from the start of the pregnancy until 12 weeks after the birth
 * or, if later, until breastfeeding stopped. `to` is null while it's still
 * running.
 */
export function learningPauseFor(
  pregnancy: PregnancyStatusRecord | null | undefined,
  asOfISO: string
): { from: string; to: string | null } | null {
  if (!pregnancy?.isPregnant || !pregnancy.dueDate) return null;
  const from = pregnancyStartISO(pregnancy.dueDate);
  if (asOfISO < from) return null;
  const bornBy = pregnancy.birthDate ?? pregnancy.dueDate;
  const postpartumEnd = isoPlusDays(bornBy, POSTPARTUM_WEEKS * 7);
  if (pregnancy.breastfeeding === true) return { from, to: null };
  const breastfeedingEnd = pregnancy.breastfeedingEndedOn ?? null;
  const to = breastfeedingEnd && breastfeedingEnd > postpartumEnd ? breastfeedingEnd : postpartumEnd;
  return { from, to: asOfISO < to ? null : to };
}
