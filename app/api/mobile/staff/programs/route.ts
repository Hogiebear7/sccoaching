import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById } from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
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

  if (userId) {
    const target = findUserById(userId);
    if (!target || !sameGym(staffUser, target)) {
      return NextResponse.json({ success: false, message: "Member not found." }, { status: 404 });
    }
    if (!staffCanViewMemberData(userId)) {
      return NextResponse.json(
        { success: false, message: "This member's data isn't available until they hold a Membership-tier subscription." },
        { status: 403 }
      );
    }
  }

  // Unfiltered when no userId — same "collapse, don't hide" treatment as the
  // member list page for the all-members overview list.
  // getStaffTrainingPrograms is itself scoped to the staff member's gym before it
  // reads any member email/profile; the row-level filters here are kept as
  // defense in depth (and add the tier wall).
  const programs = getStaffTrainingPrograms(userId, staffUser);
  return NextResponse.json({
    success: true,
    data: userId
      ? programs
      : programs.filter((p) => {
          const owner = findUserById(p.userId);
          return !!owner && sameGym(staffUser, owner) && staffCanViewMemberData(p.userId);
        }),
  });
}
