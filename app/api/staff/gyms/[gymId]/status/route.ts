import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findGymById, saveGym } from "@/lib/db";
import { isGymStatus } from "@/lib/gyms-schema";
import { PRIMARY_GYM_SLUG } from "@/lib/primary-gym";
import { authorizeStaffRequest } from "@/lib/staff-auth";

// The one moderation action this pass builds: flip a self-serve gym signup
// between pending/active/suspended. No review-queue UI yet — see the Phase 2
// plan's Phase 3 for why the actual vetting process is an open business
// question, not something this route decides.
//
// PLATFORM-ONLY: gyms.moderate is satisfied by the platform_operator role
// alone — no tenant role (admin_manager included) and no gymId, null or
// otherwise, can moderate. A gym also can never change its OWN status, so even
// an operator who belongs to a gym cannot approve or suspend that gym here.
// Authorization and the self-status rule both run before anything is written.
export async function POST(request: NextRequest, { params }: { params: Promise<{ gymId: string }> }) {
  const auth = authorizeStaffRequest(request, "gyms.moderate");
  if (!auth.ok) return auth.response;

  const { gymId } = await params;
  const gym = findGymById(gymId);
  if (!gym) {
    return NextResponse.json({ success: false, message: "Gym not found." }, { status: 404 });
  }

  // The acting operator's own gym: their gymId, or — for the primary-gym
  // convention (gymId null) — the primary gym. This is used ONLY to REFUSE a
  // self-status change; it never grants anything.
  const isOwnGym = auth.user.gymId ? gym.id === auth.user.gymId : gym.slug === PRIMARY_GYM_SLUG;
  if (isOwnGym) {
    return NextResponse.json({ success: false, message: "A gym can't change its own status." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { status } = (body ?? {}) as Record<string, unknown>;
  if (!isGymStatus(status)) {
    return NextResponse.json({ success: false, message: "A valid status is required." }, { status: 400 });
  }

  saveGym({ ...gym, status, updatedAt: new Date().toISOString() });

  return NextResponse.json({ success: true, message: `Gym marked ${status}.` }, { status: 200 });
}
