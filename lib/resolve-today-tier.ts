import { findRecoveryLogsByUserId, findWeeklyTrainingScheduleByUserId, findWorkoutSessionsByUserId } from "./db";
import { currentHealthNote, mentionsIllnessOrInjury } from "./health-note";
import { computeRollingTrainingLoad } from "./recovery";
import { plannedExertionForDate } from "./weekly-training";
import { decideTier, type SessionTier } from "./workout-helper";

// Server-only — pulls in lib/db.ts's fs-based reads, so this must stay a
// separate module from lib/workout-helper.ts (which classifyLoad/decideTier
// live in and is imported by client components like NutritionView.tsx).
// Bundling fs-touching code into workout-helper.ts broke the production
// build ("Module not found: Can't resolve 'fs'") the first time this lived
// there — keep the split.
//
// Shared by the mobile tier route (app/api/mobile/workout-helper/tier) and
// the AI-programme GET route's read-time tier trim — one implementation of
// "what's today's Workout Helper tier for this member" instead of two.
export function resolveTodayTier(userId: string): { tier: SessionTier; rationale: string } {
  const today = new Date().toISOString().slice(0, 10);
  const recoveryLogs = findRecoveryLogsByUserId(userId);
  const sessions = findWorkoutSessionsByUserId(userId);
  const schedule = findWeeklyTrainingScheduleByUserId(userId);

  const todayLog = recoveryLogs.find((log) => log.date === today);
  const readinessScore = todayLog?.readinessScore ?? null;
  const rolling = computeRollingTrainingLoad(recoveryLogs, sessions);
  const plannedTodayExertion = plannedExertionForDate(schedule, today);

  const decided = decideTier({
    readinessScore,
    sevenDayLoad: rolling.sevenDaySum,
    daysWithLoad: rolling.daysWithLoad,
    plannedTodayExertion,
  });

  // A fresh "injured or sick?" check-in note that mentions illness or injury keeps today gentle, whatever the numbers say.
  const note = currentHealthNote(recoveryLogs, today);
  if (note && note.ageDays <= 2 && mentionsIllnessOrInjury(note.note) && decided.tier !== "reduced") {
    return {
      tier: "reduced",
      rationale: `${decided.rationale} Your check-in note says you're not feeling your best, so today stays gentle. Listen to your body and speak to a professional if it's getting worse.`,
    };
  }
  return decided;
}
