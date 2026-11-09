import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { challengeView, scoreChallenge, todayIso } from "@/lib/challenges";
import { gymCommunityAccess, gymScopeId, sameGymId } from "@/lib/community-gym";
import { hiddenFromViewer } from "@/lib/community-moderation";
import {
  findBodyWeightLogsByUserId,
  findChallengeById,
  findCommunityPrivacyByUserId,
  findMembers,
  findProfileByUserId,
  findWorkoutSessionsByUserId,
} from "@/lib/db";
import { resolveCurrentWeightKg } from "@/lib/body-weight";
import type { LeaderboardMemberInput } from "@/lib/leaderboard";
import { resolveMemberAccessForUser } from "@/lib/membership-entitlement";
import { verifyRequestSession } from "@/lib/mobile-auth";

// GET /api/mobile/community/gym/challenges/[challengeId] — the challenge and its standings. Ranked are your gym's members with a live gym Membership, scored
// from their own logged workouts inside the dates, with the leaderboard's privacy rules (opt-out left out and flagged via iAmHidden, real-name setting,
// blocks hidden). Staff see the same standings but are not ranked. A challenge from another gym reads as "not found".
export async function GET(request: NextRequest, { params }: { params: Promise<{ challengeId: string }> }) {
  const { challengeId } = await params;
  const access = gymCommunityAccess(verifyRequestSession(request)?.userId);
  if (!access.ok) return access.response;

  const challenge = findChallengeById(challengeId);
  if (!challenge || challenge.scopeType !== "gym" || challenge.scopeId !== gymScopeId(access.gymId)) {
    return NextResponse.json({ success: false, message: "Challenge not found." }, { status: 404 });
  }

  const hidden = hiddenFromViewer(access.user.id);
  const members: LeaderboardMemberInput[] = findMembers()
    .filter((u) => !u.archivedAt && sameGymId(u.gymId, access.gymId) && (u.id === access.user.id || !hidden.has(u.id)))
    .filter((u) => resolveMemberAccessForUser(u.id).gymMembership)
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

  return NextResponse.json({
    success: true,
    data: {
      challenge: challengeView(challenge, todayIso()),
      entries: scoreChallenge(challenge.metric, members, challenge.startDate, challenge.endDate),
      myUserId: access.user.id,
      iAmHidden: !access.isStaff && findCommunityPrivacyByUserId(access.user.id)?.leaderboardVisible === false,
    },
  });
}
