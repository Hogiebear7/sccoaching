import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// Called once on app launch to validate a stored token and fetch the
// current user — lets the mobile app tell a still-valid session from a
// stale/revoked one before showing any signed-in UI.
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
  });
}
