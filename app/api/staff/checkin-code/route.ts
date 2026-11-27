import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getConfiguredSessionSecret } from "@/lib/app-config";
import { gymCheckinCode } from "@/lib/class-checkin";
import { findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";
import { requireTenantAccess } from "@/lib/tenant-request";

// The text that goes inside the gym's printed check-in poster code. It identifies the staff member's own gym (from their account), never one from the request.
export async function GET(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  if (!user) return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });

  const tenantLock = requireTenantAccess(user);
  if (tenantLock) return tenantLock;

  if (!can(user.role, "classes.manage")) return NextResponse.json({ success: false, message: "Only staff can print the check-in poster." }, { status: 403 });

  const secret = getConfiguredSessionSecret();
  if (!secret) return NextResponse.json({ success: false, message: "Check-in is not available right now." }, { status: 503 });

  return NextResponse.json({ success: true, data: { code: gymCheckinCode(secret, user.gymId ?? null) } });
}
