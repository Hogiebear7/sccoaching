import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { communityDisplayName, isDiscoverable } from "@/lib/community-display-name";
import { findCommunityPrivacyByUserId, findMembers, findProfileByUserId, findUserById, isFollowing } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

const MAX_RESULTS = 20;
const MAX_SUGGESTIONS = 5;

// GET /api/mobile/community/search?q=
// Member-facing "find someone to follow" search — the only member-facing
// user search in the app today; the existing member list/search
// (getStaffMembersData, app/api/staff/members) is staff-only and returns
// coaching/billing fields that must never reach a peer member, so this is
// a deliberately minimal, purpose-built query rather than a reuse of that.
export async function GET(request: NextRequest) {
  const session = verifyRequestSession(request);
  if (!session) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  const me = findUserById(session.userId);
  if (!me) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();

  // Blank query: the search sheet itself asks for nothing back (a member
  // hasn't typed anything to search for yet). The Community screen's empty
  // Activity state asks for a small set of members to follow instead — a
  // few real people, not a "find people" void — via `suggested=1`.
  if (!q) {
    if (url.searchParams.get("suggested") !== "1") {
      return NextResponse.json({ success: true, data: { results: [] } });
    }

    const results = findMembers()
      .filter((u) => u.id !== me.id && !u.archivedAt && !isFollowing(me.id, u.id))
      .map((u) => ({ user: u, privacy: findCommunityPrivacyByUserId(u.id) }))
      .filter(({ privacy }) => isDiscoverable(privacy))
      .slice(0, MAX_SUGGESTIONS)
      .map(({ user, privacy }) => ({
        userId: user.id,
        fullName: communityDisplayName(findProfileByUserId(user.id)?.fullName ?? "Member", privacy),
        isFollowing: false,
      }));

    return NextResponse.json({ success: true, data: { results } });
  }

  const results = findMembers()
    .filter((u) => u.id !== me.id && !u.archivedAt)
    .map((u) => ({ user: u, profile: findProfileByUserId(u.id), privacy: findCommunityPrivacyByUserId(u.id) }))
    .filter(({ profile }) => (profile?.fullName ?? "").toLowerCase().includes(q))
    .filter(({ privacy }) => isDiscoverable(privacy))
    .slice(0, MAX_RESULTS)
    .map(({ user, profile, privacy }) => ({
      userId: user.id,
      fullName: communityDisplayName(profile?.fullName ?? "Member", privacy),
      isFollowing: isFollowing(me.id, user.id),
    }));

  return NextResponse.json({ success: true, data: { results } });
}
