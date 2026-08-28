import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { computeGoalTimeline, type GoalTimelineResult } from "@/lib/body-composition-goal";
import { resolveCurrentBodyFatPct } from "@/lib/body-fat";
import { resolveCurrentWeightKg } from "@/lib/body-weight";
import { findBodyFatLogsByUserId, findBodyWeightLogsByUserId, findProfileByUserId, findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import type { WeightPoint } from "@/lib/nutrition-target";

export interface GoalTimelineResponseData {
  goalWeightKg: number | null;
  goalBodyFatPct: number | null;
  goalTargetDate: string | null;
  trainingDaysPerWeek: number | null;
  currentWeightKg: number | null;
  currentBodyFatPct: number | null;
  /** Null when no goalWeightKg is set. */
  weightTimeline: GoalTimelineResult | null;
  /** Null when no goalBodyFatPct is set. */
  bodyFatTimeline: GoalTimelineResult | null;
}

// Read-only projection for the goal-timeline card on Profile — mirrors the
// same computeGoalTimeline call the orchestration layer (nutrition-target-
// data.ts) makes to derive the actual calorie adjustment, so what the
// member sees here always matches what's driving their target.
export async function GET(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  const profile = user ? findProfileByUserId(user.id) : undefined;

  if (!user || !profile) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const weightLogs = findBodyWeightLogsByUserId(user.id);
  const bodyFatLogs = findBodyFatLogsByUserId(user.id);
  const currentWeightKg = resolveCurrentWeightKg(profile.currentWeightKg, weightLogs);
  const currentBodyFatPct = resolveCurrentBodyFatPct(profile.bodyFatPct, bodyFatLogs);
  const todayISO = new Date().toISOString().slice(0, 10);

  const weightPoints: WeightPoint[] = weightLogs.map((l) => ({ date: l.date, weightKg: l.weightKg }));
  const bodyFatPoints: WeightPoint[] = bodyFatLogs.map((l) => ({ date: l.date, weightKg: l.bodyFatPct }));

  const weightTimeline =
    profile.goalWeightKg != null && currentWeightKg !== null
      ? computeGoalTimeline({
          currentValue: currentWeightKg,
          goalValue: profile.goalWeightKg,
          targetDateISO: profile.goalTargetDate ?? null,
          asOfDateISO: todayISO,
          history: weightPoints,
          trainingDaysPerWeek: profile.trainingDaysPerWeek ?? null,
        })
      : null;

  const bodyFatTimeline =
    profile.goalBodyFatPct != null && currentBodyFatPct !== null
      ? computeGoalTimeline({
          currentValue: currentBodyFatPct,
          goalValue: profile.goalBodyFatPct,
          targetDateISO: profile.goalTargetDate ?? null,
          asOfDateISO: todayISO,
          history: bodyFatPoints,
          trainingDaysPerWeek: profile.trainingDaysPerWeek ?? null,
        })
      : null;

  const data: GoalTimelineResponseData = {
    goalWeightKg: profile.goalWeightKg ?? null,
    goalBodyFatPct: profile.goalBodyFatPct ?? null,
    goalTargetDate: profile.goalTargetDate ?? null,
    trainingDaysPerWeek: profile.trainingDaysPerWeek ?? null,
    currentWeightKg,
    currentBodyFatPct,
    weightTimeline,
    bodyFatTimeline,
  };

  return NextResponse.json({ success: true, data });
}
