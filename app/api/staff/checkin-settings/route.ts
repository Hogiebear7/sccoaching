import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { checkinPeriodOf, isCheckinPeriod, isSelfCheckinMode } from "@/lib/class-checkin";
import { findUserById, saveGym } from "@/lib/db";
import { gymRecordForUser, selfCheckinModeForUser } from "@/lib/gym-checkin-setting";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";
import { requireTenantAccess } from "@/lib/tenant-request";

// How members check in at the acting staff member's own gym: off, poster, or live. The gym comes from the account, never the request.
async function staffFor(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  if (!user) return { error: NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 }) };
  const tenantLock = requireTenantAccess(user);
  if (tenantLock) return { error: tenantLock };
  if (!can(user.role, "classes.manage")) return { error: NextResponse.json({ success: false, message: "Only staff can change check-in." }, { status: 403 }) };
  return { user };
}

export async function GET(request: NextRequest) {
  const { user, error } = await staffFor(request);
  if (!user) return error;
  return NextResponse.json({ success: true, data: { mode: selfCheckinModeForUser(user), period: checkinPeriodOf(gymRecordForUser(user)) } });
}

export async function POST(request: NextRequest) {
  const { user, error } = await staffFor(request);
  if (!user) return error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }
  const { mode, period } = ((body ?? {}) as Record<string, unknown>);
  if (!isSelfCheckinMode(mode)) return NextResponse.json({ success: false, message: "Choose off, poster or live." }, { status: 400 });
  if (period !== undefined && !isCheckinPeriod(period)) return NextResponse.json({ success: false, message: "Choose minute, day or week." }, { status: 400 });

  const gym = gymRecordForUser(user);
  if (!gym) return NextResponse.json({ success: false, message: "Your gym could not be found." }, { status: 404 });
  saveGym({ ...gym, selfCheckin: mode, ...(period !== undefined ? { selfCheckinPeriod: period } : {}), updatedAt: new Date().toISOString() });

  return NextResponse.json({ success: true, message: mode === "off" ? "Check-in by scanning is off." : "Saved.", data: { mode, period: period ?? checkinPeriodOf(gym) } });
}
