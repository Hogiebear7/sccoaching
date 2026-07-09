import { cookies } from "next/headers";

import {
  findBodyWeightLogsByUserId,
  findProfileByUserId,
  findRecoveryLogsByUserId,
  findUserById,
  findWorkoutSessionsByUserId,
} from "@/lib/db";
import { resolveCurrentWeightKg } from "@/lib/body-weight";
import { computeRollingTrainingLoad, trainingLoadForLog } from "@/lib/recovery";
import { exertionFromDayLoad, goalBiasFromPrimaryGoal, type Exertion } from "@/lib/nutrition";
import { verifySession } from "@/lib/session";
import { NutritionView } from "./NutritionView";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default async function NutritionPage() {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  const profile = user ? findProfileByUserId(user.id) : undefined;

  if (!user || !profile) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-display text-[28px]">Nutrition</h1>
        </div>
        <div className="panel p-5">
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t load profile data for this account. Try logging out and back in.
          </p>
        </div>
      </div>
    );
  }

  const recoveryLogs = findRecoveryLogsByUserId(user.id);
  const sessions = findWorkoutSessionsByUserId(user.id);

  const todayISO = isoDaysAgo(0);
  const yesterdayISO = isoDaysAgo(1);

  // Derive yesterday/today exertion from real logged load (duration × RPE,
  // same signal the Recovery tab uses). Tomorrow is a member selection —
  // the app can't know a planned session it hasn't seen.
  function dayLoadFor(dateISO: string): number {
    return recoveryLogs
      .filter((log) => log.date === dateISO)
      .map(trainingLoadForLog)
      .filter((load): load is number => load !== null)
      .reduce((total, load) => total + load, 0);
  }

  const yesterdayExertion: Exertion = exertionFromDayLoad(dayLoadFor(yesterdayISO));
  const todayExertion: Exertion = exertionFromDayLoad(dayLoadFor(todayISO));

  const todayLog = recoveryLogs.find((log) => log.date === todayISO);
  const rolling = computeRollingTrainingLoad(recoveryLogs);

  const lastSession = [...sessions].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;

  return (
    <NutritionView
      bodyWeightKg={resolveCurrentWeightKg(
        profile.currentWeightKg,
        findBodyWeightLogsByUserId(user.id)
      )}
      goalBias={goalBiasFromPrimaryGoal(profile.primaryGoal)}
      primaryGoal={profile.primaryGoal}
      yesterdayExertion={yesterdayExertion}
      todayExertion={todayExertion}
      readinessScore={todayLog?.readinessScore ?? null}
      sevenDayLoad={rolling.sevenDaySum}
      daysWithLoad={rolling.daysWithLoad}
      lastSessionTitle={lastSession?.title ?? null}
      lastSessionDate={lastSession?.date ?? null}
      initialDrinkSettings={profile.drinkSettings ?? null}
    />
  );
}
