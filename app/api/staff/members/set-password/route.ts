import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById, updateUserPassword } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { passwordChangedByStaffEmail } from "@/lib/email-templates";
import { sameGym } from "@/lib/gym-scope";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";
import { hashPassword } from "@/lib/password";
import { protectedOperatorTarget, targetOutranksActor } from "@/lib/platform-operator-guard";
import { generateTempPassword } from "@/lib/temp-password";

// Admin sets a temporary password for a MEMBER who can't use email, and is shown
// it once to pass on. Same guards as reset-password (members.account = admin and
// above, same gym, can't touch an operator or anyone who outranks the actor),
// plus: the target must be a plain member, so this can never be used to take over
// a staff account. A blocked target reads exactly like a missing one, before the
// password is generated or anything is written. The password is stored hashed,
// returned only in this response (no-store) and never logged.
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

  if (
    !targetUser ||
    targetUser.role !== "member" ||
    !sameGym(staffUser, targetUser) ||
    protectedOperatorTarget(staffUser, targetUser) ||
    targetOutranksActor(staffUser, targetUser)
  ) {
    return NextResponse.json(
      { success: false, message: "Member not found." },
      { status: 404 }
    );
  }

  const temporaryPassword = generateTempPassword();
  updateUserPassword(targetUser.id, hashPassword(temporaryPassword));

  // Who did what, never the password itself.
  console.log(`[staff-set-password] ${staffUser.id} set a temporary password for member ${targetUser.id}`);

  // Security notice to the address on the account. Best-effort: sendEmail never
  // throws and a missing inbox must not stop the admin helping the member.
  if (targetUser.email) {
    void sendEmail({ to: targetUser.email, ...passwordChangedByStaffEmail() });
  }

  return NextResponse.json(
    {
      success: true,
      message: "Temporary password set. Give it to the member and ask them to change it once they are signed in.",
      temporaryPassword,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
