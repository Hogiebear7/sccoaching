import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { deleteUserAndOwnedRecords, findUserById } from "@/lib/db";
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

  if (!target) {
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

  const removed = deleteUserAndOwnedRecords(target.id);

  return NextResponse.json(
    { success: true, message: `${target.email} was permanently deleted.`, removed },
    { status: 200 }
  );
}
