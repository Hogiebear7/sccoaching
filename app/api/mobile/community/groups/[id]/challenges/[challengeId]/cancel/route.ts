import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findGroupVisibleToMember, requireGroupAccess } from "@/lib/community-groups";
import { cancelChallenge, findChallengeById, findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// POST /api/mobile/community/groups/[id]/challenges/[challengeId]/cancel — organiser only. A canceled challenge stays visible as "canceled" and stops
// counting toward the group's open-challenge limit. Anyone else gets the same "not found".
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; challengeId: string }> }) {
  const { id, challengeId } = await params;
  const session = verifyRequestSession(request);
  const me = session ? findUserById(session.userId) : undefined;
  if (!me) return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  const gate = requireGroupAccess(me.id);
  if (gate) return gate;

  const group = findGroupVisibleToMember(me.id, id);
  const challenge = findChallengeById(challengeId);
  if (!group || group.organiserId !== me.id || !challenge || challenge.scopeType !== "group" || challenge.scopeId !== group.id) {
    return NextResponse.json({ success: false, message: "Challenge not found." }, { status: 404 });
  }
  if (challenge.canceledAt) {
    return NextResponse.json({ success: false, message: "That challenge is already canceled." }, { status: 409 });
  }

  cancelChallenge(challenge.id, new Date().toISOString());
  return NextResponse.json({ success: true, message: "Challenge canceled." });
}
