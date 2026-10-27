import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findCyclePrivacyByUserId,
  findCycleSettingsByUserId,
  findProfileByUserId,
  findUserById,
} from "@/lib/db";
import { memberPhaseEstimateForViewer } from "@/lib/cycle-phase-data";
import { menopauseContentFor } from "@/lib/menopause";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { hasAccess } from "@/lib/member-access";
import { resolveMemberAccessForUser } from "@/lib/membership-entitlement";

// Read-only aggregation for the mobile Cycle Tracking screen — composes the
// same finders and the same estimatePhase() the web /dashboard/cycle page
// already uses, so the two surfaces can never show different guidance for
// the same data. Writes go through the existing /api/cycle/settings,
// /api/cycle/privacy, and /api/cycle/preferences routes (already
// Bearer-compatible via verifyRequestSession) — nothing new to write to.
export async function GET(request: NextRequest) {
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

  const settings = findCycleSettingsByUserId(user.id) ?? null;
  const privacy = findCyclePrivacyByUserId(user.id) ?? null;
  const phaseEstimate = memberPhaseEstimateForViewer(user.id, settings);
  // Phase-aware guidance is part of the App subscription; the apps show an upgrade note when this is set (see memberPhaseEstimateForViewer).
  const guidanceLocked = !hasAccess(resolveMemberAccessForUser(user.id), "cyclePhaseGuidance");

  return NextResponse.json({
    success: true,
    data: {
      enabled: profile.cycleTrackingEnabled,
      menopauseSupportEnabled: profile.menopauseSupportEnabled,
      menopauseStage: profile.menopauseStage ?? null,
      menopauseShareWithCoach: profile.menopauseShareWithCoach ?? false,
      /** Stage advice with evidence labels (lib/menopause.ts), or null. */
      menopause: menopauseContentFor(profile.menopauseStage),
      settings,
      privacy,
      phaseEstimate,
      guidanceLocked,
    },
  });
}
