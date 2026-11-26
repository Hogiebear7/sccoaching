import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { BULK_INVITE_MAX, parseInviteList, type BulkInviteStatus, type ParsedInviteRow } from "@/lib/bulk-invite-parse";
import { createInvite, findInvites, findUserByEmail, findUserById } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { inviteEmail } from "@/lib/email-templates";
import { sameGym, sameGymAsStaff } from "@/lib/gym-scope";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireTenantAccess } from "@/lib/tenant-request";

// POST /api/staff/invites/bulk — { mode: "preview" | "send", tier, text }. The same invite as one at a time (a one-time link that grants the chosen tier when the person signs up
// or signs in with that email), for a pasted list or an uploaded file of up to BULK_INVITE_MAX people. "preview" only reads: it says what would happen to each address. "send" works
// the list out again from the text (the server never trusts the page's own reading), sends the ones that are ready and reports what happened to every address.
//
// Sending an email to an arbitrary address is the risk, so the limits here are per gym and per staff member from the signed-in account (never the request): at most 5 bulk sends per
// gym per day and 3 per staff member per hour. A refused or malformed request never uses a slot.
const TIERS = ["app_subscription", "membership"] as const;
type Tier = (typeof TIERS)[number];
const GYM_BULK_LIMIT = 5;
const GYM_BULK_WINDOW_MS = 24 * 60 * 60 * 1000;
const STAFF_BULK_LIMIT = 3;
const STAFF_BULK_WINDOW_MS = 60 * 60 * 1000;
const PARALLEL_SENDS = 5;
const MAX_TEXT_CHARS = 60_000;

function requireStaffBilling(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;
  if (!sessionUserId) return null;
  const staffUser = findUserById(sessionUserId);
  if (!staffUser || !can(staffUser.role, "members.billing")) return null;
  return staffUser;
}

interface ResultRow {
  email: string;
  name: string | null;
  line: number;
  status: BulkInviteStatus;
  message?: string;
}

/** What would happen to each address for this staff member's gym. Accounts in other gyms are never revealed: an address that belongs to another gym is treated as a new person. */
function classify(staffUser: NonNullable<ReturnType<typeof requireStaffBilling>>, rows: ParsedInviteRow[]): ResultRow[] {
  const now = Date.now();
  const pending = new Set(
    findInvites()
      .filter((i) => i.status === "pending" && new Date(i.expiresAt).getTime() > now && sameGymAsStaff(staffUser, i.invitedByStaffId))
      .map((i) => i.email)
  );
  return rows.map((r) => {
    const existing = findUserByEmail(r.email);
    if (existing && !existing.archivedAt && sameGym(staffUser, existing)) return { ...r, status: "already_member" as const, message: "Already has an account in your gym." };
    if (pending.has(r.email)) return { ...r, status: "already_invited" as const, message: "Has an invite that has not been used yet." };
    return { ...r, status: "ready" as const };
  });
}

function counts(rows: ResultRow[]): Record<BulkInviteStatus, number> {
  const out: Record<BulkInviteStatus, number> = { ready: 0, already_member: 0, already_invited: 0, sent: 0, failed: 0 };
  for (const r of rows) out[r.status] += 1;
  return out;
}

export async function POST(request: NextRequest) {
  const staffUser = requireStaffBilling(request);
  if (!staffUser) {
    return NextResponse.json({ success: false, message: "Only staff can manage invites." }, { status: 403 });
  }
  const tenantLock = requireTenantAccess(staffUser);
  if (tenantLock) return tenantLock;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }
  const { mode, tier, text } = (body ?? {}) as Record<string, unknown>;
  if (mode !== "preview" && mode !== "send") {
    return NextResponse.json({ success: false, message: "Mode must be preview or send." }, { status: 400 });
  }
  if (typeof tier !== "string" || !TIERS.includes(tier as Tier)) {
    return NextResponse.json({ success: false, message: "Tier must be App Subscription or Membership." }, { status: 400 });
  }
  if (typeof text !== "string" || !text.trim() || text.length > MAX_TEXT_CHARS) {
    return NextResponse.json({ success: false, message: text && typeof text === "string" && text.length > MAX_TEXT_CHARS ? "That list is too long. Send up to 100 people at a time." : "Paste or upload at least one email address." }, { status: 400 });
  }

  const parsed = parseInviteList(text);
  if (parsed.rows.length === 0) {
    return NextResponse.json({ success: false, message: "No valid email addresses found.", data: { invalid: parsed.invalid, duplicates: parsed.duplicates, overLimit: parsed.overLimit, rows: [], counts: counts([]) } }, { status: 400 });
  }

  const classified = classify(staffUser, parsed.rows);
  const meta = { invalid: parsed.invalid, duplicates: parsed.duplicates, overLimit: parsed.overLimit, max: BULK_INVITE_MAX };

  if (mode === "preview") {
    return NextResponse.json({ success: true, data: { ...meta, rows: classified, counts: counts(classified) } });
  }

  const ready = classified.filter((r) => r.status === "ready");
  if (ready.length === 0) {
    return NextResponse.json({ success: true, message: "Nobody needed an invite.", data: { ...meta, rows: classified, counts: counts(classified) } });
  }

  // Gym first, then the staff member, so a gym-level refusal never spends the person's own allowance (same order as the single invite).
  const gymRate = checkRateLimit(`invites:bulk:gym:${staffUser.gymId ?? "primary"}`, GYM_BULK_LIMIT, GYM_BULK_WINDOW_MS);
  if (!gymRate.allowed) {
    return NextResponse.json({ success: false, message: "Your gym has sent a lot of bulk invites today. Try again tomorrow." }, { status: 429, headers: { "Retry-After": String(gymRate.retryAfterSecs) } });
  }
  const staffRate = checkRateLimit(`invites:bulk:staff:${staffUser.id}`, STAFF_BULK_LIMIT, STAFF_BULK_WINDOW_MS);
  if (!staffRate.allowed) {
    return NextResponse.json({ success: false, message: "Too many bulk invites sent. Try again later." }, { status: 429, headers: { "Retry-After": String(staffRate.retryAfterSecs) } });
  }

  const results = new Map<string, ResultRow>(classified.map((r) => [r.email, r]));
  for (let i = 0; i < ready.length; i += PARALLEL_SENDS) {
    const chunk = ready.slice(i, i + PARALLEL_SENDS);
    await Promise.all(
      chunk.map(async (row) => {
        try {
          const { invite, token } = createInvite({ email: row.email, tier: tier as Tier, invitedByStaffId: staffUser.id });
          const { subject, html, text: plain } = inviteEmail({ tier: invite.tier, inviteToken: token });
          await sendEmail({ to: invite.email, subject, html, text: plain, dedupeKey: `bulk-invite:${invite.id}` });
          results.set(row.email, { ...row, status: "sent", message: "Invite sent." });
        } catch {
          results.set(row.email, { ...row, status: "failed", message: "Could not send this one. Try it again on its own." });
        }
      })
    );
  }

  const rows = classified.map((r) => results.get(r.email) ?? r);
  const c = counts(rows);
  return NextResponse.json({ success: true, message: c.sent === 1 ? "1 invite sent." : `${c.sent} invites sent.`, data: { ...meta, rows, counts: c } }, { status: 201 });
}
