import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findProfileByUserId,
  findUserById,
  saveProfile,
  updateUserEmail,
} from "@/lib/db";
import {
  isFemaleGender,
  shouldShowSportPlayed,
  type Gender,
  type PrimaryGoal,
} from "@/lib/profile-schema";
import { GENDER_OPTIONS, PRIMARY_GOAL_OPTIONS } from "@/lib/profile-options";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";

const GENDER_VALUES = GENDER_OPTIONS.map((option) => option.value);
const PRIMARY_GOAL_VALUES = PRIMARY_GOAL_OPTIONS.map((option) => option.value);

export async function POST(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage members." },
      { status: 401 }
    );
  }

  const staffUser = findUserById(sessionUserId);

  if (!staffUser) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage members." },
      { status: 401 }
    );
  }

  if (!can(staffUser.role, "members.edit")) {
    return NextResponse.json(
      { success: false, message: "Only staff can manage members." },
      { status: 403 }
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
    userId,
    email: newEmail,
    fullName,
    phone,
    gender,
    primaryGoal,
    sportPlayed,
    currentWeightKg,
    heightCm,
    additionalInfo,
    emergencyContactName,
    emergencyContactPhone,
    emergencyContact2Name,
    emergencyContact2Phone,
    programmeEnabled,
  } = (body ?? {}) as Record<string, unknown>;

  if (typeof userId !== "string" || !userId.trim()) {
    return NextResponse.json(
      { success: false, message: "A member is required." },
      { status: 400 }
    );
  }

  const targetUser = findUserById(userId);

  if (!targetUser) {
    return NextResponse.json(
      { success: false, message: "Member not found." },
      { status: 404 }
    );
  }

  const existingProfile = findProfileByUserId(userId);

  if (!existingProfile) {
    return NextResponse.json(
      { success: false, message: "No profile found for this member." },
      { status: 404 }
    );
  }

  if (typeof newEmail !== "string" || !newEmail.trim()) {
    return NextResponse.json(
      { success: false, message: "Email is required." },
      { status: 400 }
    );
  }

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

  if (
    typeof primaryGoal !== "string" ||
    !PRIMARY_GOAL_VALUES.includes(primaryGoal as PrimaryGoal)
  ) {
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

  const trimmedEmail = newEmail.trim();

  if (trimmedEmail.toLowerCase() !== targetUser.email.toLowerCase()) {
    // Changing the login email is an account-security action — admin+ only.
    // A coach may still save every other (coaching) field on this form.
    if (!can(staffUser.role, "members.account")) {
      return NextResponse.json(
        { success: false, message: "Only an admin can change a member's email address." },
        { status: 403 }
      );
    }

    const emailUpdated = updateUserEmail(userId, trimmedEmail);

    if (!emailUpdated) {
      return NextResponse.json(
        { success: false, message: "Email is already in use by another account." },
        { status: 400 }
      );
    }
  }

  const weightValue =
    typeof currentWeightKg === "string" && currentWeightKg.trim() !== ""
      ? Number(currentWeightKg)
      : null;

  const heightValue =
    typeof heightCm === "string" && heightCm.trim() !== "" ? Number(heightCm) : null;

  const cycleEligible = isFemaleGender(genderValue);

  saveProfile({
    ...existingProfile,
    email: trimmedEmail,
    fullName: fullName.trim(),
    phone: phone.trim(),
    gender: genderValue,
    primaryGoal: primaryGoalValue,
    sportPlayed: sportPlayedValue || null,
    currentWeightKg: weightValue !== null && !Number.isNaN(weightValue) ? weightValue : null,
    heightCm: heightValue !== null && !Number.isNaN(heightValue) && heightValue > 0 ? heightValue : null,
    additionalInfo:
      typeof additionalInfo === "string" && additionalInfo.trim() ? additionalInfo.trim() : null,
    emergencyContactName:
      typeof emergencyContactName === "string" && emergencyContactName.trim()
        ? emergencyContactName.trim()
        : null,
    emergencyContactPhone:
      typeof emergencyContactPhone === "string" && emergencyContactPhone.trim()
        ? emergencyContactPhone.trim()
        : null,
    emergencyContact2Name:
      typeof emergencyContact2Name === "string" && emergencyContact2Name.trim()
        ? emergencyContact2Name.trim()
        : null,
    emergencyContact2Phone:
      typeof emergencyContact2Phone === "string" && emergencyContact2Phone.trim()
        ? emergencyContact2Phone.trim()
        : null,
    programmeEnabled: programmeEnabled === true,
    cycleTrackingEligible: cycleEligible,
    cycleTrackingEnabled: cycleEligible ? existingProfile.cycleTrackingEnabled : false,
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json(
    { success: true, message: "Member updated." },
    { status: 200 }
  );
}
