import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById } from "@/lib/db";
import { staffCanViewMemberData } from "@/lib/member-tier-wall";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";
import { getStaffTrainingPrograms } from "@/lib/training-programs";

export async function GET(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;
  const staffUser = sessionUserId ? findUserById(sessionUserId) : undefined;

  if (!staffUser) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  if (!can(staffUser.role, "programs.manage")) {
    return NextResponse.json({ success: false, message: "Staff access required." }, { status: 403 });
  }

  const userId = request.nextUrl.searchParams.get("userId") ?? undefined;

  if (userId && !staffCanViewMemberData(userId)) {
    return NextResponse.json(
      { success: false, message: "This member's data isn't available until they hold a Membership-tier subscription." },
      { status: 403 }
    );
  }

  // Unfiltered when no userId — same "collapse, don't hide" treatment as the
  // member list page for the all-members overview list.
  const programs = getStaffTrainingPrograms(userId);
  return NextResponse.json({
    success: true,
    data: userId ? programs : programs.filter((p) => staffCanViewMemberData(p.userId)),
  });
}
