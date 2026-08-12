import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findProfileByUserId, findUserById, saveProfile } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import type { ProfileRecord } from "@/lib/profile-schema";

// Backfills a minimal member ProfileRecord for a staff/coach account so they
// can switch into the member app experience with a real (if mostly empty)
// profile, instead of the member screens crashing on a missing profile.
// Idempotent — a second call is a no-op that just confirms one exists.
export async function POST(request: NextRequest) {
  const session = verifyRequestSession(request);
  if (!session) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const existing = findProfileByUserId(session.userId);
  if (existing) {
    return NextResponse.json({ success: true, alreadyExisted: true });
  }

  const user = findUserById(session.userId);
  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const now = new Date().toISOString();
  const profile: ProfileRecord = {
    userId: user.id,
    fullName: user.email.split("@")[0],
    email: user.email,
    phone: "",
    dateOfBirth: null,
    gender: "Other",
    primaryGoal: "General Health",
    sportPlayed: null,
    currentWeightKg: null,
    additionalInfo: null,
    cycleTrackingEligible: false,
    cycleTrackingEnabled: false,
    menopauseSupportEnabled: false,
    reminderTimingsMins: null,
    emailNotificationsEnabled: true,
    pushNotificationsEnabled: true,
    onboardingCompleted: true,
    createdAt: now,
    updatedAt: now,
  };
  saveProfile(profile);

  return NextResponse.json({ success: true, alreadyExisted: false });
}
