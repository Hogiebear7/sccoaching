import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById } from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { staffCanViewMemberData } from "@/lib/member-tier-wall";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";
import { getStaffMemberDetail, getStaffMemberWalledSummary } from "@/lib/staff-members-data";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;
  const staffUser = sessionUserId ? findUserById(sessionUserId) : undefined;

  if (!staffUser) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  if (!can(staffUser.role, "members.view")) {
    return NextResponse.json({ success: false, message: "Staff access required." }, { status: 403 });
  }

  const { userId } = await params;
  const target = findUserById(userId);
  if (!target || !sameGym(staffUser, target)) {
    return NextResponse.json({ success: false, message: "Member not found." }, { status: 404 });
  }
  // A member without a gym Membership: their data stays behind the wall, but staff still see who they are and what they hold, so access can be
  // granted from the app (the website's walled member page does the same). Previously a 403, which left the app's staff screen empty.
  if (!staffCanViewMemberData(userId)) {
    const summary = getStaffMemberWalledSummary(userId);
    if (!summary) return NextResponse.json({ success: false, message: "Member not found." }, { status: 404 });
    return NextResponse.json({ success: true, data: summary });
  }
  const data = getStaffMemberDetail(userId);
  if (!data) {
    return NextResponse.json({ success: false, message: "Member not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true, data });
}
