import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { countUnreadMessagesForStaff } from "@/lib/db";
import { authorizeStaffRequest } from "@/lib/staff-auth";

// Backs the client-fetched nav badge (see components/staff/UnreadMessagesBadge.tsx).
// Fetched client-side rather than baked into the server-rendered staff layout
// because Next's client router cache can reuse a stale layout render across
// soft navigations, leaving a server-computed badge showing an old count.
export async function GET(request: NextRequest) {
  const auth = authorizeStaffRequest(request, "members.view");
  if (!auth.ok) return auth.response;

  return NextResponse.json({ count: countUnreadMessagesForStaff() }, { status: 200 });
}
