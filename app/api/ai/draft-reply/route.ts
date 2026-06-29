import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findMessagesByMemberId, findUserById } from "@/lib/db";
import { draftReply, isAiConfigured } from "@/lib/ai";
import { verifySession } from "@/lib/session";

export async function POST(request: NextRequest) {
  const sessionUserId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

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

  if (staffUser.role !== "staff") {
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

  if (!member) {
    return NextResponse.json(
      { success: false, message: "Member not found." },
      { status: 404 }
    );
  }

  const memberMessages = findMessagesByMemberId(member.id).filter(
    (message) => message.senderRole === "member"
  );
  const latestMemberMessage = memberMessages[memberMessages.length - 1]?.body ?? null;

  const draft = await draftReply({ memberId: member.id, latestMemberMessage });

  return NextResponse.json(
    { success: true, configured: isAiConfigured(), draft },
    { status: 200 }
  );
}
