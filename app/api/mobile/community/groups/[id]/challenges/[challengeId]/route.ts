import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { challengeView, scoreChallenge, todayIso } from "@/lib/challenges";
import { findGroupVisibleToMember, requireGroupAccess } from "@/lib/community-groups";
import { hiddenFromViewer } from "@/lib/community-moderation";
import {
  findBodyWeightLogsByUserId,
  findChallengeById,
  findCommunityPrivacyByUserId,
  findGroupMembers,
  findProfileByUserId,
  findUserById,
  findWorkoutSessionsByUserId,
} from "@/lib/db";
import { resolveCurrentWeightKg } from "@/lib/body-weight";
import type { LeaderboardMemberInput } from "@/lib/leaderboard";
import { verifyRequestSession } from "@/lib/mobile-auth";

// GET /api/mobile/community/groups/[id]/challenges/[challengeId] — the challenge and its standings. Members of the group only; anyone else, a challenge
// from another group, or a closed group all give the same "not found". Ranked from each member's own logged workouts inside the challenge dates, with the
// leaderboard's rules: someone who switched the leaderboard off is left out (and told so via iAmHidden), names follow each person's real-name setting,
// members blocked either way with the viewer are left out, and nobody with nothing scored yet is listed.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; challengeId: string }> }) {
  const { id, challengeId } = await params;
  const session = verifyRequestSession(request);
  const me = session ? findUserById(session.userId) : undefined;
  if (!me) return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  const gate = requireGroupAccess(me.id);
  if (gate) return gate;

  const group = findGroupVisibleToMember(me.id, id);
  const challenge = findChallengeById(challengeId);
  if (!group || !challenge || challenge.scopeType !== "group" || challenge.scopeId !== group.id) {
    return NextResponse.json({ success: false, message: "Challenge not found." }, { status: 404 });
  }

  const hidden = hiddenFromViewer(me.id);
  const members: LeaderboardMemberInput[] = findGroupMembers(group.id)
    .filter((m) => m.userId === me.id || !hidden.has(m.userId))
    .flatMap((m) => {
      const user = findUserById(m.userId);
      if (!user || user.archivedAt) return [];
      const profile = findProfileByUserId(user.id);
      return [
        {
          userId: user.id,
          fullName: profile?.fullName?.trim() || "Member",
          sessions: findWorkoutSessionsByUserId(user.id),
          currentWeightKg: resolveCurrentWeightKg(profile?.currentWeightKg ?? null, findBodyWeightLogsByUserId(user.id)),
          privacy: findCommunityPrivacyByUserId(user.id),
        },
      ];
    });

  return NextResponse.json({
    success: true,
    data: {
      challenge: challengeView(challenge, todayIso()),
      entries: scoreChallenge(challenge.metric, members, challenge.startDate, challenge.endDate),
      myUserId: me.id,
      iAmHidden: findCommunityPrivacyByUserId(me.id)?.leaderboardVisible === false,
    },
  });
}
