import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findGymById, saveGym } from "@/lib/db";
import { isGymStatus } from "@/lib/gyms-schema";
import { authorizeStaffRequest } from "@/lib/staff-auth";

// The one moderation action this pass builds: flip a self-serve gym signup
// between pending/active/suspended. No review-queue UI yet — see the Phase 2
// plan's Phase 3 for why the actual vetting process is an open business
// question, not something this route decides. admin_manager-only
// (gyms.moderate), same seniority as staffUsers.manage/finance.view.
export async function POST(request: NextRequest, { params }: { params: Promise<{ gymId: string }> }) {
  const auth = authorizeStaffRequest(request, "gyms.moderate");
  if (!auth.ok) return auth.response;

  const { gymId } = await params;
  const gym = findGymById(gymId);
  if (!gym) {
    return NextResponse.json({ success: false, message: "Gym not found." }, { status: 404 });
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
