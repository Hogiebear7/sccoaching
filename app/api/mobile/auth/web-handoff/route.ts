import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createMobileHandoffToken, findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { checkRateLimit } from "@/lib/rate-limit";

// Mints a short-lived (60s), single-use token the mobile app appends to a
// web URL (see app/api/auth/web-handoff/route.ts, the GET route the phone's
// system browser actually lands on) so a "Manage membership on web"-style
// handoff opens the browser already signed in, without ever putting the
// member's real, long-lived session token in a URL / browser history / OS
// link log. Mobile-authenticated like every other /api/mobile/* route.
const HANDOFF_RATE_LIMIT = 10;
const HANDOFF_RATE_WINDOW_MS = 5 * 60 * 1000;

export async function POST(request: NextRequest) {
  const session = verifyRequestSession(request);
  if (!session) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const user = findUserById(session.userId);
  if (!user || user.archivedAt) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const rate = checkRateLimit(`web-handoff:${user.id}`, HANDOFF_RATE_LIMIT, HANDOFF_RATE_WINDOW_MS);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, message: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSecs) } }
    );
  }

  const { token, expiresAt } = createMobileHandoffToken(user.id);

  return NextResponse.json({ success: true, data: { token, expiresAt } });
}
