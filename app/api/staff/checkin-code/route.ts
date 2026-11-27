import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getConfiguredSessionSecret } from "@/lib/app-config";
import { gymCheckinCode, LIVE_CODE_SECONDS, liveCheckinCode } from "@/lib/class-checkin";
import { findUserById } from "@/lib/db";
import { selfCheckinModeForUser } from "@/lib/gym-checkin-setting";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";
import { requireTenantAccess } from "@/lib/tenant-request";

// The text for the gym's check-in code, for the acting staff member's own gym (from their account, never the request): the fixed poster code, or the live one that changes every minute.
export async function GET(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  if (!user) return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });

  const tenantLock = requireTenantAccess(user);
  if (tenantLock) return tenantLock;

  if (!can(user.role, "classes.manage")) return NextResponse.json({ success: false, message: "Only staff can show the check-in code." }, { status: 403 });

  const secret = getConfiguredSessionSecret();
  if (!secret) return NextResponse.json({ success: false, message: "Check-in is not available right now." }, { status: 503 });

  const mode = selfCheckinModeForUser(user);
  if (mode === "off") return NextResponse.json({ success: true, data: { mode, code: null } });

  const now = Date.now();
  if (mode === "live") {
    const secondsLeft = LIVE_CODE_SECONDS - (Math.floor(now / 1000) % LIVE_CODE_SECONDS);
    return NextResponse.json({ success: true, data: { mode, code: liveCheckinCode(secret, user.gymId ?? null, now), secondsLeft } });
  }
  return NextResponse.json({ success: true, data: { mode, code: gymCheckinCode(secret, user.gymId ?? null) } });
}
