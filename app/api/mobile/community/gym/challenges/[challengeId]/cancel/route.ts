import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { gymCommunityAccess, gymScopeId } from "@/lib/community-gym";
import { cancelChallenge, findChallengeById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// POST /api/mobile/community/gym/challenges/[challengeId]/cancel — the coach who set it, or any admin of the gym. Members, other gyms' staff and a challenge
// from another gym all get the same "not found".
export async function POST(request: NextRequest, { params }: { params: Promise<{ challengeId: string }> }) {
  const { challengeId } = await params;
  const access = gymCommunityAccess(verifyRequestSession(request)?.userId);
  if (!access.ok) return access.response;

  const challenge = findChallengeById(challengeId);
  const allowed = access.isStaff && (challenge?.createdBy === access.user.id || access.user.role === "admin" || access.user.role === "admin_manager");
  if (!challenge || challenge.scopeType !== "gym" || challenge.scopeId !== gymScopeId(access.gymId) || !allowed) {
    return NextResponse.json({ success: false, message: "Challenge not found." }, { status: 404 });
  }
  if (challenge.canceledAt) {
    return NextResponse.json({ success: false, message: "That challenge is already canceled." }, { status: 409 });
  }

  cancelChallenge(challenge.id, new Date().toISOString());
  return NextResponse.json({ success: true, message: "Challenge canceled." });
}
