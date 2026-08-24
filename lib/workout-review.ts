import {
  findCycleSettingsByUserId,
  findFoodEntriesByUserId,
  findPregnancyStatusByUserId,
  findProfileByUserId,
  findRecoveryLogByUserIdAndDate,
  findWaterLogByUserIdAndDate,
  findWorkoutSessionsByUserId,
  normalizeRecoveryScale,
  type RecoveryLogRecord,
  type WorkoutSessionRecord,
} from "./db";
import { estimatePhase, type PhaseEstimate } from "./cycle-phase";
import { estimatePregnancy, type PregnancyEstimate } from "./pregnancy";
import { sumDailyTotals } from "./nutrition-diary";
import { getResolvedNutritionTarget } from "./nutrition-target-data";

// Sum of weight x reps across every logged set — the same "total volume"
// concept the mobile log form already shows locally right after saving.
// Per-set detail wins when present; falls back to the shared weight/reps/sets
// fields for exercises logged without per-set breakdown.
function sessionVolume(session: WorkoutSessionRecord): number {
  let total = 0;
  for (const ex of session.exercises) {
    if (ex.setDetails && ex.setDetails.length > 0) {
      for (const sd of ex.setDetails) {
        const w = sd.weight ? parseFloat(sd.weight) : NaN;
        const r = sd.reps ?? NaN;
        if (Number.isFinite(w) && Number.isFinite(r)) total += w * r;
      }
    } else {
      const w = ex.weight ? parseFloat(ex.weight) : NaN;
      const r = ex.reps ?? NaN;
      const sets = ex.sets ?? 1;
      if (Number.isFinite(w) && Number.isFinite(r)) total += w * r * sets;
    }
  }
  return Math.round(total);
}

export interface SessionComparison {
  thisVolume: number;
  thisDurationMins: number | null;
  thisRpe: number | null;
  recentAvgVolume: number | null;
  recentAvgRpe: number | null;
  recentAvgDurationMins: number | null;
  comparedSessionCount: number;
}

export interface NutritionCompliance {
  logged: boolean;
  targetCalories: number | null;
  targetProteinG: number | null;
  actualCalories: number | null;
  actualProteinG: number | null;
}

export interface HydrationCompliance {
  targetMl: number | null;
  loggedMl: number;
}

export interface WorkoutReviewData {
  session: WorkoutSessionRecord;
  comparison: SessionComparison;
  recovery: RecoveryLogRecord | null;
  cyclePhase: PhaseEstimate | null;
  pregnancy: PregnancyEstimate | null;
  nutrition: NutritionCompliance | null;
  hydration: HydrationCompliance | null;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

// Everything the AI synthesis (and the review screen itself) needs, computed
// once from data that already exists elsewhere in the app — nothing here is
// invented, it's all comparisons/lookups against real logged records.
export function buildWorkoutReviewData(userId: string, session: WorkoutSessionRecord): WorkoutReviewData {
  const allSessions = findWorkoutSessionsByUserId(userId);
  const comparable = allSessions
    .filter((s) => s.id !== session.id && s.title.trim().toLowerCase() === session.title.trim().toLowerCase())
    .slice(0, 5);

  const thisVolume = sessionVolume(session);
  const comparableVolumes = comparable.map(sessionVolume).filter((v) => v > 0);
  const comparableRpes = comparable.map((s) => s.sessionRpe).filter((v): v is number => v != null);
  const comparableDurations = comparable.map((s) => s.durationMins).filter((v): v is number => v != null);

  const comparison: SessionComparison = {
    thisVolume,
    thisDurationMins: session.durationMins,
    thisRpe: session.sessionRpe ?? null,
    recentAvgVolume: average(comparableVolumes),
    recentAvgRpe: average(comparableRpes),
    recentAvgDurationMins: average(comparableDurations),
    comparedSessionCount: comparable.length,
  };

  const rawRecovery = findRecoveryLogByUserIdAndDate(userId, session.date) ?? null;
  const recovery = rawRecovery ? normalizeRecoveryScale(rawRecovery) : null;

  const profile = findProfileByUserId(userId);
  let cyclePhase: PhaseEstimate | null = null;
  if (profile?.cycleTrackingEligible && profile.cycleTrackingEnabled) {
    const cycleSettings = findCycleSettingsByUserId(userId);
    if (cycleSettings) {
      const estimate = estimatePhase(
        cycleSettings.lastPeriodStartDate,
        cycleSettings.averageCycleLengthDays,
        cycleSettings.periodLengthDays,
        cycleSettings.regularity,
        session.date
      );
      if (estimate.phase !== "Unknown") cyclePhase = estimate;
    }
  }

  let pregnancy: PregnancyEstimate | null = null;
  if (profile?.cycleTrackingEligible) {
    const pregnancyStatus = findPregnancyStatusByUserId(userId);
    if (pregnancyStatus?.isPregnant) {
      const estimate = estimatePregnancy(true, pregnancyStatus.dueDate, session.date);
      if (estimate.content) pregnancy = estimate;
    }
  }

  const todayISO = new Date().toISOString().slice(0, 10);
  const target = getResolvedNutritionTarget(userId, session.date, todayISO);
  const entries = findFoodEntriesByUserId(userId).filter((e) => e.date === session.date);
  const nutrition: NutritionCompliance | null = target
    ? {
        logged: entries.length > 0,
        targetCalories: target.calories,
        targetProteinG: target.proteinG,
        actualCalories: entries.length > 0 ? sumDailyTotals(entries).calories : null,
        actualProteinG: entries.length > 0 ? sumDailyTotals(entries).proteinG : null,
      }
    : null;

  const hydration: HydrationCompliance | null = target
    ? { targetMl: target.calories, loggedMl: findWaterLogByUserIdAndDate(userId, session.date)?.ml ?? 0 }
    : null;

  return { session, comparison, recovery, cyclePhase, pregnancy, nutrition, hydration };
}

// Plain-text grounding block for the AI call — every fact here is one the
// review screen also displays directly, so the model can't say anything the
// member can't independently verify against their own numbers.
export function formatWorkoutReviewContext(data: WorkoutReviewData): string {
  const { session, comparison, recovery, cyclePhase, nutrition } = data;
  const lines: string[] = [];

  lines.push(`Session: "${session.title}" on ${session.date}, duration ${session.durationMins ?? "not logged"} min.`);
  lines.push(
    session.sessionRpe != null
      ? `Session RPE (member-reported, 1-10): ${session.sessionRpe}.`
      : "Session RPE: not reported."
  );
  if (session.feelingNotes) lines.push(`Member's own note about this session: "${session.feelingNotes}"`);
  lines.push(`Total volume this session (sum of weight x reps across all sets): ${comparison.thisVolume} kg.`);

  if (comparison.comparedSessionCount > 0) {
    lines.push(
      `Compared to their last ${comparison.comparedSessionCount} session(s) also titled "${session.title}": average volume ${comparison.recentAvgVolume ?? "n/a"} kg, average RPE ${comparison.recentAvgRpe ?? "n/a"}, average duration ${comparison.recentAvgDurationMins ?? "n/a"} min.`
    );
  } else {
    lines.push(`No previous session with this same title to compare volume/RPE against.`);
  }

  if (recovery) {
    lines.push(
      `Recovery log for this date: sleep ${recovery.sleepHours ?? "n/a"} hours, sleep quality ${recovery.sleepQuality ?? "n/a"}/10, soreness ${recovery.soreness ?? "n/a"}/10, fatigue ${recovery.fatigue ?? "n/a"}/5, readiness score ${recovery.readinessScore ?? "n/a"}.`
    );
  } else {
    lines.push(`No recovery log for this date, so sleep/soreness/fatigue can't be factored in.`);
  }

  if (cyclePhase) {
    lines.push(
      `Estimated menstrual cycle phase on this date: ${cyclePhase.phaseLabel} (cycle day ${cyclePhase.cycleDay} of an estimated ${cyclePhase.cycleLength}-day cycle, confidence: ${cyclePhase.confidence}).`
    );
  }

  if (data.pregnancy?.content) {
    lines.push(
      `Member was pregnant on this date: ${data.pregnancy.content.label}, week ${data.pregnancy.weeksPregnant}. Keep any comments about intensity or exercise choice general and consistent with standard prenatal exercise guidance — do not invent medical advice.`
    );
  }

  if (nutrition) {
    if (nutrition.logged) {
      lines.push(
        `Nutrition logged this date: ${nutrition.actualCalories ?? "n/a"} kcal / ${nutrition.actualProteinG ?? "n/a"}g protein, vs. a target of ${nutrition.targetCalories ?? "n/a"} kcal / ${nutrition.targetProteinG ?? "n/a"}g protein.`
      );
    } else {
      lines.push(`No food logged for this date, so how well they fueled can't be assessed.`);
    }
  }

  if (data.hydration && data.hydration.targetMl !== null) {
    lines.push(
      `Hydration logged this date: ${data.hydration.loggedMl}ml, vs. a target of ${data.hydration.targetMl}ml (1ml per estimated kcal expended).`
    );
  }

  return lines.join("\n");
}
