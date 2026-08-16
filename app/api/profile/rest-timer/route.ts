import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findProfileByUserId, findUserById, saveProfile } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// Bounds match the rest-timer screen's own preset range (30s-5min) with a
// little headroom either side rather than locking to exactly those presets.
const MIN_SECONDS = 15;
const MAX_SECONDS = 600;

export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;

  if (!userId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const user = findUserById(userId);
  if (!user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const existingProfile = findProfileByUserId(user.id);
  if (!existingProfile) {
    return NextResponse.json({ error: "No profile found for this account." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { restTimerSeconds } = (body ?? {}) as Record<string, unknown>;

  if (
    typeof restTimerSeconds !== "number" ||
    !Number.isInteger(restTimerSeconds) ||
    restTimerSeconds < MIN_SECONDS ||
    restTimerSeconds > MAX_SECONDS
  ) {
    return NextResponse.json(
      { error: `restTimerSeconds must be an integer between ${MIN_SECONDS} and ${MAX_SECONDS}.` },
      { status: 400 }
    );
  }

  saveProfile({
    ...existingProfile,
    restTimerSeconds,
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json({ success: true });
}
