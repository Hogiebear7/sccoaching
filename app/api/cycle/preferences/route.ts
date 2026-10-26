import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findProfileByUserId, findUserById, saveProfile } from "@/lib/db";
import { isMenopauseStage } from "@/lib/menopause";
import { verifyRequestSession } from "@/lib/mobile-auth";

// Body: { menopauseSupportEnabled?, menopauseStage?, menopauseShareWithCoach? }.
// Only the fields sent change. Choosing a stage switches support on;
// switching support off clears the stage and sharing.
export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : null;

  if (!user) {
    return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  }

  const profile = findProfileByUserId(user.id);

  if (!profile) {
    return NextResponse.json({ success: false, message: "No profile found." }, { status: 404 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { menopauseSupportEnabled, menopauseStage, menopauseShareWithCoach } = (body ?? {}) as Record<string, unknown>;

  if (menopauseStage !== undefined && menopauseStage !== null && !isMenopauseStage(menopauseStage)) {
    return NextResponse.json({ success: false, message: "Choose perimenopause or post-menopause." }, { status: 400 });
  }

  const next = { ...profile, updatedAt: new Date().toISOString() };
  if (typeof menopauseSupportEnabled === "boolean") next.menopauseSupportEnabled = menopauseSupportEnabled;
  if (menopauseStage !== undefined) next.menopauseStage = menopauseStage;
  if (typeof menopauseShareWithCoach === "boolean") next.menopauseShareWithCoach = menopauseShareWithCoach;
  if (menopauseStage) next.menopauseSupportEnabled = true;
  if (!next.menopauseSupportEnabled) {
    next.menopauseStage = null;
    next.menopauseShareWithCoach = false;
  }

  saveProfile(next);

  return NextResponse.json({ success: true, message: "Preferences saved." });
}
