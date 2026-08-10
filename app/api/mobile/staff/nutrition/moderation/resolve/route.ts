import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findFoodModerationRequestById, findUserById, saveFoodModerationRequest, type FoodModerationStatus } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";

const RESOLVABLE_STATUSES: FoodModerationStatus[] = ["resolved", "dismissed"];

// body: { id, status: "resolved" | "dismissed", resolvedFoodId?: string }
// resolvedFoodId links the report to whatever common/branded food the staff
// member added or matched it to (added separately via the common/branded
// catalog, which isn't member-facing — admin tooling for that is a
// follow-up; this endpoint just records the resolution).
export async function POST(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;
  const staffUser = sessionUserId ? findUserById(sessionUserId) : undefined;

  if (!staffUser) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  if (!can(staffUser.role, "foodCatalog.manage")) {
    return NextResponse.json({ success: false, message: "Staff access required." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { id, status, resolvedFoodId } = (body ?? {}) as Record<string, unknown>;

  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ success: false, message: "id is required." }, { status: 400 });
  }
  if (typeof status !== "string" || !RESOLVABLE_STATUSES.includes(status as FoodModerationStatus)) {
    return NextResponse.json({ success: false, message: "status must be 'resolved' or 'dismissed'." }, { status: 400 });
  }

  const existing = findFoodModerationRequestById(id);
  if (!existing) {
    return NextResponse.json({ success: false, message: "Report not found." }, { status: 404 });
  }

  saveFoodModerationRequest({
    ...existing,
    status: status as FoodModerationStatus,
    resolvedFoodId: typeof resolvedFoodId === "string" && resolvedFoodId.trim() ? resolvedFoodId.trim() : existing.resolvedFoodId,
    resolvedByStaffId: staffUser.id,
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json({ success: true, message: "Report updated." }, { status: 200 });
}
