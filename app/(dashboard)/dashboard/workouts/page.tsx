import { cookies } from "next/headers";

import {
  findExercises,
  findProfileByUserId,
  findRecoveryLogsByUserId,
  findUserById,
  findWeeklyTrainingScheduleByUserId,
  findWorkoutSessionsByUserId,
} from "@/lib/db";
import { computeRollingTrainingLoad } from "@/lib/recovery";
import { verifySession } from "@/lib/session";
import { plannedExertionForDate } from "@/lib/weekly-training";
import type { HelperContext } from "@/lib/workout-helper";
import { WorkoutsView } from "./WorkoutsView";

export default async function DashboardWorkoutsPage() {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  const profile = user ? findProfileByUserId(user.id) : undefined;
  const sessions = user ? findWorkoutSessionsByUserId(user.id) : [];

  if (!user || !profile) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-display text-[28px]">Workouts</h1>
        </div>
        <div className="surface-card p-5">
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t load profile data for this account. Try logging out and back in.
          </p>
        </div>
      </div>
    );
  }

  const exercises = findExercises();

  // Workout Helper context: today's readiness score plus the rolling
  // 7-day training load already used by the Recovery tab.
  const recoveryLogs = findRecoveryLogsByUserId(user.id);
  const todayISO = new Date().toISOString().slice(0, 10);
  const todayLog = recoveryLogs.find((log) => log.date === todayISO);
  const rollingLoad = computeRollingTrainingLoad(recoveryLogs, sessions);

  // Whatever's already planned/booked for today (including a class booking
  // synced into Weekly Training — see lib/weekly-training-sync.ts) so the
  // Helper doesn't stack a full/standard session on top of a heavy day.
  const weeklySchedule = findWeeklyTrainingScheduleByUserId(user.id);
  const plannedTodayExertion = plannedExertionForDate(weeklySchedule, todayISO);

  const helperContext: HelperContext = {
    readinessScore: todayLog?.readinessScore ?? null,
    sevenDayLoad: rollingLoad.sevenDaySum,
    daysWithLoad: rollingLoad.daysWithLoad,
    plannedTodayExertion,
  };

  return <WorkoutsView sessions={sessions} exercises={exercises} helperContext={helperContext} />;
}
