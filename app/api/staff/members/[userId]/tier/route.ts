import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById } from "@/lib/db";
import type { MemberTier } from "@/lib/member-access";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";
import { grantMemberTier } from "@/lib/tier-grant";

const TIER_VALUES: MemberTier[] = ["free", "app_subscription", "membership"];

// Friendlier wrapper over POST .../subscription — that route takes a raw
// packageId + status; this one takes the tier a staff member actually thinks
// in (see lib/member-access.ts) and resolves it to the right package
// internally, so staff pick a tier from a dropdown, not a package from the
// full catalog.
export async function POST(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json({ success: false, message: "You must be signed in to manage memberships." }, { status: 401 });
  }

  const staffUser = findUserById(sessionUserId);
  if (!staffUser) {
    return NextResponse.json({ success: false, message: "You must be signed in to manage memberships." }, { status: 401 });
  }

  if (!can(staffUser.role, "members.billing")) {
    return NextResponse.json({ success: false, message: "Only staff can manage memberships." }, { status: 403 });
  }

  const { userId } = await params;
  const member = findUserById(userId);
  if (!member) {
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
    return NextResponse.json({ success: false, message: result.message }, { status: result.message.includes("hasn't been set up") || result.message.includes("No Membership-tier") ? 500 : 400 });
  }

  return NextResponse.json(
    { success: true, message: result.message, warning: result.warning ?? null, data: { tier: result.tier } },
    { status: 200 }
  );
}
