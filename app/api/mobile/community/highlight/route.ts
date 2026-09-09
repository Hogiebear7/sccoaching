import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { resolveCurrentWeightKg } from "@/lib/body-weight";
import { communityDisplayName } from "@/lib/community-display-name";
import { findRecentWin } from "@/lib/community-highlight";
import {
  findBodyWeightLogsByUserId,
  findCommunityEligibleUsers,
  findCommunityPrivacyByUserId,
  findFollowingIds,
  findProfileByUserId,
  findUserById,
  findWorkoutSessionsByUserId,
} from "@/lib/db";
import { computeLeaderboard, type LeaderboardMemberInput } from "@/lib/leaderboard";
import { verifyRequestSession } from "@/lib/mobile-auth";

// GET /api/mobile/community/highlight
// The ONE thing the Home screen's compact Community module shows — never a
// list. Priority order: a recent win among people the member follows, then
// the member's own leaderboard position, then a quiet empty-state pointer.
// See lib/community-highlight.ts for why there's no "challenge"/"coach
// announcement" branch yet.
export async function GET(request: NextRequest) {
  const session = verifyRequestSession(request);
  if (!session) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  const me = findUserById(session.userId);
  if (!me) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const followingIds = findFollowingIds(me.id);
  if (followingIds.length > 0) {
    // No discoverable gating here — this only ever surfaces a member the
    // viewer already follows, which the discoverability policy grandfathers.
    // showRealName still applies, same as every other Community surface.
    const members = followingIds.map((id) => ({
      userId: id,
      fullName: communityDisplayName(
        findProfileByUserId(id)?.fullName?.trim() || "A member you follow",
        findCommunityPrivacyByUserId(id)
      ),
      allSessions: findWorkoutSessionsByUserId(id),
    }));

    const win = findRecentWin(members, new Date().toISOString().slice(0, 10));
    if (win) {
      return NextResponse.json({
        success: true,
        data: {
          type: "win",
          text: `${win.authorName} hit a new ${win.exerciseName} PB`,
          href: `/community/workout/${win.sessionId}`,
        },
      });
    }
  }

  // Fall back to the member's own Volume leaderboard position — still
  // "community," still motivating, still grounded in real data.
  const leaderboardMembers: LeaderboardMemberInput[] = findCommunityEligibleUsers()
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

  const entries = computeLeaderboard("volume", leaderboardMembers);
  const myRank = entries.findIndex((e) => e.userId === me.id);
  if (myRank !== -1) {
    return NextResponse.json({
      success: true,
      data: { type: "leaderboard", text: `You're #${myRank + 1} on the Volume leaderboard`, href: "/community?tab=leaderboard" },
    });
  }

  return NextResponse.json({
    success: true,
    data: { type: "empty", text: "See member wins and leaderboards", href: "/community" },
  });
}
