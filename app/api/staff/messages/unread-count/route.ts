import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findMessageThreadSummaries, findUserById } from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { authorizeStaffRequest } from "@/lib/staff-auth";

// Backs the client-fetched nav badge (see components/staff/UnreadMessagesBadge.tsx).
// Fetched client-side rather than baked into the server-rendered staff layout
// because Next's client router cache can reuse a stale layout render across
// soft navigations, leaving a server-computed badge showing an old count.
export async function GET(request: NextRequest) {
  const auth = authorizeStaffRequest(request, "members.view");
  if (!auth.ok) return auth.response;

  // Only unread messages from members in the acting staff member's own gym
  // (gymId null = primary gym); a thread whose member can't be resolved counts
  // for no one. Matches the gym scoping of the Messages page itself.
  const count = findMessageThreadSummaries().reduce((sum, summary) => {
    const member = findUserById(summary.memberId);
    return member && sameGym(auth.user, member) ? sum + summary.unreadFromMemberCount : sum;
  }, 0);

  return NextResponse.json({ count }, { status: 200 });
}
