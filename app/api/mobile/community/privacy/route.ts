import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findCommunityPrivacyByUserId, findUserById, saveCommunityPrivacy } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// GET/POST /api/mobile/community/privacy
// A missing record reads as visible/real-name (confirmed default with the
// member) — GET synthesizes that default rather than requiring a record to
// exist first.
export async function GET(request: NextRequest) {
  const session = verifyRequestSession(request);
  if (!session) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const prefs = findCommunityPrivacyByUserId(session.userId);
  return NextResponse.json({
    success: true,
    data: {
      leaderboardVisible: prefs?.leaderboardVisible ?? true,
      showRealName: prefs?.showRealName ?? true,
    },
  });
}

export async function POST(request: NextRequest) {
  const session = verifyRequestSession(request);
  if (!session) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  const me = findUserById(session.userId);
  if (!me) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { leaderboardVisible, showRealName } = (body ?? {}) as Record<string, unknown>;
  if (typeof leaderboardVisible !== "boolean" || typeof showRealName !== "boolean") {
    return NextResponse.json(
      { success: false, message: "leaderboardVisible and showRealName must be booleans." },
      { status: 400 }
    );
  }

  const existing = findCommunityPrivacyByUserId(me.id);
  const now = new Date().toISOString();
  saveCommunityPrivacy({
    userId: me.id,
    leaderboardVisible,
    showRealName,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  return NextResponse.json({ success: true, message: "Saved." });
}
