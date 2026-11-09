import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById } from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { staffCanViewMemberData } from "@/lib/member-tier-wall";
import { memberSummaryFor } from "@/lib/member-summary-data";
import { authorizeStaffRequest } from "@/lib/staff-auth";

// GET /api/staff/members/[userId]/summary — the full picture of a member from what they log: training, classes, check-ins (with any "injured or sick?" note),
// nutrition and water, weight progress, and plain-English flags. Coach and above (members.view), the member's own gym only, and only for a member with a
// gym Membership (the staff data wall): for anyone else it answers { walled: true } and no data. Another gym's member, a missing one and a non-member
// account all read as "not found".
export async function GET(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const auth = authorizeStaffRequest(request, "members.view", { allowAppToken: true });
  if (!auth.ok) return auth.response;

  const member = findUserById(userId);
  if (!member || member.role !== "member" || !sameGym(auth.user, member)) {
    return NextResponse.json({ success: false, message: "Member not found." }, { status: 404 });
  }
  if (!staffCanViewMemberData(member.id)) {
    return NextResponse.json({ success: true, data: { walled: true, message: "A summary is available for members with a gym Membership." } });
  }

  return NextResponse.json({ success: true, data: { walled: false, ...memberSummaryFor(member.id) } });
}
