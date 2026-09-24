import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createResetToken, findUserById } from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { protectedOperatorTarget } from "@/lib/platform-operator-guard";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";

export async function POST(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage members." },
      { status: 401 }
    );
  }

  const staffUser = findUserById(sessionUserId);

  if (!staffUser) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage members." },
      { status: 401 }
    );
  }

  if (!can(staffUser.role, "members.account")) {
    return NextResponse.json(
      { success: false, message: "Only staff can manage members." },
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

  const { userId } = (body ?? {}) as Record<string, unknown>;

  if (typeof userId !== "string" || !userId.trim()) {
    return NextResponse.json(
      { success: false, message: "A member is required." },
      { status: 400 }
    );
  }

  const targetUser = findUserById(userId);

  // The target must be in the acting staff member's own gym. A cross-gym
  // target is folded into the same not-found response as a missing one, and
  // this runs before any reset token is minted, saved, or returned — a
  // foreign account's existence, role, and gym aren't revealed.
  // A platform_operator account can't be modified by anyone else through this
  // tenant tool (reset link, login-email change, role change, archive). It reads
  // exactly like a missing user, before any mutation, so a tenant admin who
  // shares the operator's gym (gymId null) can't take the account over.
  if (!targetUser || !sameGym(staffUser, targetUser) || protectedOperatorTarget(staffUser, targetUser)) {
    return NextResponse.json(
      { success: false, message: "Member not found." },
      { status: 404 }
    );
  }

  const { token } = createResetToken(targetUser.id);
  const resetUrl = `${new URL(request.url).origin}/reset-password?token=${token}`;

  // No email service is configured for this local prototype — same as the
  // member-initiated forgot-password flow. The link is logged for local dev
  // and also returned directly, since this is an authenticated staff action
  // (not subject to the same enumeration-resistance concerns as the public
  // forgot-password endpoint).
  console.log(`[staff-reset-password] Reset link for ${targetUser.email}: ${resetUrl}`);

  return NextResponse.json(
    { success: true, message: "Reset link created.", resetUrl },
    { status: 200 }
  );
}
