import type { RecoveryLogRecord, WorkoutSessionRecord } from "./db";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Coaching-oriented readiness score (0-100), not a medical assessment.
// Each input contributes up to 25 points: sleep duration (capped at 8h),
// sleep quality (1-10, higher is better), soreness (1-10) and fatigue
// (1-5) — both inverted so less soreness/fatigue scores higher.
export function computeReadinessScore(input: {
  sleepHours: number;
  sleepQuality: number;
  soreness: number;
  fatigue: number;
}): number {
  const sleepHoursScore = (clamp(input.sleepHours, 0, 8) / 8) * 25;
  const sleepQualityScore = (clamp(input.sleepQuality - 1, 0, 9) / 9) * 25;
  const sorenessScore = (clamp(10 - input.soreness, 0, 9) / 9) * 25;
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

// Load for a single logged workout session — mirrors trainingLoadForLog's
// duration x RPE formula, using the session's own duration/RPE ("How did
// that feel?") rather than the separate, optional Recovery check-in fields.
// Exported for lib/nutrition-target-data.ts's exertionForDate, which sums
// same-date sessions with this exact formula for its logged-workout tier —
// see the same-date-only-once-per-source discipline noted above.
export function trainingLoadForSession(session: WorkoutSessionRecord): number | null {
  if (session.durationMins === null || session.durationMins === undefined) return null;
  if (session.sessionRpe === null || session.sessionRpe === undefined) return null;
  return session.durationMins * session.sessionRpe;
}

// Rolling 7-day training load. Members can log daily duration/RPE on the
// Recovery check-in form, but that's redundant manual entry most members
// skip since logging a workout already records duration + RPE via "How did
// that feel?". So per day: prefer the Recovery check-in's own value when
// present, otherwise fall back to that day's logged workout session(s) —
// never both, to avoid double-counting a day covered by either source.
export function computeRollingTrainingLoad(
  logs: RecoveryLogRecord[],
  sessions: WorkoutSessionRecord[] = []
): { sevenDaySum: number; sevenDayAverage: number; daysWithLoad: number } {
  const today = new Date();
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 6);

  const todayISO = today.toISOString().slice(0, 10);
  const sevenDaysAgoISO = sevenDaysAgo.toISOString().slice(0, 10);

  const logLoadByDate = new Map<string, number>();
  for (const log of logs) {
    if (log.date < sevenDaysAgoISO || log.date > todayISO) continue;
    const load = trainingLoadForLog(log);
    if (load !== null) logLoadByDate.set(log.date, (logLoadByDate.get(log.date) ?? 0) + load);
  }

  const sessionLoadByDate = new Map<string, number>();
  for (const session of sessions) {
    if (session.date < sevenDaysAgoISO || session.date > todayISO) continue;
    const load = trainingLoadForSession(session);
    if (load !== null) sessionLoadByDate.set(session.date, (sessionLoadByDate.get(session.date) ?? 0) + load);
  }

  const datesWithLoad = new Set([...logLoadByDate.keys(), ...sessionLoadByDate.keys()]);
  const loadsInWindow = [...datesWithLoad].map((date) => logLoadByDate.get(date) ?? sessionLoadByDate.get(date)!);

  const sevenDaySum = loadsInWindow.reduce((total, load) => total + load, 0);
  const daysWithLoad = loadsInWindow.length;
  const sevenDayAverage = daysWithLoad > 0 ? Math.round(sevenDaySum / daysWithLoad) : 0;

  return { sevenDaySum, sevenDayAverage, daysWithLoad };
}
