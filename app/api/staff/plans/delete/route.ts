import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  countSubscriptionsByPlanId,
  deleteMembershipPlan,
  findMembershipPlanById,
  findUserById,
} from "@/lib/db";
import { verifySession } from "@/lib/session";

// Hard-deletes a membership plan, but only when no member subscription (of
// any status, current or historical) references it — a referenced plan's
// name and pricing are still load-bearing for display and history, so it
// must be archived (isActive: false) instead.
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

  const { id } = (body ?? {}) as Record<string, unknown>;

  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json(
      { success: false, message: "A plan is required." },
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

  const references = countSubscriptionsByPlanId(plan.id);

  if (references > 0) {
    return NextResponse.json(
      {
        success: false,
        message: `${plan.name} is referenced by ${references} membership${references === 1 ? "" : "s"} and can't be deleted. Archive it instead to hide it from members.`,
      },
      { status: 409 }
    );
  }

  deleteMembershipPlan(plan.id);

  return NextResponse.json(
    { success: true, message: `${plan.name} deleted.` },
    { status: 200 }
  );
}
