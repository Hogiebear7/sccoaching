import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { sameGymAsStaff } from "@/lib/gym-scope";
import { can } from "@/lib/permissions";
import { grantMemberTier, revokeDigitalGrant, type GrantTier } from "@/lib/tier-grant";
import { loadTenantUser, resolveTenantRequest } from "@/lib/tenant-request";
import { recordStaffAction } from "@/lib/staff-actions";

// Same four actions as POST .../[userId]/tier: gym Membership (membership / free) and COMPLIMENTARY digital access
// (app_subscription / digital_revoke) are independent. See that route for the meaning of each.
const ACTIONS = ["free", "app_subscription", "membership", "digital_revoke"] as const;
type Action = (typeof ACTIONS)[number];

export interface BulkTierResult {
  userId: string;
  ok: boolean;
  message: string;
}

// Bulk sibling of POST .../[userId]/tier — same underlying grantMemberTier()
// call, looped, so a large batch of sign-ups (e.g. a fresh cohort of
// semi-private members) can be granted a tier in one action instead of one
// staff click per member. Partial failure doesn't block the rest: each id
// gets its own result rather than the whole request failing on the first
// error.
export async function POST(request: NextRequest) {
  const tenant = resolveTenantRequest(request, { unauthenticatedMessage: "You must be signed in to manage memberships." });
  if (!tenant.ok) return tenant.response;
  const { user: staffUser, ctx } = tenant;

  if (!can(staffUser.role, "members.grantTier")) {
    return NextResponse.json({ success: false, message: "Only staff can manage memberships." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { userIds, tier } = (body ?? {}) as Record<string, unknown>;

  if (typeof tier !== "string" || !ACTIONS.includes(tier as Action)) {
    return NextResponse.json({ success: false, message: "A valid tier is required." }, { status: 400 });
  }

  if (!Array.isArray(userIds) || userIds.length === 0 || !userIds.every((id) => typeof id === "string")) {
    return NextResponse.json({ success: false, message: "At least one member is required." }, { status: 400 });
  }

  const results: BulkTierResult[] = [];

  for (const userId of userIds as string[]) {
    const member = loadTenantUser(ctx, userId);
    if (!member || !sameGymAsStaff(staffUser, userId)) {
      results.push({ userId, ok: false, message: "Member not found." });
      continue;
    }

    const result = tier === "digital_revoke" ? revokeDigitalGrant(member.id) : await grantMemberTier(member.id, tier as GrantTier, { grantedByUserId: staffUser.id });
    if (result.ok) {
      const type = tier === "digital_revoke" ? "app_access_withdrawn" : tier === "app_subscription" ? "app_access_granted" : tier === "membership" ? "gym_membership_granted" : "gym_membership_ended";
      recordStaffAction(staffUser, member, type, { bulk: true });
    }
    results.push({ userId, ok: result.ok, message: result.warning ?? result.message });
  }

  return NextResponse.json({ success: true, data: { results } }, { status: 200 });
}
