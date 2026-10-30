import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { MOBILE_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

// Called on app launch (and when it returns to the foreground) to validate a stored token and fetch the
// current user — lets the mobile app tell a still-valid session from a
// stale/revoked one before showing any signed-in UI. It also hands back a fresh 7-day token (a rolling sign-in, owner decision
// 2026-10-30): the app is signed out only after 7 days without using it. Only a still-valid, non-archived session is renewed.
export async function GET(request: NextRequest) {
  const session = verifyRequestSession(request);
  if (!session) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const user = findUserById(session.userId);
  if (!user || user.archivedAt) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  return NextResponse.json({
    success: true,
    user: { id: user.id, email: user.email, role: user.role },
    token: signSession({ userId: user.id }, MOBILE_SESSION_LIFETIME_MS),
  });
}
