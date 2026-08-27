import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findProfileByUserId, findUserById, saveProfile } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Member-editable weight/body-fat goal timeline — deliberately a small
// dedicated route (mirrors /api/profile/body-weight, /api/profile/body-fat)
// rather than folding into the big /api/profile/update form, since this is
// its own self-contained edit-in-place card, not part of the main profile
// form. Any of the three fields may be cleared by sending null.
export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;

  if (!userId) {
    return NextResponse.json({ success: false, message: "You must be signed in to set a goal." }, { status: 401 });
  }

  const user = findUserById(userId);
  const profile = user ? findProfileByUserId(user.id) : undefined;

  if (!user || !profile) {
    return NextResponse.json({ success: false, message: "No profile found for this account." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { goalWeightKg, goalBodyFatPct, goalTargetDate } = (body ?? {}) as Record<string, unknown>;

  let goalWeightKgValue: number | null = profile.goalWeightKg ?? null;
  if (goalWeightKg !== undefined) {
    if (goalWeightKg === null) {
      goalWeightKgValue = null;
    } else if (typeof goalWeightKg !== "number" || !Number.isFinite(goalWeightKg) || goalWeightKg <= 0) {
      return NextResponse.json({ success: false, message: "Goal weight must be a positive number." }, { status: 400 });
    } else {
      goalWeightKgValue = goalWeightKg;
    }
  }

  let goalBodyFatPctValue: number | null = profile.goalBodyFatPct ?? null;
  if (goalBodyFatPct !== undefined) {
    if (goalBodyFatPct === null) {
      goalBodyFatPctValue = null;
    } else if (typeof goalBodyFatPct !== "number" || !Number.isFinite(goalBodyFatPct) || goalBodyFatPct <= 0 || goalBodyFatPct > 75) {
      return NextResponse.json({ success: false, message: "Goal body fat must be a percentage between 0 and 75." }, { status: 400 });
    } else {
      goalBodyFatPctValue = goalBodyFatPct;
    }
  }

  let goalTargetDateValue: string | null = profile.goalTargetDate ?? null;
  if (goalTargetDate !== undefined) {
    if (goalTargetDate === null) {
      goalTargetDateValue = null;
    } else if (typeof goalTargetDate !== "string" || !ISO_DATE_RE.test(goalTargetDate)) {
      return NextResponse.json({ success: false, message: "Target date must be a valid YYYY-MM-DD string." }, { status: 400 });
    } else {
      goalTargetDateValue = goalTargetDate;
    }
  }

  if (goalWeightKgValue === null && goalBodyFatPctValue === null && goalTargetDateValue !== null) {
    return NextResponse.json(
      { success: false, message: "Set a goal weight or body-fat % before choosing a target date." },
      { status: 400 }
    );
  }

  saveProfile({
    ...profile,
    goalWeightKg: goalWeightKgValue,
    goalBodyFatPct: goalBodyFatPctValue,
    goalTargetDate: goalTargetDateValue,
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json({ success: true, message: "Goal updated." }, { status: 200 });
}
