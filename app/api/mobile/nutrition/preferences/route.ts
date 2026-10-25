import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findNutritionTargetByUserId, findProfileByUserId, findUserById, saveProfile } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { PACE_OPTIONS } from "@/lib/nutrition-target";
import type { CalorieDistribution } from "@/lib/profile-schema";

const DISTRIBUTIONS: CalorieDistribution[] = ["even", "training"];
const PACES: number[] = [0, ...PACE_OPTIONS.lose, ...PACE_OPTIONS.gain];

function preferencesFor(userId: string) {
  const profile = findProfileByUserId(userId);
  const coach = findNutritionTargetByUserId(userId);
  return {
    calorieDistribution: profile?.calorieDistribution ?? null,
    goalPacePctPerWeek: profile?.goalPacePctPerWeek ?? null,
    coachDistribution: coach?.distribution ?? null,
    distributionLocked: Boolean(coach?.distributionLocked && coach.distribution),
  };
}

// The member's own nutrition-target preferences: how their weekly calories
// are spread, and their weekly pace. Self-owned only — the session user is
// the owner. A coach lock (NutritionTargetRecord.distributionLocked) blocks
// distribution changes; pace is always the member's call.
export async function GET(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  if (!findProfileByUserId(user.id)) {
    return NextResponse.json({ success: false, message: "No profile found for this account." }, { status: 404 });
  }
  return NextResponse.json({ success: true, data: preferencesFor(user.id) });
}

export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  const profile = findProfileByUserId(user.id);
  if (!profile) {
    return NextResponse.json({ success: false, message: "No profile found for this account." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }
  const { calorieDistribution, goalPacePctPerWeek } = (body ?? {}) as Record<string, unknown>;

  let distribution = profile.calorieDistribution ?? null;
  if (calorieDistribution !== undefined) {
    if (calorieDistribution !== null && !DISTRIBUTIONS.includes(calorieDistribution as CalorieDistribution)) {
      return NextResponse.json({ success: false, message: "calorieDistribution must be even, training or null." }, { status: 400 });
    }
    if (preferencesFor(user.id).distributionLocked) {
      return NextResponse.json(
        { success: false, message: "Your coach has set how your calories are spread, so it can't be changed here." },
        { status: 403 }
      );
    }
    distribution = calorieDistribution as CalorieDistribution | null;
  }

  let pace = profile.goalPacePctPerWeek ?? null;
  if (goalPacePctPerWeek !== undefined) {
    if (goalPacePctPerWeek !== null && (typeof goalPacePctPerWeek !== "number" || !PACES.includes(goalPacePctPerWeek))) {
      return NextResponse.json({ success: false, message: "That pace isn't one of the options." }, { status: 400 });
    }
    pace = goalPacePctPerWeek as number | null;
  }

  saveProfile({ ...profile, calorieDistribution: distribution, goalPacePctPerWeek: pace });

  return NextResponse.json({ success: true, message: "Preferences saved.", data: preferencesFor(user.id) });
}
