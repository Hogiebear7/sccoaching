import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { appendIapEvent, findProfileByUserId, saveProfile } from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { can } from "@/lib/permissions";
import { loadTenantUser, resolveTenantRequest } from "@/lib/tenant-request";
import { recordStaffAction } from "@/lib/staff-actions";

// POST /api/staff/members/[userId]/ai-pause  { paused: boolean }
// Pauses (or resumes) every member AI feature for one member: heavy or abusive use, or a billing problem being sorted out. Nothing else in the app
// changes, and their allowance is untouched. Same permission as granting access (members.grantTier). Website and app staff logins alike.
export async function POST(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const tenant = resolveTenantRequest(request, { unauthenticatedMessage: "You must be signed in to manage members." });
  if (!tenant.ok) return tenant.response;
  const { user: staffUser, ctx } = tenant;
  if (!can(staffUser.role, "members.grantTier")) {
    return NextResponse.json({ success: false, message: "Only staff who manage access can pause AI." }, { status: 403 });
  }

  const { userId } = await params;
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
  const { paused } = (body ?? {}) as Record<string, unknown>;
  if (typeof paused !== "boolean") {
    return NextResponse.json({ success: false, message: "paused must be true or false." }, { status: 400 });
  }

  // Read after the last await, so the profile written is the one as it is now.
  const profile = findProfileByUserId(member.id);
  if (!profile) {
    return NextResponse.json({ success: false, message: "Member not found." }, { status: 404 });
  }
  const now = new Date().toISOString();
  saveProfile({ ...profile, aiPausedAt: paused ? profile.aiPausedAt ?? now : null, updatedAt: now });
  appendIapEvent({ provider: "staff", type: "staff_grant_changed", userId: member.id, actor: "staff", detail: { action: paused ? "ai_pause" : "ai_resume" } });
  recordStaffAction(staffUser, member, paused ? "ai_paused" : "ai_resumed");

  return NextResponse.json({ success: true, message: paused ? "AI paused for this member." : "AI resumed for this member.", data: { paused } });
}
