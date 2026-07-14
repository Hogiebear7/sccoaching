import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findMembershipPlanById, findUserById, saveMembershipPlan } from "@/lib/db";
import { verifySession } from "@/lib/session";

// Toggles only isActive. A dedicated endpoint (rather than round-tripping the
// full plan through the create/edit POST) so archiving never re-validates
// fields staff aren't changing — e.g. a category that has since been deleted.
// Archived plans stay attached to existing members; they just stop being
// offered to new customers.
export async function POST(request: NextRequest) {
  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage plans." },
      { status: 401 }
    );
  }

  if (user.role !== "staff") {
    return NextResponse.json(
      { success: false, message: "Only staff can manage plans." },
      { status: 403 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const { id, isActive } = (body ?? {}) as Record<string, unknown>;

  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json(
      { success: false, message: "A plan is required." },
      { status: 400 }
    );
  }

  if (typeof isActive !== "boolean") {
    return NextResponse.json(
      { success: false, message: "isActive must be true or false." },
      { status: 400 }
    );
  }

  const plan = findMembershipPlanById(id.trim());

  if (!plan) {
    return NextResponse.json(
      { success: false, message: "This plan no longer exists." },
      { status: 404 }
    );
  }

  saveMembershipPlan({ ...plan, isActive, updatedAt: new Date().toISOString() });

  return NextResponse.json(
    {
      success: true,
      message: isActive
        ? `${plan.name} is visible to members again.`
        : `${plan.name} archived — hidden from members. Existing memberships are unaffected.`,
    },
    { status: 200 }
  );
}
