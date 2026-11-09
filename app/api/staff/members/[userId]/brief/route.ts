import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById } from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { staffCanViewMemberData } from "@/lib/member-tier-wall";
import { classBriefFor } from "@/lib/member-summary-data";
import { authorizeStaffRequest } from "@/lib/staff-auth";

// GET /api/staff/members/[userId]/brief — the compact "state of the member" for a coach about to take a class: an overall state (good / take care /
// caution), a few plain lines (training in the last few days and how hard, today's check-in, food and water, class attendance) and any "injured or
// sick?" note. Same rules as the full summary: coach and above, own gym only, gym-Membership members only (others get { walled: true }).
export async function GET(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const auth = authorizeStaffRequest(request, "members.view");
  if (!auth.ok) return auth.response;

  const member = findUserById(userId);
  if (!member || member.role !== "member" || !sameGym(auth.user, member)) {
    return NextResponse.json({ success: false, message: "Member not found." }, { status: 404 });
  }
  if (!staffCanViewMemberData(member.id)) {
    return NextResponse.json({ success: true, data: { walled: true, message: "A brief is available for members with a gym Membership." } });
  }

  return NextResponse.json({ success: true, data: { walled: false, ...classBriefFor(member.id) } });
}
