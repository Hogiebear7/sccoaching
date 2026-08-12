import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findBodyWeightLogsByUserId,
  findProfileByUserId,
  findUserById,
  saveProfile,
} from "@/lib/db";
import { resolveCurrentWeightKg } from "@/lib/body-weight";
import {
  isFemaleGender,
  shouldShowSportPlayed,
  type Gender,
  type PrimaryGoal,
} from "@/lib/profile-schema";
import { GENDER_OPTIONS, PRIMARY_GOAL_OPTIONS, sanitizeDietaryFields } from "@/lib/profile-options";
import { verifyRequestSession } from "@/lib/mobile-auth";

const GENDER_VALUES = GENDER_OPTIONS.map((option) => option.value);
const PRIMARY_GOAL_VALUES = PRIMARY_GOAL_OPTIONS.map((option) => option.value);

export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;

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
    dateOfBirth,
    gender,
    primaryGoal,
    sportPlayed,
    additionalInfo,
    emergencyContactName,
    emergencyContactPhone,
    emergencyContact2Name,
    emergencyContact2Phone,
    dietaryPreference,
    allergies,
    intolerancesOrMedical,
    dietaryNotes,
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

  // Date of birth is required: a valid YYYY-MM-DD date in the past.
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const todayISO = new Date().toISOString().slice(0, 10);
  const dobRaw = typeof dateOfBirth === "string" ? dateOfBirth.trim() : "";

  if (!dobRaw) {
    return NextResponse.json(
      { success: false, message: "Date of birth is required." },
      { status: 400 }
    );
  }

  if (
    !ISO_DATE_RE.test(dobRaw) ||
    Number.isNaN(new Date(dobRaw).getTime()) ||
    dobRaw >= todayISO
  ) {
    return NextResponse.json(
      { success: false, message: "Date of birth must be a valid date in the past." },
      { status: 400 }
    );
  }

  // Current weight is read-only after signup: the latest body-weight log is
  // the single source of truth, and this route deliberately ignores any
  // submitted weight. Changing weight requires logging a new entry.
  const syncedWeight = resolveCurrentWeightKg(
    existingProfile.currentWeightKg,
    findBodyWeightLogsByUserId(user.id)
  );

  const cycleEligible = isFemaleGender(genderValue);

  const dietary = sanitizeDietaryFields({
    dietaryPreference,
    allergies,
    intolerancesOrMedical,
    dietaryNotes,
  });

  saveProfile({
    ...existingProfile,
    fullName: fullName.trim(),
    phone: phone.trim(),
    dateOfBirth: dobRaw,
    gender: genderValue,
    primaryGoal: primaryGoalValue,
    sportPlayed: sportPlayedValue || null,
    currentWeightKg: syncedWeight,
    additionalInfo: typeof additionalInfo === "string" && additionalInfo.trim() ? additionalInfo.trim() : null,
    // Required at signup, but editing an existing profile shouldn't be
    // blocked on backfilling this — omitting it here just clears it back
    // to null rather than erroring, same treatment as sportPlayed/notes.
    emergencyContactName:
      typeof emergencyContactName === "string" && emergencyContactName.trim() ? emergencyContactName.trim() : null,
    emergencyContactPhone:
      typeof emergencyContactPhone === "string" && emergencyContactPhone.trim() ? emergencyContactPhone.trim() : null,
    emergencyContact2Name:
      typeof emergencyContact2Name === "string" && emergencyContact2Name.trim() ? emergencyContact2Name.trim() : null,
    emergencyContact2Phone:
      typeof emergencyContact2Phone === "string" && emergencyContact2Phone.trim() ? emergencyContact2Phone.trim() : null,
    dietaryPreference: dietary.dietaryPreference,
    allergies: dietary.allergies,
    intolerancesOrMedical: dietary.intolerancesOrMedical,
    dietaryNotes: dietary.dietaryNotes,
    cycleTrackingEligible: cycleEligible,
    cycleTrackingEnabled: cycleEligible ? existingProfile.cycleTrackingEnabled : false,
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json(
    { success: true, message: "Profile updated." },
    { status: 200 }
  );
}
