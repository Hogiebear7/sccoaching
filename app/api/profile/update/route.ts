import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findProfileByUserId, findUserById, saveProfile } from "@/lib/db";
import {
  isFemaleGender,
  shouldShowSportPlayed,
  type Gender,
  type PrimaryGoal,
} from "@/lib/profile-schema";
import { GENDER_OPTIONS, PRIMARY_GOAL_OPTIONS } from "@/lib/profile-options";
import { verifySession } from "@/lib/session";

const GENDER_VALUES = GENDER_OPTIONS.map((option) => option.value);
const PRIMARY_GOAL_VALUES = PRIMARY_GOAL_OPTIONS.map((option) => option.value);

export async function POST(request: NextRequest) {
  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

  if (!userId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to update your profile." },
      { status: 401 }
    );
  }

  const user = findUserById(userId);

  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to update your profile." },
      { status: 401 }
    );
  }

  const existingProfile = findProfileByUserId(user.id);

  if (!existingProfile) {
    return NextResponse.json(
      { success: false, message: "No profile found for this account." },
      { status: 404 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const {
    fullName,
    phone,
    gender,
    primaryGoal,
    sportPlayed,
    currentWeightKg,
    additionalInfo,
  } = (body ?? {}) as Record<string, unknown>;

  if (typeof fullName !== "string" || !fullName.trim()) {
    return NextResponse.json(
      { success: false, message: "Full name is required." },
      { status: 400 }
    );
  }

  if (typeof phone !== "string" || !phone.trim()) {
    return NextResponse.json(
      { success: false, message: "Phone number is required." },
      { status: 400 }
    );
  }

  if (typeof gender !== "string" || !GENDER_VALUES.includes(gender as Gender)) {
    return NextResponse.json(
      { success: false, message: "A valid gender is required." },
      { status: 400 }
    );
  }

  if (typeof primaryGoal !== "string" || !PRIMARY_GOAL_VALUES.includes(primaryGoal as PrimaryGoal)) {
    return NextResponse.json(
      { success: false, message: "A valid primary goal is required." },
      { status: 400 }
    );
  }

  const genderValue = gender as Gender;
  const primaryGoalValue = primaryGoal as PrimaryGoal;
  const sportPlayedValue = typeof sportPlayed === "string" ? sportPlayed.trim() : "";

  if (shouldShowSportPlayed({ primaryGoal: primaryGoalValue }) && !sportPlayedValue) {
    return NextResponse.json(
      { success: false, message: "Sport played is required for a sports performance goal." },
      { status: 400 }
    );
  }

  const weightValue =
    typeof currentWeightKg === "string" && currentWeightKg.trim() !== ""
      ? Number(currentWeightKg)
      : null;

  const cycleEligible = isFemaleGender(genderValue);

  saveProfile({
    ...existingProfile,
    fullName: fullName.trim(),
    phone: phone.trim(),
    gender: genderValue,
    primaryGoal: primaryGoalValue,
    sportPlayed: sportPlayedValue || null,
    currentWeightKg: weightValue !== null && !Number.isNaN(weightValue) ? weightValue : null,
    additionalInfo: typeof additionalInfo === "string" && additionalInfo.trim() ? additionalInfo.trim() : null,
    cycleTrackingEligible: cycleEligible,
    cycleTrackingEnabled: cycleEligible ? existingProfile.cycleTrackingEnabled : false,
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json(
    { success: true, message: "Profile updated." },
    { status: 200 }
  );
}
