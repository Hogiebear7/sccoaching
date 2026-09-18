import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createInvite, findInvites, findUserById } from "@/lib/db";
import { sameGymAsStaff } from "@/lib/gym-scope";
import { sendEmail } from "@/lib/email";
import { inviteEmail } from "@/lib/email-templates";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";

const INVITABLE_TIERS: Array<"app_subscription" | "membership"> = ["app_subscription", "membership"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requireStaffBilling(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;
  if (!sessionUserId) return null;
  const staffUser = findUserById(sessionUserId);
  if (!staffUser || !can(staffUser.role, "members.billing")) return null;
  return staffUser;
}

// GET /api/staff/invites — list invites for the caller's own gym, newest
// first, for the staff invite-management UI. findInvites() itself returns
// every gym's invites (it's a plain sorted dump), so the gym filter has to
// happen here — never return another gym's invite emails/tiers/ids.
export async function GET(request: NextRequest) {
  const staffUser = requireStaffBilling(request);
  if (!staffUser) {
    return NextResponse.json({ success: false, message: "Only staff can manage invites." }, { status: 403 });
  }

  const invites = findInvites().filter((invite) => sameGymAsStaff(staffUser, invite.invitedByStaffId));

  return NextResponse.json({ success: true, data: invites });
}

// POST /api/staff/invites — { email, tier } → creates an invite and emails a
// redemption link. tier is restricted to the two tiers actually worth
// inviting someone to (Free needs no invite — it's the default).
export async function POST(request: NextRequest) {
  const staffUser = requireStaffBilling(request);
  if (!staffUser) {
    return NextResponse.json({ success: false, message: "Only staff can manage invites." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { email, tier } = (body ?? {}) as Record<string, unknown>;

  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ success: false, message: "A valid email is required." }, { status: 400 });
  }

  if (typeof tier !== "string" || !INVITABLE_TIERS.includes(tier as (typeof INVITABLE_TIERS)[number])) {
    return NextResponse.json({ success: false, message: "Tier must be App Subscription or Membership." }, { status: 400 });
  }

  const { invite, token } = createInvite({
    email: email.trim(),
    tier: tier as "app_subscription" | "membership",
    invitedByStaffId: staffUser.id,
  });

  const { subject, html, text } = inviteEmail({ tier: invite.tier, inviteToken: token });
  await sendEmail({ to: invite.email, subject, html, text });

  return NextResponse.json({ success: true, message: "Invite sent.", data: invite }, { status: 201 });
}
