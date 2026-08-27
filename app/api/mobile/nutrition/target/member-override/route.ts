import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findBodyWeightLogsByUserId,
  findNutritionTargetByUserId,
  findProfileByUserId,
  findUserById,
  saveNutritionTarget,
  type NutritionTargetRecord,
} from "@/lib/db";
import { resolveCurrentWeightKg } from "@/lib/body-weight";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { validateMemberTargetOverride } from "@/lib/nutrition-target";
import { checkRateLimit } from "@/lib/rate-limit";

// A member applying a target the AI Nutrition Coach proposed in chat (see
// the "Apply this target" button in NutritionAiCoach.tsx / mobile's chat
// screen). Distinct from the staff route
// (app/api/mobile/staff/nutrition-target/update/route.ts) — no staff
// capability check, bounded instead by validateMemberTargetOverride so a
// member can't self-set something unsafe or wildly out of range.
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 60 * 1000;

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

export async function POST(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;
  const user = sessionUserId ? findUserById(sessionUserId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const rate = checkRateLimit(`nutrition-target-member-override:${user.id}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, message: "You're changing your target quickly — try again later." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSecs) } }
    );
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

  const { calories, proteinG, carbsG, fatG } = (body ?? {}) as Record<string, unknown>;
  const cals = positiveInt(calories);
  const protein = positiveInt(proteinG);
  const carbs = positiveInt(carbsG);
  const fat = positiveInt(fatG);

  if (cals === null || protein === null || carbs === null || fat === null) {
    return NextResponse.json({ success: false, message: "Calories and macros must be non-negative numbers." }, { status: 400 });
  }

  const bodyWeightKg = resolveCurrentWeightKg(profile.currentWeightKg, findBodyWeightLogsByUserId(user.id));
  if (bodyWeightKg === null) {
    return NextResponse.json(
      { success: false, message: "Log your weight first so this can be checked against a safe range for you." },
      { status: 400 }
    );
  }

  const check = validateMemberTargetOverride(bodyWeightKg, { calories: cals, proteinG: protein, carbsG: carbs, fatG: fat });
  if (!check.ok) {
    return NextResponse.json({ success: false, message: check.message }, { status: 400 });
  }

  const existing = findNutritionTargetByUserId(user.id);
  const now = new Date().toISOString();
  const target: NutritionTargetRecord = {
    id: existing?.id ?? randomUUID(),
    userId: user.id,
    mode: "manual",
    calories: cals,
    proteinG: protein,
    carbsG: carbs,
    fatG: fat,
    setByStaffId: user.id,
    notes: "Set by member via AI Nutrition Coach chat.",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  saveNutritionTarget(target);

  return NextResponse.json({ success: true, message: "Target updated.", data: target }, { status: 200 });
}
