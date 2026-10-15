import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findProfileByUserId, findUserById, removeFollowsBetween, saveProfile } from "@/lib/db";
import { MAX_BLOCKED } from "@/lib/community-moderation";
import { sameGymAsStaff } from "@/lib/gym-scope";
import { verifyRequestSession } from "@/lib/mobile-auth";

// POST /api/mobile/community/block — { userId }
// Blocks a member in Community (see lib/community-moderation.ts): each of the two stops seeing the other's workouts, comments, likes and name, any
// follow between them is removed in both directions, and they stop notifying each other. Same-gym members only; anything else is the same "not found"
// answer as a missing member, so this cannot be used to probe other gyms. Idempotent.
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
  const { userId } = (body ?? {}) as Record<string, unknown>;
  if (typeof userId !== "string" || !userId.trim()) {
    return NextResponse.json({ success: false, message: "userId is required." }, { status: 400 });
  }
  if (userId === me.id) {
    return NextResponse.json({ success: false, message: "You can't block yourself." }, { status: 400 });
  }

  const target = findUserById(userId);
  if (!target || !sameGymAsStaff(me, target.id)) {
    return NextResponse.json({ success: false, message: "Member not found." }, { status: 404 });
  }
  const profile = findProfileByUserId(me.id);
  if (!profile) {
    return NextResponse.json({ success: false, message: "No profile found for this account." }, { status: 404 });
  }

  const current = profile.blockedUserIds ?? [];
  if (!current.includes(userId)) {
    if (current.length >= MAX_BLOCKED) {
      return NextResponse.json({ success: false, message: "Your block list is full." }, { status: 400 });
    }
    saveProfile({ ...profile, blockedUserIds: [...current, userId], updatedAt: new Date().toISOString() });
  }
  removeFollowsBetween(me.id, userId);

  return NextResponse.json({ success: true, message: "Blocked." });
}
