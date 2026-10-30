import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";
import { buildStaffToday } from "@/lib/staff-today";

// The app's staff Today (admin revamp slice S4): this month's figures against last month, and the At-risk list (gym members with no class or
// logged session in 14 days). The same numbers as the website's staff Overview (lib/staff-today.ts), for the staff member's own gym only.
// Admins and up (operations.view), as on the website; no money in it.
export async function GET(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const staffUser = userId ? findUserById(userId) : undefined;
  if (!staffUser || staffUser.archivedAt) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  if (!can(staffUser.role, "operations.view")) {
    return NextResponse.json({ success: false, message: "Staff access required." }, { status: 403 });
  }
  return NextResponse.json({ success: true, data: buildStaffToday({ gymId: staffUser.gymId ?? null }) }, { headers: { "Cache-Control": "no-store" } });
}
