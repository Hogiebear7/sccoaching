import {
  findAiMessagesByUserId,
  findBodyWeightLogsByUserId,
  findProfileByUserId,
  findRecoveryLogsByUserId,
  findUserById,
  findWorkoutSessionsByUserId,
} from "./db";
import type { DrinkSettings } from "./drink-settings";
import { resolveCurrentWeightKg } from "./body-weight";
import { resolveBookingsForUser } from "./bookings";
import { computeRollingTrainingLoad, trainingLoadForLog } from "./recovery";
import { exertionFromDayLoad, goalBiasFromPrimaryGoal, type Exertion, type WeightGoalBias } from "./nutrition";
import { recommendFoods, type FoodRecommendations } from "./nutrition-recommendations";
import { ALLERGEN_OPTIONS, DIETARY_PREFERENCE_OPTIONS, INTOLERANCE_OPTIONS } from "./profile-options";
import { isAiConfigured } from "./ai";
import type { PrimaryGoal } from "./profile-schema";

const DIET_LABEL = new Map<string, string>(
  [...ALLERGEN_OPTIONS, ...INTOLERANCE_OPTIONS].map((o) => [o.value, o.label])
);

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export interface NutritionAiMessageSummary {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface NutritionData {
  bodyWeightKg: number | null;
  goalBias: WeightGoalBias;
  primaryGoal: PrimaryGoal;
  yesterdayExertion: Exertion;
  todayExertion: Exertion;
  readinessScore: number | null;
  sevenDayLoad: number;
  daysWithLoad: number;
  lastSessionTitle: string | null;
  lastSessionDate: string | null;
  foodRecommendations: FoodRecommendations;
  dietarySummary: { preferenceLabel: string; exclusions: string[] };
  aiNutritionCoachConfigured: boolean;
  initialAiNutritionMessages: NutritionAiMessageSummary[];
  nextSession: { title: string; date: string; category: string } | null;
  // Cross-device Sports Performance Drink calculator settings (see
  // lib/drink-settings.ts) — synced back via the existing
  // /api/profile/drink-settings endpoint. Null until the member has ever
  // used the calculator.
  drinkSettings: DrinkSettings | null;
}

// Shared by the web Nutrition page (app/(dashboard)/dashboard/nutrition/
// page.tsx) and the mobile JSON API (app/api/mobile/nutrition/route.ts).
// The sports-drink calculator's own state (sport/role/duration/bottle/
// sweat/temp) is client-managed on both platforms — this covers everything
// server-derived: exertion context, food recommendations, and AI coach
// grounding/history.
export function getNutritionData(userId: string | undefined): NutritionData | null {
  const user = userId ? findUserById(userId) : undefined;
  const profile = user ? findProfileByUserId(user.id) : undefined;
  if (!user || !profile) return null;

  const recoveryLogs = findRecoveryLogsByUserId(user.id);
  const sessions = findWorkoutSessionsByUserId(user.id);

  const todayISO = isoDaysAgo(0);
  const yesterdayISO = isoDaysAgo(1);

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

  const foodRecommendations = recommendFoods({
    dietaryPreference: profile.dietaryPreference,
    allergies: profile.allergies,
    intolerancesOrMedical: profile.intolerancesOrMedical,
  });
  const pref = profile.dietaryPreference ?? "standard";
  const preferenceLabel =
    pref === "standard" ? "Balanced" : DIETARY_PREFERENCE_OPTIONS.find((o) => o.value === pref)?.label ?? "Balanced";
  const dietarySummary = {
    preferenceLabel,
    exclusions: [...(profile.allergies ?? []), ...(profile.intolerancesOrMedical ?? [])].map(
      (k) => DIET_LABEL.get(k) ?? k
    ),
  };

  const nextBooking =
    resolveBookingsForUser(user.id)
      .filter((b) => !b.isPast)
      .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`))[0] ?? null;

  return {
    bodyWeightKg: resolveCurrentWeightKg(profile.currentWeightKg, findBodyWeightLogsByUserId(user.id)),
    goalBias: goalBiasFromPrimaryGoal(profile.primaryGoal),
    primaryGoal: profile.primaryGoal,
    yesterdayExertion,
    todayExertion,
    readinessScore: todayLog?.readinessScore ?? null,
    sevenDayLoad: rolling.sevenDaySum,
    daysWithLoad: rolling.daysWithLoad,
    lastSessionTitle: lastSession?.title ?? null,
    lastSessionDate: lastSession?.date ?? null,
    foodRecommendations,
    dietarySummary,
    aiNutritionCoachConfigured: isAiConfigured(),
    initialAiNutritionMessages: findAiMessagesByUserId(user.id, "nutrition").map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
    })),
    nextSession: nextBooking
      ? { title: nextBooking.title, date: nextBooking.date, category: nextBooking.category }
      : null,
    drinkSettings: profile.drinkSettings ?? null,
  };
}
