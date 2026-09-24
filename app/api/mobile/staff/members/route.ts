import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById } from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";
import { getStaffMembersData } from "@/lib/staff-members-data";

export async function GET(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const staffUser = userId ? findUserById(userId) : undefined;

  if (!staffUser) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  if (!can(staffUser.role, "members.view")) {
    return NextResponse.json({ success: false, message: "Staff access required." }, { status: 403 });
  }

  // getStaffMembersData is itself scoped to the staff member's gym before it reads
  // any profile/subscription; the row-level check is kept as defense in depth.
  const members = getStaffMembersData(staffUser).filter((m) => sameGym(staffUser, { gymId: findUserById(m.userId)?.gymId }));
  return NextResponse.json({ success: true, data: members });
}
