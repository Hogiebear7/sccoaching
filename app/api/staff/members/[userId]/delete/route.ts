import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { appendIapEvent, deleteUserAndOwnedRecords, findUserById } from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { ACTIVE_SUBSCRIPTION_CODE, ACTIVE_SUBSCRIPTION_MESSAGE, MemberDeletionRefused } from "@/lib/member-deletion-guard";
import { authorizeStaffRequest } from "@/lib/staff-auth";

// PERMANENT deletion of an archived member and all of their owned records.
// Guardrails (defence in depth — enforced here regardless of the UI):
//  - admin_manager only (members.hardDelete);
//  - the target must be a MEMBER (never a staff account);
//  - the target must already be ARCHIVED (can't hard-delete an active member).
// Removing the member's subscription/purchase rows is what frees a membership
// package or billing option to be deleted afterwards.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = authorizeStaffRequest(request, "members.hardDelete");
  if (!auth.ok) return auth.response;

  const { userId } = await params;
  const target = findUserById(userId);

  if (!target || !sameGym(auth.user, target)) {
    return NextResponse.json({ success: false, message: "Member not found." }, { status: 404 });
  }
  if (target.role !== "member") {
    return NextResponse.json(
      { success: false, message: "Only member accounts can be permanently deleted." },
      { status: 400 }
    );
  }
  if (!target.archivedAt) {
    return NextResponse.json(
      { success: false, message: "Archive this member first — only archived members can be permanently deleted." },
      { status: 409 }
    );
  }

  // Refused (nothing changed) while the member holds a protected Google Play entitlement. Nothing is cancelled or refunded.
  let removed: Record<string, number>;
  try {
    removed = deleteUserAndOwnedRecords(target.id);
  } catch (error) {
    if (error instanceof MemberDeletionRefused) {
      appendIapEvent({
        type: "staff_write_rejected",
        userId: target.id,
        actor: "staff",
        detail: { code: ACTIVE_SUBSCRIPTION_CODE, source: "member_hard_delete", state: error.state },
      });
      return NextResponse.json({ success: false, code: ACTIVE_SUBSCRIPTION_CODE, message: ACTIVE_SUBSCRIPTION_MESSAGE }, { status: 409 });
    }
    throw error;
  }

  return NextResponse.json(
    { success: true, message: `${target.email} was permanently deleted.`, removed },
    { status: 200 }
  );
}
