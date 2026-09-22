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
import {
  computeLeaderboard,
  filterSessionsByRange,
  LEADERBOARD_METRICS,
  LEADERBOARD_RANGES,
  type LeaderboardMemberInput,
  type LeaderboardMetric,
  type LeaderboardRange,
} from "@/lib/leaderboard";
import { verifyRequestSession } from "@/lib/mobile-auth";

const MAX_ENTRIES = 100;

// GET /api/mobile/community/leaderboard?metric=volume|squat|bench|deadlift&range=week|month|year|all|custom&start=YYYY-MM-DD&end=YYYY-MM-DD
export async function GET(request: NextRequest) {
  const session = verifyRequestSession(request);
  if (!session) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  const me = findUserById(session.userId);
  if (!me) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const url = new URL(request.url);
  const metricParam = url.searchParams.get("metric");
  const metric = (LEADERBOARD_METRICS as string[]).includes(metricParam ?? "")
    ? (metricParam as LeaderboardMetric)
    : "volume";

  const rangeParam = url.searchParams.get("range");
  const range = (LEADERBOARD_RANGES as string[]).includes(rangeParam ?? "")
    ? (rangeParam as LeaderboardRange)
    : "all";
  const customStart = url.searchParams.get("start");
  const customEnd = url.searchParams.get("end");

  const members: LeaderboardMemberInput[] = findCommunityEligibleUsers()
    .filter((u) => !u.archivedAt)
    .map((u) => {
      const profile = findProfileByUserId(u.id);
      return {
        userId: u.id,
        fullName: profile?.fullName?.trim() || "Member",
        sessions: filterSessionsByRange(findWorkoutSessionsByUserId(u.id), range, customStart, customEnd),
        currentWeightKg: resolveCurrentWeightKg(profile?.currentWeightKg ?? null, findBodyWeightLogsByUserId(u.id)),
        privacy: findCommunityPrivacyByUserId(u.id),
      };
    });

  const entries = computeLeaderboard(metric, members).slice(0, MAX_ENTRIES);

  return NextResponse.json({ success: true, data: { metric, range, entries, myUserId: me.id } });
}
