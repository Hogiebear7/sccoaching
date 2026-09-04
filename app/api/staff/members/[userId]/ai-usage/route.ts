import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { AI_USAGE_RANGES, summarizeAiUsage, type AiUsageRange } from "@/lib/ai-usage";
import { findAiUsageLogsByUserId, findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";

const VALID_RANGES = new Set(AI_USAGE_RANGES.map((r) => r.value));

// GET /api/staff/members/[userId]/ai-usage?range=month|last_month|3mo|6mo|year|all
// Same view-level permission as the rest of a member's staff profile —
// this is part of what a coach sees when they open a member, not a
// billing-only figure.
export async function GET(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;
  if (!sessionUserId) {
    return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  }

  const staffUser = findUserById(sessionUserId);
  if (!staffUser) {
    return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  }

  if (!can(staffUser.role, "members.view")) {
    return NextResponse.json({ success: false, message: "You don't have access to member details." }, { status: 403 });
  }

  const { userId } = await params;
  const member = findUserById(userId);
  if (!member) {
    return NextResponse.json({ success: false, message: "Member not found." }, { status: 404 });
  }

  const rangeParam = request.nextUrl.searchParams.get("range");
  const range: AiUsageRange = VALID_RANGES.has(rangeParam as AiUsageRange) ? (rangeParam as AiUsageRange) : "month";

  const logs = findAiUsageLogsByUserId(member.id);
  const summary = summarizeAiUsage(logs, range);

  return NextResponse.json({ success: true, data: summary });
}
