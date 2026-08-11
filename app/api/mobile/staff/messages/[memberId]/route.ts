import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findMessagesByMemberId, findProfileByUserId, findUserById, markMemberMessagesReadByStaff } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";

// Mirrors the web member-detail page's Messages panel: fetching a thread
// marks the member's messages read as a side effect, exactly like opening
// that panel does server-side on web. Replies go through the existing,
// already Bearer-compatible POST /api/messages/send (staff branch) — no
// separate send route needed here.
export async function GET(request: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;
  const staffUser = sessionUserId ? findUserById(sessionUserId) : undefined;

  if (!staffUser) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  if (!can(staffUser.role, "members.view")) {
    return NextResponse.json({ success: false, message: "Staff access required." }, { status: 403 });
  }

  const { memberId } = await params;
  const member = findUserById(memberId);
  if (!member) {
    return NextResponse.json({ success: false, message: "Member not found." }, { status: 404 });
  }

  markMemberMessagesReadByStaff(memberId);
  const messages = findMessagesByMemberId(memberId);
  const profile = findProfileByUserId(memberId);

  return NextResponse.json({
    success: true,
    data: {
      memberId,
      memberEmail: member.email,
      memberName: profile?.fullName ?? null,
      messages,
    },
  });
}
