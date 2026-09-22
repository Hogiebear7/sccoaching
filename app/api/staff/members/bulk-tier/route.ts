import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById } from "@/lib/db";
import { sameGymAsStaff } from "@/lib/gym-scope";
import type { MemberTier } from "@/lib/member-access";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";
import { grantMemberTier } from "@/lib/tier-grant";

const TIER_VALUES: MemberTier[] = ["free", "app_subscription", "membership"];

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
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json({ success: false, message: "You must be signed in to manage memberships." }, { status: 401 });
  }

  const staffUser = findUserById(sessionUserId);
  if (!staffUser) {
    return NextResponse.json({ success: false, message: "You must be signed in to manage memberships." }, { status: 401 });
  }

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

  if (typeof tier !== "string" || !TIER_VALUES.includes(tier as MemberTier)) {
    return NextResponse.json({ success: false, message: "A valid tier is required." }, { status: 400 });
  }

  if (!Array.isArray(userIds) || userIds.length === 0 || !userIds.every((id) => typeof id === "string")) {
    return NextResponse.json({ success: false, message: "At least one member is required." }, { status: 400 });
  }

  const results: BulkTierResult[] = [];

  for (const userId of userIds as string[]) {
    const member = findUserById(userId);
    if (!member || !sameGymAsStaff(staffUser, userId)) {
      results.push({ userId, ok: false, message: "Member not found." });
      continue;
    }

    const result = await grantMemberTier(member.id, tier as MemberTier);
    results.push({ userId, ok: result.ok, message: result.warning ?? result.message });
  }

  return NextResponse.json({ success: true, data: { results } }, { status: 200 });
}
