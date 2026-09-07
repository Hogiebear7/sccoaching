import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById, unfollowUser } from "@/lib/db";
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

  unfollowUser(me.id, userId);

  return NextResponse.json({ success: true, message: "Unfollowed." });
}
