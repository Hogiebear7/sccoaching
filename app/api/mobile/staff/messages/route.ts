import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findMessageThreadSummaries, findProfileByUserId, findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";

// Mirrors app/(staff)/staff/messages/page.tsx exactly — same
// findMessageThreadSummaries() call, same member lookup per row — so the
// mobile inbox can never show a different list than the web one.
export async function GET(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;
  const staffUser = sessionUserId ? findUserById(sessionUserId) : undefined;

  if (!staffUser) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  if (!can(staffUser.role, "members.view")) {
    return NextResponse.json({ success: false, message: "Staff access required." }, { status: 403 });
  }

  const summaries = findMessageThreadSummaries()
    .map((summary) => {
      const member = findUserById(summary.memberId);
      if (!member) return null;
      const profile = findProfileByUserId(member.id);
      return {
        memberId: summary.memberId,
        memberEmail: member.email,
        memberName: profile?.fullName ?? null,
        memberArchived: Boolean(member.archivedAt),
        lastMessageBody: summary.lastMessage.body,
        lastMessageFromStaff: summary.lastMessage.senderRole === "staff",
        lastMessageAt: summary.lastMessage.createdAt,
        unreadFromMemberCount: summary.unreadFromMemberCount,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  return NextResponse.json({ success: true, data: summaries });
}
