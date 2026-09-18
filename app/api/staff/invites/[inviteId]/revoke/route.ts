import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findInviteById, findUserById, revokeInvite } from "@/lib/db";
import { sameGymAsStaff } from "@/lib/gym-scope";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";

// POST /api/staff/invites/[inviteId]/revoke — cancels a still-pending
// invite. Redeemed/expired/already-revoked invites can't be revoked again.
// A cross-gym invite folds into that exact same response — this route
// already collapses every "can't act on this" reason into one message, so a
// wrong-gym invite reading identically to "not found" costs nothing new and
// never reveals that another gym's invite exists.
export async function POST(request: NextRequest, { params }: { params: Promise<{ inviteId: string }> }) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;
  const staffUser = sessionUserId ? findUserById(sessionUserId) : undefined;

  if (!staffUser || !can(staffUser.role, "members.billing")) {
    return NextResponse.json({ success: false, message: "Only staff can manage invites." }, { status: 403 });
  }

  const { inviteId } = await params;
  const invite = findInviteById(inviteId);

  if (!invite || !sameGymAsStaff(staffUser, invite.invitedByStaffId)) {
    return NextResponse.json({ success: false, message: "This invite can't be revoked (already used, expired, or not found)." }, { status: 400 });
  }

  const ok = revokeInvite(inviteId);

  if (!ok) {
    return NextResponse.json({ success: false, message: "This invite can't be revoked (already used, expired, or not found)." }, { status: 400 });
  }

  return NextResponse.json({ success: true, message: "Invite revoked." });
}
