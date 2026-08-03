import { cookies } from "next/headers";

import {
  findAiMessagesByUserId,
  findBodyWeightLogsByUserId,
  findProfileByUserId,
  findRecoveryLogsByUserId,
  findUserById,
  findWorkoutSessionsByUserId,
} from "@/lib/db";
import { resolveCurrentWeightKg } from "@/lib/body-weight";
import { resolveBookingsForUser } from "@/lib/bookings";
import { computeRollingTrainingLoad, trainingLoadForLog } from "@/lib/recovery";
import { exertionFromDayLoad, goalBiasFromPrimaryGoal, type Exertion } from "@/lib/nutrition";
import { recommendFoods } from "@/lib/nutrition-recommendations";
import {
  ALLERGEN_OPTIONS,
  DIETARY_PREFERENCE_OPTIONS,
  INTOLERANCE_OPTIONS,
} from "@/lib/profile-options";
import { isAiConfigured } from "@/lib/ai";
import { verifySession } from "@/lib/session";
import { NutritionView } from "./NutritionView";

// Friendly label for the "Excluding …" summary line.
const DIET_LABEL = new Map<string, string>(
  [...ALLERGEN_OPTIONS, ...INTOLERANCE_OPTIONS].map((o) => [o.value, o.label])
);

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

  // Dietary-aware food suggestions. Hard exclusions are applied in recommendFoods.
  const foodRecommendations = recommendFoods({
    dietaryPreference: profile.dietaryPreference,
    allergies: profile.allergies,
    intolerancesOrMedical: profile.intolerancesOrMedical,
  });
  const pref = profile.dietaryPreference ?? "standard";
  const preferenceLabel =
    pref === "standard"
      ? "Balanced"
      : DIETARY_PREFERENCE_OPTIONS.find((o) => o.value === pref)?.label ?? "Balanced";
  const dietarySummary = {
    preferenceLabel,
    exclusions: [...(profile.allergies ?? []), ...(profile.intolerancesOrMedical ?? [])].map(
      (k) => DIET_LABEL.get(k) ?? k
    ),
  };

  // Next upcoming booked session/match, for the AI Nutrition Coach's
  // match-day and next-session grounding — reuses the same resolver the
  // Bookings and Schedule pages already use, no new business logic.
  const nextBooking =
    resolveBookingsForUser(user.id)
      .filter((b) => !b.isPast)
      .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`))[0] ?? null;

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
      foodRecommendations={foodRecommendations}
      dietarySummary={dietarySummary}
      aiNutritionCoachConfigured={isAiConfigured()}
      initialAiNutritionMessages={findAiMessagesByUserId(user.id, "nutrition")}
      nextSession={
        nextBooking ? { title: nextBooking.title, date: nextBooking.date, category: nextBooking.category } : null
      }
    />
  );
}
