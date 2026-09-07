import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findMembers, findProfileByUserId, findUserById, isFollowing } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

const MAX_RESULTS = 20;

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

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().toLowerCase();
  if (!q) {
    return NextResponse.json({ success: true, data: { results: [] } });
  }

  const results = findMembers()
    .filter((u) => u.id !== me.id && !u.archivedAt)
    .map((u) => ({ user: u, profile: findProfileByUserId(u.id) }))
    .filter(({ profile }) => (profile?.fullName ?? "").toLowerCase().includes(q))
    .slice(0, MAX_RESULTS)
    .map(({ user, profile }) => ({
      userId: user.id,
      fullName: profile?.fullName ?? "Member",
      isFollowing: isFollowing(me.id, user.id),
    }));

  return NextResponse.json({ success: true, data: { results } });
}
