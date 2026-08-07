import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById } from "@/lib/db";
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

  return NextResponse.json({ success: true, data: getStaffTrainingPrograms(userId) });
}
