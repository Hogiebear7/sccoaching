import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findProfileByUserId, findUserById, saveProfile } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// POST /api/mobile/community/unblock — { userId }
// Removes a member from the caller's own block list. It does not restore any follow. Always a generic success, so it reveals nothing about anyone
// else's list. The user id is only ever matched against the caller's own list.
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

  const profile = findProfileByUserId(me.id);
  if (profile?.blockedUserIds?.includes(userId)) {
    saveProfile({ ...profile, blockedUserIds: profile.blockedUserIds.filter((id) => id !== userId), updatedAt: new Date().toISOString() });
  }
  return NextResponse.json({ success: true, message: "Unblocked." });
}
