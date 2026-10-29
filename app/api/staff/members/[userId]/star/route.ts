import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { setStaffMemberStar } from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { can } from "@/lib/permissions";
import { loadTenantUser, resolveTenantRequest } from "@/lib/tenant-request";

// POST /api/staff/members/[userId]/star  { starred: boolean }
// Stars (or unstars) a member so staff can find them quickly in the member lists, where people without a gym Membership are hidden by default
// (owner request 2026-10-29). The star is shared by the gym's staff. Anyone who can view members may star; it changes nothing about the member.
// Website and app staff logins alike.
export async function POST(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const tenant = resolveTenantRequest(request, { unauthenticatedMessage: "You must be signed in to manage members." });
  if (!tenant.ok) return tenant.response;
  const { user: staffUser, ctx } = tenant;
  if (!can(staffUser.role, "members.view")) {
    return NextResponse.json({ success: false, message: "You don't have access to members." }, { status: 403 });
  }

  const { userId } = await params;
  const member = loadTenantUser(ctx, userId);
  if (!member || member.role !== "member" || !sameGym(staffUser, member)) {
    return NextResponse.json({ success: false, message: "Member not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }
  const { starred } = (body ?? {}) as Record<string, unknown>;
  if (typeof starred !== "boolean") {
    return NextResponse.json({ success: false, message: "starred must be true or false." }, { status: 400 });
  }

  setStaffMemberStar(member.id, starred, staffUser.id);
  return NextResponse.json({ success: true, message: starred ? "Member starred." : "Star removed.", data: { starred } });
}
