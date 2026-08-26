import { NextResponse } from "next/server";

import { createUser, findUserByEmail, saveProfile, saveCycleSettings, saveCyclePrivacy } from "@/lib/db";
import { redeemInviteForUser } from "@/lib/invites";
import { hashPassword, validatePasswordStrength } from "@/lib/password";
import { signSession } from "@/lib/session";
import {
  isFemaleGender,
  shouldShowSportPlayed,
  type CyclePrivacyPreferencesRecord,
  type CycleRegularity,
  type CycleSettingsRecord,
  type Gender,
  type PrimaryGoal,
  type ProfileRecord,
} from "@/lib/profile-schema";
import { GENDER_OPTIONS, PRIMARY_GOAL_OPTIONS, sanitizeDietaryFields } from "@/lib/profile-options";
import { DEFAULT_PALETTE, DEFAULT_THEME, isPaletteId, isThemeId } from "@/lib/palettes";

const GENDER_VALUES = GENDER_OPTIONS.map((option) => option.value);
const PRIMARY_GOAL_VALUES = PRIMARY_GOAL_OPTIONS.map((option) => option.value);
// Matches the format check already used in app/api/contact/route.ts.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
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
    email,
    password,
    fullName,
    phone,
    dateOfBirth,
    gender,
    primaryGoal,
    sportPlayed,
    currentWeightKg,
    additionalInfo,
    emergencyContactName,
    emergencyContactPhone,
    emergencyContact2Name,
    emergencyContact2Phone,
    dietaryPreference,
    allergies,
    intolerancesOrMedical,
    dietaryNotes,
    palette,
    theme,
    cycleTrackingEnabled,
    menopauseSupportEnabled,
    lastPeriodStartDate,
    averageCycleLengthDays,
    periodLengthDays,
    regularity,
    privateNotes,
    shareCurrentPhaseWithCoach,
    shareExactDatesWithCoach,
    shareNotesWithCoach,
    inviteToken,
  } = (body ?? {}) as Record<string, unknown>;

  if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password.trim()) {
    return NextResponse.json(
      { success: false, message: "Email and password are required." },
      { status: 400 }
    );
  }

  if (!EMAIL_RE.test(email.trim())) {
    return NextResponse.json(
      { success: false, message: "A valid email is required." },
      { status: 400 }
    );
  }

  const passwordError = validatePasswordStrength(password);

  if (passwordError) {
    return NextResponse.json(
      { success: false, message: passwordError },
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

  if (typeof emergencyContactName !== "string" || !emergencyContactName.trim()) {
    return NextResponse.json(
      { success: false, message: "Emergency contact name is required." },
      { status: 400 }
    );
  }

  if (typeof emergencyContactPhone !== "string" || !emergencyContactPhone.trim()) {
    return NextResponse.json(
      { success: false, message: "Emergency contact phone number is required." },
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

  if (findUserByEmail(email)) {
    return NextResponse.json(
      { success: false, message: "Unable to create account." },
      { status: 400 }
    );
  }

  // Date of birth is required: a valid YYYY-MM-DD date in the past
  // (matches the profile-update rule).
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

  const dobValue = dobRaw;

  const weightValue =
    typeof currentWeightKg === "string" && currentWeightKg.trim() !== ""
      ? Number(currentWeightKg)
      : null;

  const passwordHash = hashPassword(password);
  const user = createUser(email, passwordHash);

  const cycleEligible = isFemaleGender(genderValue);
  const now = new Date().toISOString();

  const dietary = sanitizeDietaryFields({
    dietaryPreference,
    allergies,
    intolerancesOrMedical,
    dietaryNotes,
  });

  const profile: ProfileRecord = {
    userId: user.id,
    fullName: fullName.trim(),
    email: user.email,
    phone: phone.trim(),
    dateOfBirth: dobValue,
    gender: genderValue,
    primaryGoal: primaryGoalValue,
    sportPlayed: sportPlayedValue || null,
    currentWeightKg: weightValue !== null && !Number.isNaN(weightValue) ? weightValue : null,
    additionalInfo: typeof additionalInfo === "string" && additionalInfo.trim() ? additionalInfo.trim() : null,
    emergencyContactName: (emergencyContactName as string).trim(),
    emergencyContactPhone: (emergencyContactPhone as string).trim(),
    emergencyContact2Name:
      typeof emergencyContact2Name === "string" && emergencyContact2Name.trim() ? emergencyContact2Name.trim() : null,
    emergencyContact2Phone:
      typeof emergencyContact2Phone === "string" && emergencyContact2Phone.trim() ? emergencyContact2Phone.trim() : null,
    dietaryPreference: dietary.dietaryPreference,
    allergies: dietary.allergies,
    intolerancesOrMedical: dietary.intolerancesOrMedical,
    dietaryNotes: dietary.dietaryNotes,
    // Unknown values fall back to the defaults rather than erroring —
    // appearance is cosmetic and must never block account creation.
    palette: isPaletteId(palette) ? palette : DEFAULT_PALETTE,
    theme: isThemeId(theme) ? theme : DEFAULT_THEME,
    cycleTrackingEligible: cycleEligible,
    cycleTrackingEnabled: cycleEligible ? Boolean(cycleTrackingEnabled) : false,
    menopauseSupportEnabled: Boolean(menopauseSupportEnabled),
    reminderTimingsMins: null,
    emailNotificationsEnabled: true,
    pushNotificationsEnabled: false,
    onboardingCompleted: true,
    createdAt: now,
    updatedAt: now,
  };

  saveProfile(profile);

  if (cycleEligible && Boolean(cycleTrackingEnabled)) {
    const VALID_REGULARITIES = ["Regular", "Irregular", "Unsure"];
    const cycleSettings: CycleSettingsRecord = {
      userId: user.id,
      lastPeriodStartDate:
        typeof lastPeriodStartDate === "string" && lastPeriodStartDate.trim()
          ? lastPeriodStartDate.trim()
          : null,
      averageCycleLengthDays:
        typeof averageCycleLengthDays === "string" && averageCycleLengthDays.trim() !== ""
          ? Number(averageCycleLengthDays)
          : null,
      periodLengthDays:
        typeof periodLengthDays === "string" && periodLengthDays.trim() !== ""
          ? Number(periodLengthDays)
          : null,
      regularity:
        typeof regularity === "string" && VALID_REGULARITIES.includes(regularity)
          ? (regularity as CycleRegularity)
          : null,
      privateNotes:
        typeof privateNotes === "string" && privateNotes.trim() ? privateNotes.trim() : null,
      createdAt: now,
      updatedAt: now,
    };
    saveCycleSettings(cycleSettings);

    const cyclePrivacy: CyclePrivacyPreferencesRecord = {
      userId: user.id,
      shareCurrentPhaseWithCoach: Boolean(shareCurrentPhaseWithCoach),
      shareExactDatesWithCoach: Boolean(shareExactDatesWithCoach),
      shareNotesWithCoach: Boolean(shareNotesWithCoach),
      createdAt: now,
      updatedAt: now,
    };
    saveCyclePrivacy(cyclePrivacy);
  }

  // An invite is honor-system carried through signup: a mismatched/expired/
  // already-used token just means the account is created as Free (same as
  // signing up without a link) rather than blocking account creation.
  if (typeof inviteToken === "string" && inviteToken.trim()) {
    await redeemInviteForUser(inviteToken.trim(), user);
  }

  const response = NextResponse.json(
    { success: true, message: "Account created." },
    { status: 201 }
  );

  response.cookies.set("session", signSession({ userId: user.id }), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}
