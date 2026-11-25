import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findGymById, saveGym } from "@/lib/db";
import type { GymRecord } from "@/lib/gyms-schema";
import { PRIMARY_GYM_SLUG } from "@/lib/primary-gym";
import { authorizeStaffRequest } from "@/lib/staff-auth";
import { MAX_TENANT_GRACE_DAYS, isIsoDay, tenantAccess } from "@/lib/tenant-billing";

// Records what a tenant has paid S&C for the platform: POST { paidThrough: "YYYY-MM-DD" | null, graceDays?: 0-60 }. paidThrough is the last paid day; null takes the
// gym off billing (it is never restricted). This only records the date. It takes no money, and nothing is locked unless the server's TENANT_LOCKOUT_ENABLED
// switch is on (lib/tenant-lockout.ts). Nothing is deleted at any point.
//
// PLATFORM-ONLY, like the status route next to it: gyms.moderate is the platform_operator role alone, and a gym can never change its OWN billing, so an operator who
// belongs to a gym cannot extend that gym's own access here.
export async function POST(request: NextRequest, { params }: { params: Promise<{ gymId: string }> }) {
  const auth = authorizeStaffRequest(request, "gyms.moderate");
  if (!auth.ok) return auth.response;

  const { gymId } = await params;
  const gym = findGymById(gymId);
  if (!gym) return NextResponse.json({ success: false, message: "Gym not found." }, { status: 404 });

  const isOwnGym = auth.user.gymId ? gym.id === auth.user.gymId : gym.slug === PRIMARY_GYM_SLUG;
  if (isOwnGym) return NextResponse.json({ success: false, message: "A gym can't change its own billing." }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { paidThrough, graceDays } = (body ?? {}) as Record<string, unknown>;
  if (paidThrough !== null && !isIsoDay(paidThrough)) {
    return NextResponse.json({ success: false, message: "paidThrough must be a date like 2026-12-31, or null." }, { status: 400 });
  }
  if (graceDays !== undefined && (typeof graceDays !== "number" || !Number.isInteger(graceDays) || graceDays < 0 || graceDays > MAX_TENANT_GRACE_DAYS)) {
    return NextResponse.json({ success: false, message: `graceDays must be a whole number from 0 to ${MAX_TENANT_GRACE_DAYS}.` }, { status: 400 });
  }

  // Apply to the gym as it is NOW (the body was awaited after the gym was read).
  const current = findGymById(gymId) ?? gym;
  const keptGrace = current.platformBilling?.graceDays;
  const grace = graceDays !== undefined ? graceDays : keptGrace;
  const next: GymRecord = { ...current, updatedAt: new Date().toISOString() };
  if (paidThrough === null) delete next.platformBilling;
  else next.platformBilling = { paidThrough, ...(grace !== undefined ? { graceDays: grace } : {}) };
  saveGym(next);

  const access = tenantAccess(next, new Date());
  return NextResponse.json({ success: true, data: { state: access.state, paidThrough: access.paidThrough, graceEndsOn: access.graceEndsOn } }, { status: 200 });
}
