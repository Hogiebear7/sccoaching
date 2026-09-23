import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById, unfollowUser } from "@/lib/db";
import { sameGymAsStaff } from "@/lib/gym-scope";
import { verifyRequestSession } from "@/lib/mobile-auth";

// POST /api/mobile/community/unfollow — { userId }
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

  const { userId } = (body ?? {}) as Record<string, unknown>;
  if (typeof userId !== "string" || !userId.trim()) {
    return NextResponse.json({ success: false, message: "userId is required." }, { status: 400 });
  }

  // Always a generic success — this route never checked existence before
  // either, so silently skipping the mutation on a cross-gym target (which
  // follow already prevents from ever being created) can't be used to probe
  // whether a relationship exists.
  const target = findUserById(userId);
  if (target && sameGymAsStaff(me, target.id)) {
    unfollowUser(me.id, userId);
  }

  return NextResponse.json({ success: true, message: "Unfollowed." });
}
