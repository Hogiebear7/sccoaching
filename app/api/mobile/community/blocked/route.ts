import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { communityDisplayName } from "@/lib/community-display-name";
import { findCommunityPrivacyByUserId, findProfileByUserId, findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// GET /api/mobile/community/blocked
// The caller's OWN block list with display names (honouring each member's showRealName choice), so they can review and unblock. Never includes the
// people who blocked the caller.
export async function GET(request: NextRequest) {
  const session = verifyRequestSession(request);
  const me = session ? findUserById(session.userId) : undefined;
  if (!me) return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });

  const blocked = (findProfileByUserId(me.id)?.blockedUserIds ?? []).map((userId) => ({
    userId,
    name: communityDisplayName(findProfileByUserId(userId)?.fullName?.trim() || "Member", findCommunityPrivacyByUserId(userId)),
  }));
  return NextResponse.json({ success: true, data: { blocked } });
}
