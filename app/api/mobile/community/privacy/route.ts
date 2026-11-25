import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { isLeaderboardAlias, isLeaderboardMode, LEADERBOARD_ALIASES, leaderboardAliasOf, leaderboardModeOf } from "@/lib/community-alias";
import { isProfileVisibility, isWhoCanFollow, profileVisibilityOf, whoCanFollowOf } from "@/lib/community-profile";
import { findCommunityPrivacyByUserId, findUserById, saveCommunityPrivacy } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { requireTenantAccess } from "@/lib/tenant-request";

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
      // How the member appears on leaderboards: named, alias (stays ranked under an alias) or hidden. The alias list is what they may pick from.
      leaderboardMode: leaderboardModeOf(prefs),
      leaderboardAlias: leaderboardAliasOf(prefs),
      leaderboardAliases: LEADERBOARD_ALIASES,
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

  const tenantLock = requireTenantAccess(me);
  if (tenantLock) return tenantLock;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { discoverable, leaderboardVisible, showRealName, communityOptIn, profileVisibility, whoCanFollow, leaderboardMode, leaderboardAlias } = (body ?? {}) as Record<
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
  if (leaderboardMode !== undefined && !isLeaderboardMode(leaderboardMode)) {
    return NextResponse.json({ success: false, message: "leaderboardMode must be named, alias or hidden." }, { status: 400 });
  }
  if (leaderboardAlias !== undefined && !isLeaderboardAlias(leaderboardAlias)) {
    return NextResponse.json({ success: false, message: "Pick an alias from the list." }, { status: 400 });
  }
  const existing = findCommunityPrivacyByUserId(me.id);
  // An older app only sends the on/off switch. If it changed, that wins; if it did not, the stored mode stands (so an old app saving something else
  // never turns an alias back into a name).
  const existingMode = leaderboardModeOf(existing);
  const resolvedMode = isLeaderboardMode(leaderboardMode)
    ? leaderboardMode
    : leaderboardVisible !== (existingMode !== "hidden")
      ? leaderboardVisible
        ? "named"
        : "hidden"
      : existingMode;
  const resolvedCommunityOptIn = typeof communityOptIn === "boolean" ? communityOptIn : existing?.communityOptIn ?? false;

  const now = new Date().toISOString();
  saveCommunityPrivacy({
    userId: me.id,
    discoverable,
    // Kept in step with the mode so anything still reading the old switch agrees (false only when fully hidden).
    leaderboardVisible: resolvedMode !== "hidden",
    showRealName,
    communityOptIn: resolvedCommunityOptIn,
    // Saving privacy choices must never wipe the 18+ confirmation.
    adultConfirmedAt: existing?.adultConfirmedAt ?? null,
    profileVisibility: isProfileVisibility(profileVisibility) ? profileVisibility : profileVisibilityOf(existing),
    whoCanFollow: isWhoCanFollow(whoCanFollow) ? whoCanFollow : whoCanFollowOf(existing),
    leaderboardMode: resolvedMode,
    leaderboardAlias: isLeaderboardAlias(leaderboardAlias) ? leaderboardAlias : leaderboardAliasOf(existing),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  return NextResponse.json({ success: true, message: "Saved." });
}
