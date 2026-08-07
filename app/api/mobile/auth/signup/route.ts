import { NextResponse } from "next/server";

import { createUser, findUserByEmail, saveProfile } from "@/lib/db";
import { hashPassword, validatePasswordStrength } from "@/lib/password";
import { signSession } from "@/lib/session";
import {
  isFemaleGender,
  shouldShowSportPlayed,
  type Gender,
  type PrimaryGoal,
  type ProfileRecord,
} from "@/lib/profile-schema";
import { GENDER_OPTIONS, PRIMARY_GOAL_OPTIONS, sanitizeDietaryFields } from "@/lib/profile-options";
import { DEFAULT_PALETTE, DEFAULT_THEME } from "@/lib/palettes";

const GENDER_VALUES = GENDER_OPTIONS.map((option) => option.value);
const PRIMARY_GOAL_VALUES = PRIMARY_GOAL_OPTIONS.map((option) => option.value);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Condensed mobile signup: exactly the fields ProfileRecord requires
// (see app/api/auth/signup/route.ts for the full web wizard). Everything
// the web wizard additionally collects (dietary, cycle tracking, palette/
// theme, additional info, current weight) gets the same safe defaults
// unconfigured web signups would get, and stays fully editable afterwards
// from Settings — nothing here is a one-way door.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { email, password, fullName, phone, dateOfBirth, gender, primaryGoal, sportPlayed } =
    (body ?? {}) as Record<string, unknown>;

  if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password.trim()) {
    return NextResponse.json({ success: false, message: "Email and password are required." }, { status: 400 });
  }
  if (!EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ success: false, message: "A valid email is required." }, { status: 400 });
  }

  const passwordError = validatePasswordStrength(password);
  if (passwordError) {
    return NextResponse.json({ success: false, message: passwordError }, { status: 400 });
  }

  if (typeof fullName !== "string" || !fullName.trim()) {
    return NextResponse.json({ success: false, message: "Full name is required." }, { status: 400 });
  }
  if (typeof phone !== "string" || !phone.trim()) {
    return NextResponse.json({ success: false, message: "Phone number is required." }, { status: 400 });
  }
  if (typeof gender !== "string" || !GENDER_VALUES.includes(gender as Gender)) {
    return NextResponse.json({ success: false, message: "A valid gender is required." }, { status: 400 });
  }
  if (typeof primaryGoal !== "string" || !PRIMARY_GOAL_VALUES.includes(primaryGoal as PrimaryGoal)) {
    return NextResponse.json({ success: false, message: "A valid primary goal is required." }, { status: 400 });
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
    return NextResponse.json({ success: false, message: "Unable to create account." }, { status: 400 });
  }

  const todayISO = new Date().toISOString().slice(0, 10);
  const dobRaw = typeof dateOfBirth === "string" ? dateOfBirth.trim() : "";
  if (!dobRaw) {
    return NextResponse.json({ success: false, message: "Date of birth is required." }, { status: 400 });
  }
  if (!ISO_DATE_RE.test(dobRaw) || Number.isNaN(new Date(dobRaw).getTime()) || dobRaw >= todayISO) {
    return NextResponse.json(
      { success: false, message: "Date of birth must be a valid date in the past." },
      { status: 400 }
    );
  }

  const passwordHash = hashPassword(password);
  const user = createUser(email, passwordHash);
  const cycleEligible = isFemaleGender(genderValue);
  const now = new Date().toISOString();
  const dietary = sanitizeDietaryFields({});

  const profile: ProfileRecord = {
    userId: user.id,
    fullName: fullName.trim(),
    email: user.email,
    phone: phone.trim(),
    dateOfBirth: dobRaw,
    gender: genderValue,
    primaryGoal: primaryGoalValue,
    sportPlayed: sportPlayedValue || null,
    currentWeightKg: null,
    additionalInfo: null,
    dietaryPreference: dietary.dietaryPreference,
    allergies: dietary.allergies,
    intolerancesOrMedical: dietary.intolerancesOrMedical,
    dietaryNotes: dietary.dietaryNotes,
    palette: DEFAULT_PALETTE,
    theme: DEFAULT_THEME,
    cycleTrackingEligible: cycleEligible,
    cycleTrackingEnabled: false,
    menopauseSupportEnabled: false,
    reminderTimingsMins: null,
    emailNotificationsEnabled: true,
    pushNotificationsEnabled: false,
    onboardingCompleted: true,
    dashboardTourCompleted: false,
    createdAt: now,
    updatedAt: now,
  };

  saveProfile(profile);

  const token = signSession({ userId: user.id });

  return NextResponse.json(
    {
      success: true,
      token,
      user: { id: user.id, email: user.email, role: user.role },
    },
    { status: 201 }
  );
}
