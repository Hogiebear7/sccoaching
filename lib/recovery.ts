import type { RecoveryLogRecord } from "./db";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Coaching-oriented readiness score (0-100), not a medical assessment.
// Each input contributes up to 25 points: sleep duration (capped at 8h),
// sleep quality (1-5, higher is better), soreness and fatigue (1-5, lower
// is better — inverted so less soreness/fatigue scores higher).
export function computeReadinessScore(input: {
  sleepHours: number;
  sleepQuality: number;
  soreness: number;
  fatigue: number;
}): number {
  const sleepHoursScore = (clamp(input.sleepHours, 0, 8) / 8) * 25;
  const sleepQualityScore = (clamp(input.sleepQuality - 1, 0, 4) / 4) * 25;
  const sorenessScore = (clamp(5 - input.soreness, 0, 4) / 4) * 25;
  const fatigueScore = (clamp(5 - input.fatigue, 0, 4) / 4) * 25;

  return Math.round(sleepHoursScore + sleepQualityScore + sorenessScore + fatigueScore);
}

export function readinessGuidance(score: number): string {
  if (score >= 80) {
    return "You're well recovered — a good day to push intensity if your programme calls for it.";
  }

  if (score >= 60) {
    return "Solid recovery. Train as planned and pay attention to how you feel as you warm up.";
  }

  if (score >= 40) {
    return "Recovery is mixed today. Consider an easier session or extra warm-up, especially if soreness or fatigue is high.";
  }

  return "Recovery looks low today. Prioritise rest, mobility, or a light session — pushing hard now adds risk without much benefit.";
}

export function trainingLoadForLog(log: RecoveryLogRecord): number | null {
  if (log.trainingDurationMins === null || log.rpe === null) return null;
  return log.trainingDurationMins * log.rpe;
}

export function computeRollingTrainingLoad(
  logs: RecoveryLogRecord[]
): { sevenDaySum: number; sevenDayAverage: number; daysWithLoad: number } {
  const today = new Date();
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 6);

  const todayISO = today.toISOString().slice(0, 10);
  const sevenDaysAgoISO = sevenDaysAgo.toISOString().slice(0, 10);

  const loadsInWindow = logs
    .filter((log) => log.date >= sevenDaysAgoISO && log.date <= todayISO)
    .map(trainingLoadForLog)
    .filter((load): load is number => load !== null);

  const sevenDaySum = loadsInWindow.reduce((total, load) => total + load, 0);
  const daysWithLoad = loadsInWindow.length;
  const sevenDayAverage = daysWithLoad > 0 ? Math.round(sevenDaySum / daysWithLoad) : 0;

  return { sevenDaySum, sevenDayAverage, daysWithLoad };
}
