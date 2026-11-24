import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { isProfileVisibility, isWhoCanFollow, profileVisibilityOf, whoCanFollowOf } from "@/lib/community-profile";
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
      discoverable: prefs?.discoverable ?? true,
      leaderboardVisible: prefs?.leaderboardVisible ?? true,
      showRealName: prefs?.showRealName ?? true,
      // Only meaningful for a staff account — absent/false for a member is
      // fine since this field is never read for them.
      communityOptIn: prefs?.communityOptIn ?? false,
      // Whether the member has confirmed they are 18 or over (needed for groups and the gym community).
      adultConfirmed: !!prefs?.adultConfirmedAt,
      // Who sees the detail on the profile card, and who may start following. Defaults: followers only, anyone may follow.
      profileVisibility: profileVisibilityOf(prefs),
      whoCanFollow: whoCanFollowOf(prefs),
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

  const { discoverable, leaderboardVisible, showRealName, communityOptIn, profileVisibility, whoCanFollow } = (body ?? {}) as Record<
    string,
    unknown
  >;
  if (
    typeof discoverable !== "boolean" ||
    typeof leaderboardVisible !== "boolean" ||
    typeof showRealName !== "boolean"
  ) {
    return NextResponse.json(
      { success: false, message: "discoverable, leaderboardVisible and showRealName must be booleans." },
      { status: 400 }
    );
  }
  // Optional and lenient (unlike the three above) — already-shipped mobile
  // clients don't send it yet, and it's only ever meaningful for staff.
  // Falls back to whatever was already stored, defaulting false.
  // The two profile settings are optional too (older app builds do not send them) but, when sent, must be valid values.
  if (profileVisibility !== undefined && !isProfileVisibility(profileVisibility)) {
    return NextResponse.json({ success: false, message: "profileVisibility must be followers, followers_gym or everyone." }, { status: 400 });
  }
  if (whoCanFollow !== undefined && !isWhoCanFollow(whoCanFollow)) {
    return NextResponse.json({ success: false, message: "whoCanFollow must be anyone, gym or nobody." }, { status: 400 });
  }
  const existing = findCommunityPrivacyByUserId(me.id);
  const resolvedCommunityOptIn = typeof communityOptIn === "boolean" ? communityOptIn : existing?.communityOptIn ?? false;

  const now = new Date().toISOString();
  saveCommunityPrivacy({
    userId: me.id,
    discoverable,
    leaderboardVisible,
    showRealName,
    communityOptIn: resolvedCommunityOptIn,
    // Saving privacy choices must never wipe the 18+ confirmation.
    adultConfirmedAt: existing?.adultConfirmedAt ?? null,
    profileVisibility: isProfileVisibility(profileVisibility) ? profileVisibility : profileVisibilityOf(existing),
    whoCanFollow: isWhoCanFollow(whoCanFollow) ? whoCanFollow : whoCanFollowOf(existing),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  return NextResponse.json({ success: true, message: "Saved." });
}
