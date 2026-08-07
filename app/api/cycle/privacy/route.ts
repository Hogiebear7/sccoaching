import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findCyclePrivacyByUserId,
  findProfileByUserId,
  findUserById,
  saveCyclePrivacy,
} from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import type { CyclePrivacyPreferencesRecord } from "@/lib/profile-schema";

export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : null;

  if (!user) {
    return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  }

  const profile = findProfileByUserId(user.id);

  if (!profile?.cycleTrackingEligible) {
    return NextResponse.json(
      { success: false, message: "Cycle tracking is not available for this account." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { shareCurrentPhaseWithCoach, shareExactDatesWithCoach, shareNotesWithCoach } =
    (body ?? {}) as Record<string, unknown>;

  const now = new Date().toISOString();
  const existing = findCyclePrivacyByUserId(user.id);

  const prefs: CyclePrivacyPreferencesRecord = {
    userId: user.id,
    shareCurrentPhaseWithCoach: Boolean(shareCurrentPhaseWithCoach),
    shareExactDatesWithCoach: Boolean(shareExactDatesWithCoach),
    shareNotesWithCoach: Boolean(shareNotesWithCoach),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  saveCyclePrivacy(prefs);

  return NextResponse.json({ success: true, message: "Sharing preferences saved." });
}
