import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findBodyWeightLogsByUserId,
  findCommunityEligibleUsers,
  findCommunityPrivacyByUserId,
  findProfileByUserId,
  findUserById,
  findWorkoutSessionsByUserId,
} from "@/lib/db";
import { resolveCurrentWeightKg } from "@/lib/body-weight";
import { computeLeaderboard, LEADERBOARD_METRICS, type LeaderboardMemberInput, type LeaderboardMetric } from "@/lib/leaderboard";
import { verifyRequestSession } from "@/lib/mobile-auth";

const MAX_ENTRIES = 100;

// GET /api/mobile/community/leaderboard?metric=volume|squat|bench|deadlift
export async function GET(request: NextRequest) {
  const session = verifyRequestSession(request);
  if (!session) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  const me = findUserById(session.userId);
  if (!me) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const metricParam = new URL(request.url).searchParams.get("metric");
  const metric = (LEADERBOARD_METRICS as string[]).includes(metricParam ?? "")
    ? (metricParam as LeaderboardMetric)
    : "volume";

  const members: LeaderboardMemberInput[] = findCommunityEligibleUsers()
    .filter((u) => !u.archivedAt)
    .map((u) => {
      const profile = findProfileByUserId(u.id);
      return {
        userId: u.id,
        fullName: profile?.fullName?.trim() || "Member",
        sessions: findWorkoutSessionsByUserId(u.id),
        currentWeightKg: resolveCurrentWeightKg(profile?.currentWeightKg ?? null, findBodyWeightLogsByUserId(u.id)),
        privacy: findCommunityPrivacyByUserId(u.id),
      };
    });

  const entries = computeLeaderboard(metric, members).slice(0, MAX_ENTRIES);

  return NextResponse.json({ success: true, data: { metric, entries, myUserId: me.id } });
}
