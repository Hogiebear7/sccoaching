import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findBodyWeightLogsByUserId,
  findCommunityEligibleUsers,
  findCommunityPrivacyByUserId,
  findFollowingIds,
  findProfileByUserId,
  findUserById,
  findWorkoutSessionsByUserId,
} from "@/lib/db";
import { resolveCurrentWeightKg } from "@/lib/body-weight";
import { sameGym } from "@/lib/gym-scope";
import {
  computeLeaderboard,
  filterSessionsByRange,
  LEADERBOARD_METRICS,
  LEADERBOARD_RANGES,
  type LeaderboardMemberInput,
  type LeaderboardMetric,
  type LeaderboardRange,
} from "@/lib/leaderboard";
import { hiddenFromViewer } from "@/lib/community-moderation";
import { verifyRequestSession } from "@/lib/mobile-auth";

const MAX_ENTRIES = 100;

// GET /api/mobile/community/leaderboard?metric=volume|squat|bench|deadlift&range=week|month|year|all|custom&start=YYYY-MM-DD&end=YYYY-MM-DD&scope=auto|friends|global
//
// Free for every member (owner decision 2026-11-08). `scope` picks who is ranked:
//   friends - the people the member follows, plus the member
//   global  - everyone in the member's gym who has not switched the leaderboard off
//   auto    - (the default) friends if the member follows anyone who can be shown, otherwise global
// The answer says which one was used (`scope`) and how many followed members could be shown (`followingCount`), so the app can offer the switch.
// Followed members who are blocked either way, in another gym, archived or not Community-eligible never count.
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
  const scopeParam = url.searchParams.get("scope");

  // Defense-in-depth: the eligible pool is scoped to the caller's own gym
  // server-side, not left to whatever the caller's own request implies.
  const hidden = hiddenFromViewer(me.id);
  const pool = findCommunityEligibleUsers().filter((u) => !u.archivedAt && sameGym(me, u) && !hidden.has(u.id));

  const following = new Set(findFollowingIds(me.id));
  const followingCount = pool.filter((u) => u.id !== me.id && following.has(u.id)).length;
  const scope: "friends" | "global" =
    scopeParam === "friends" ? "friends" : scopeParam === "global" ? "global" : followingCount > 0 ? "friends" : "global";
  const ranked = scope === "friends" ? pool.filter((u) => u.id === me.id || following.has(u.id)) : pool;

  const members: LeaderboardMemberInput[] = ranked.map((u) => {
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

  return NextResponse.json({ success: true, data: { metric, range, scope, followingCount, entries, myUserId: me.id } });
}
