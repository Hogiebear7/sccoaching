import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById } from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { generateCoachSummary, isAiConfigured } from "@/lib/ai";
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
      { success: false, message: "Only staff can generate coach summaries." },
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
  // any member data is loaded or sent to the AI provider.
  if (!member || !sameGym(staffUser, member)) {
    return NextResponse.json(
      { success: false, message: "Member not found." },
      { status: 404 }
    );
  }

  const summary = await generateCoachSummary({ memberId: member.id, staffUserId: staffUser.id });

  return NextResponse.json(
    { success: true, configured: isAiConfigured(), summary },
    { status: 200 }
  );
}
