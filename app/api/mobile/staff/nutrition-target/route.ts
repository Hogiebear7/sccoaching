import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findNutritionTargetByUserId, findUserById } from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { staffCanViewMemberData } from "@/lib/member-tier-wall";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";

export async function GET(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;
  const staffUser = sessionUserId ? findUserById(sessionUserId) : undefined;

  if (!staffUser) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  if (!can(staffUser.role, "nutrition.manage")) {
    return NextResponse.json({ success: false, message: "Staff access required." }, { status: 403 });
  }

  const userId = request.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ success: false, message: "userId is required." }, { status: 400 });
  }
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

  return NextResponse.json({ success: true, data: findNutritionTargetByUserId(userId) ?? null });
}
