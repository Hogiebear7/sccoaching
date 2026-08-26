import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById, revokeInvite } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";

// POST /api/staff/invites/[inviteId]/revoke — cancels a still-pending
// invite. Redeemed/expired/already-revoked invites can't be revoked again.
export async function POST(request: NextRequest, { params }: { params: Promise<{ inviteId: string }> }) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;
  const staffUser = sessionUserId ? findUserById(sessionUserId) : undefined;

  if (!staffUser || !can(staffUser.role, "members.billing")) {
    return NextResponse.json({ success: false, message: "Only staff can manage invites." }, { status: 403 });
  }

  const { inviteId } = await params;
  const ok = revokeInvite(inviteId);

  if (!ok) {
    return NextResponse.json({ success: false, message: "This invite can't be revoked (already used, expired, or not found)." }, { status: 400 });
  }

  return NextResponse.json({ success: true, message: "Invite revoked." });
}
