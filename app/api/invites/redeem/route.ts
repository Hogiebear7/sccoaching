import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findInviteByToken, findUserById } from "@/lib/db";
import { sameGymAsStaff } from "@/lib/gym-scope";
import { redeemInviteForUser } from "@/lib/invites";
import { verifyRequestSession } from "@/lib/mobile-auth";

// POST /api/invites/redeem — for a member who ALREADY has an account and is
// signed in (web cookie or mobile Bearer token). A brand-new member instead
// carries the token through signup (see inviteToken on the signup routes),
// which redeems on account creation without a separate round-trip.
export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json(
      { success: false, requiresAuth: true, message: "Sign in (or create an account) with the email this invite was sent to, then open the link again." },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { token } = (body ?? {}) as Record<string, unknown>;
  if (typeof token !== "string" || !token.trim()) {
    return NextResponse.json({ success: false, message: "An invite token is required." }, { status: 400 });
  }

  // This route is for a member who ALREADY has an account, so their gym is
  // established: an invite issued by another gym's staff (invite -> invitedByStaffId
  // -> gym) can't be redeemed against it, and reads exactly like an invalid link.
  // An invite whose inviter can't be resolved fails closed the same way. (The
  // signup routes call redeemInviteForUser directly for a brand-new account with
  // no gym yet — assigning a gym at signup is a pending product decision.)
  const invite = findInviteByToken(token.trim());
  if (invite && !sameGymAsStaff(user, invite.invitedByStaffId)) {
    return NextResponse.json({ success: false, message: "This invite link isn't valid." }, { status: 400 });
  }

  const result = await redeemInviteForUser(token.trim(), user);

  return NextResponse.json(
    { success: result.ok, message: result.message, data: result.invite ? { tier: result.invite.tier } : undefined },
    { status: result.ok ? 200 : 400 }
  );
}
