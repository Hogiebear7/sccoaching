import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";
import { getStaffMemberDetail } from "@/lib/staff-members-data";

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
  const data = getStaffMemberDetail(userId);
  if (!data) {
    return NextResponse.json({ success: false, message: "Member not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true, data });
}
