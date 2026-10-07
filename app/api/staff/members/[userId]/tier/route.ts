import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { sameGym } from "@/lib/gym-scope";
import type { MemberTier } from "@/lib/member-access";
import { can } from "@/lib/permissions";
import { grantMemberTier } from "@/lib/tier-grant";
import { loadTenantUser, resolveTenantRequest } from "@/lib/tenant-request";

const TIER_VALUES: MemberTier[] = ["free", "app_subscription", "membership"];

// Friendlier wrapper over POST .../subscription — that route takes a raw
// packageId + status; this one takes the tier a staff member actually thinks
// in (see lib/member-access.ts) and resolves it to the right package
// internally, so staff pick a tier from a dropdown, not a package from the
// full catalog.
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

  const { tier, packageId } = (body ?? {}) as Record<string, unknown>;

  if (typeof tier !== "string" || !TIER_VALUES.includes(tier as MemberTier)) {
    return NextResponse.json({ success: false, message: "A valid tier is required." }, { status: 400 });
  }

  const result = await grantMemberTier(member.id, tier as MemberTier, {
    packageId: typeof packageId === "string" && packageId.trim() ? packageId.trim() : undefined,
  });

  if (!result.ok) {
    // A refused conflict (replacing a live entitlement of the other kind, or a live Google Play
    // subscription) is a state conflict, not a bad request. The code is the stable contract.
    if (result.code) {
      return NextResponse.json({ success: false, code: result.code, message: result.message }, { status: 409 });
    }
    return NextResponse.json({ success: false, message: result.message }, { status: result.message.includes("hasn't been set up") || result.message.includes("No Membership-tier") ? 500 : 400 });
  }

  return NextResponse.json(
    { success: true, message: result.message, warning: result.warning ?? null, data: { tier: result.tier } },
    { status: 200 }
  );
}
