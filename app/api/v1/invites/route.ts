import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createInvite } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { inviteEmail } from "@/lib/email-templates";
import { authenticateApiRequest } from "@/lib/gym-api-keys";
import { PRIMARY_GYM_NAME } from "@/lib/invite-sender";
import { checkRateLimit } from "@/lib/rate-limit";
import { gymNotLive, NOT_LIVE_STAFF_MESSAGE, TENANT_NOT_LIVE_CODE } from "@/lib/tenant-live";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIERS = ["app_subscription", "membership"] as const;

// POST /api/v1/invites { email, tier }: sends a membership invite, as if a staff member had, for a tool that learned about a new person (a sign-up form, a payment, a CRM). Authorised by the
// gym's API key; the invite is for that gym only. Same limits as staff invites (60 an hour per gym), and not available until the gym is live.
export async function POST(request: NextRequest) {
  const auth = authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  const gym = auth.gym;
  if (gymNotLive(gym)) return NextResponse.json({ success: false, code: TENANT_NOT_LIVE_CODE, message: NOT_LIVE_STAFF_MESSAGE }, { status: 423 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Send JSON like {\"email\":\"a@b.com\",\"tier\":\"membership\"}." }, { status: 400 });
  }
  const { email, tier } = (body ?? {}) as Record<string, unknown>;
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) return NextResponse.json({ success: false, message: "A valid email is required." }, { status: 400 });
  if (typeof tier !== "string" || !(TIERS as readonly string[]).includes(tier)) return NextResponse.json({ success: false, message: "tier must be membership or app_subscription." }, { status: 400 });

  const rate = checkRateLimit(`invites:gym:${gym.id}`, 60, 60 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, message: "Too many invites sent. Try again later." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSecs) } });

  const { invite, token } = createInvite({ email: email.trim(), tier: tier as (typeof TIERS)[number], invitedByStaffId: gym.ownerUserId });
  const sender = { gymName: gym.name?.trim() || PRIMARY_GYM_NAME, replyTo: gym.contactEmail?.trim() || undefined };
  const message = inviteEmail({ tier: invite.tier, inviteToken: token, gymName: sender.gymName });
  await sendEmail({ to: invite.email, subject: message.subject, html: message.html, text: message.text, replyTo: sender.replyTo, gymId: gym.slug === "sc-performance-coaching" ? null : gym.id });
  return NextResponse.json({ success: true, message: "Invite sent.", data: { id: invite.id, email: invite.email, tier: invite.tier, expiresAt: invite.expiresAt } }, { status: 201 });
}
