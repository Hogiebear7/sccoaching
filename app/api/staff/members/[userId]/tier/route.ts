import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { sameGym } from "@/lib/gym-scope";
import { can } from "@/lib/permissions";
import { grantMemberTier, revokeDigitalGrant, type GrantTier } from "@/lib/tier-grant";
import { loadTenantUser, resolveTenantRequest } from "@/lib/tenant-request";

// The two independent things staff can set (owner decision D1; see lib/member-access.ts):
//   membership        — the paid gym Membership (resolved to the member's gym's default package, or packageId)
//   free              — end the gym Membership
//   app_subscription  — grant COMPLIMENTARY digital access (never a paid subscription; shown as complimentary)
//   digital_revoke    — withdraw a complimentary digital grant
// A paid store subscription (Google Play / App Store) is never created, changed or ended here: only the store can do that.
const ACTIONS = ["free", "app_subscription", "membership", "digital_revoke"] as const;
type Action = (typeof ACTIONS)[number];
export async function POST(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  // The tenant is derived from the authenticated account here, at the first line, and never from the request.
  const tenant = resolveTenantRequest(request, { unauthenticatedMessage: "You must be signed in to manage memberships." });
  if (!tenant.ok) return tenant.response;
  const { user: staffUser, ctx } = tenant;

  if (!can(staffUser.role, "members.grantTier")) {
    return NextResponse.json({ success: false, message: "Only staff can manage memberships." }, { status: 403 });
  }

  const { userId } = await params;
  // A missing target and another tenant's target are the same answer. The sameGym check is kept as defence in depth.
  const member = loadTenantUser(ctx, userId);
  if (!member || !sameGym(staffUser, member)) {
    return NextResponse.json({ success: false, message: "Member not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { tier, packageId, endsOn, note } = (body ?? {}) as Record<string, unknown>;
  // Complimentary app access may end on a date (YYYY-MM-DD, through the end of that day, UTC) and carry a short note for the audit trail.
  let endsAt: string | null = null;
  if (endsOn !== undefined && endsOn !== null && endsOn !== "") {
    if (typeof endsOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn) || Number.isNaN(Date.parse(`${endsOn}T23:59:59Z`))) {
      return NextResponse.json({ success: false, message: "The end date must be a valid date (YYYY-MM-DD)." }, { status: 400 });
    }
    endsAt = `${endsOn}T23:59:59.999Z`;
    if (Date.parse(endsAt) <= Date.now()) {
      return NextResponse.json({ success: false, message: "The end date must be in the future." }, { status: 400 });
    }
  }
  const cleanNote = typeof note === "string" && note.trim() ? note.trim().slice(0, 200) : null;

  if (typeof tier !== "string" || !ACTIONS.includes(tier as Action)) {
    return NextResponse.json({ success: false, message: "A valid tier is required." }, { status: 400 });
  }

  const result =
    tier === "digital_revoke"
      ? revokeDigitalGrant(member.id)
      : await grantMemberTier(member.id, tier as GrantTier, {
          packageId: typeof packageId === "string" && packageId.trim() ? packageId.trim() : undefined,
          grantedByUserId: staffUser.id,
          note: cleanNote,
          endsAt,
        });

  if (!result.ok) {
    return NextResponse.json({ success: false, message: result.message }, { status: result.message.includes("No Membership-tier package") ? 500 : 400 });
  }

  return NextResponse.json(
    { success: true, message: result.message, warning: result.warning ?? null, data: { access: result.access } },
    { status: 200 }
  );
}
