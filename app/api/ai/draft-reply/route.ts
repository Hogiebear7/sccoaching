import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findMessagesByMemberId, findUserById } from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { draftReply, isAiConfigured } from "@/lib/ai";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";

export async function POST(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to use this." },
      { status: 401 }
    );
  }

  const staffUser = findUserById(sessionUserId);

  if (!staffUser) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to use this." },
      { status: 401 }
    );
  }

  if (!can(staffUser.role, "members.coaching")) {
    return NextResponse.json(
      { success: false, message: "Only staff can draft replies." },
      { status: 403 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const { memberId } = (body ?? {}) as Record<string, unknown>;

  if (typeof memberId !== "string" || !memberId.trim()) {
    return NextResponse.json(
      { success: false, message: "A member is required." },
      { status: 400 }
    );
  }

  const member = findUserById(memberId);

  // The target member is resolved from the request's memberId, so it is only
  // trusted once it is in the acting staff member's own gym (gymId null =
  // primary gym). A cross-gym member reads exactly like a missing one, before
  // any message is read or sent to the AI provider.
  if (!member || !sameGym(staffUser, member)) {
    return NextResponse.json(
      { success: false, message: "Member not found." },
      { status: 404 }
    );
  }

  const memberMessages = findMessagesByMemberId(member.id).filter(
    (message) => message.senderRole === "member"
  );
  const latestMemberMessage = memberMessages[memberMessages.length - 1]?.body ?? null;

  const draft = await draftReply({ memberId: member.id, latestMemberMessage, staffUserId: staffUser.id });

  return NextResponse.json(
    { success: true, configured: isAiConfigured(), draft },
    { status: 200 }
  );
}
