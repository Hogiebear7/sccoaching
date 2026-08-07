import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";
import { getStaffClassesData } from "@/lib/staff-classes-data";

export async function GET(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const staffUser = userId ? findUserById(userId) : undefined;

  if (!staffUser) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  if (!can(staffUser.role, "classes.manage")) {
    return NextResponse.json({ success: false, message: "Staff access required." }, { status: 403 });
  }

  return NextResponse.json({ success: true, data: getStaffClassesData() });
}
