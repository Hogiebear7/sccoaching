import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findCommunityPrivacyByUserId, findUserById, saveCommunityPrivacy } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// POST /api/mobile/community/confirm-adult — { confirm: true }
// The member's own confirmation that they are 18 or over, required before groups and the gym community (owner decision 2026-11-08). Stored on the
// member's Community privacy record, so it goes with the account. Idempotent: confirming again keeps the first date.
export async function POST(request: NextRequest) {
  const session = verifyRequestSession(request);
  const me = session ? findUserById(session.userId) : undefined;
  if (!me) return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }
  if ((body as { confirm?: unknown } | null)?.confirm !== true) {
    return NextResponse.json({ success: false, message: "Confirm that you are 18 or over to continue." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const existing = findCommunityPrivacyByUserId(me.id);
  saveCommunityPrivacy({
    userId: me.id,
    discoverable: existing?.discoverable ?? true,
    leaderboardVisible: existing?.leaderboardVisible ?? true,
    showRealName: existing?.showRealName ?? true,
    communityOptIn: existing?.communityOptIn ?? false,
    adultConfirmedAt: existing?.adultConfirmedAt ?? now,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  return NextResponse.json({ success: true, message: "Confirmed." });
}
