import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findMembershipPlanById,
  findSubscriptionByUserId,
  findUserById,
  saveSubscription,
  type SubscriptionRecord,
} from "@/lib/db";
import { verifySession } from "@/lib/session";

export async function POST(request: NextRequest) {
  const sessionUserId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in." },
      { status: 401 }
    );
  }

  const staffUser = findUserById(sessionUserId);

  if (!staffUser || staffUser.role !== "staff") {
    return NextResponse.json(
      { success: false, message: "Only staff can activate memberships." },
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

  const { userId, planId, periodEndIso } = (body ?? {}) as Record<string, unknown>;

  if (typeof userId !== "string" || !userId.trim()) {
    return NextResponse.json(
      { success: false, message: "userId is required." },
      { status: 400 }
    );
  }

  if (typeof planId !== "string" || !planId.trim()) {
    return NextResponse.json(
      { success: false, message: "planId is required." },
      { status: 400 }
    );
  }

  const member = findUserById(userId.trim());

  if (!member) {
    return NextResponse.json(
      { success: false, message: "Member not found." },
      { status: 404 }
    );
  }

  if (member.role !== "member") {
    return NextResponse.json(
      { success: false, message: "Can only activate memberships for member accounts." },
      { status: 400 }
    );
  }

  const plan = findMembershipPlanById(planId.trim());

  if (!plan || !plan.isActive) {
    return NextResponse.json(
      { success: false, message: "This plan does not exist or is not active." },
      { status: 404 }
    );
  }

  let resolvedPeriodEnd: string | null = null;

  if (typeof periodEndIso === "string" && periodEndIso.trim()) {
    const d = new Date(periodEndIso.trim());
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json(
        { success: false, message: "periodEndIso must be a valid date string." },
        { status: 400 }
      );
    }
    resolvedPeriodEnd = d.toISOString();
  }

  const now = new Date().toISOString();
  const existing = findSubscriptionByUserId(member.id);

  const subscription: SubscriptionRecord = {
    userId: member.id,
    planId: plan.id,
    status: "active",
    provider: "none",
    providerCustomerId: existing?.providerCustomerId ?? null,
    providerSubscriptionId: existing?.providerSubscriptionId ?? null,
    providerSetupOrderId: existing?.providerSetupOrderId ?? null,
    currentPeriodEnd: resolvedPeriodEnd,
    lastWebhookEventAt: existing?.lastWebhookEventAt ?? null,
    sessionsUsedThisPeriod: 0,
    extraSessionGrants: [],
    periodLapsedNotifiedAt: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  saveSubscription(subscription);

  const periodNote = resolvedPeriodEnd
    ? ` until ${new Date(resolvedPeriodEnd).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`
    : "";

  return NextResponse.json(
    {
      success: true,
      message: `${member.email} activated on ${plan.name}${periodNote}. Session count reset to 0.`,
    },
    { status: 200 }
  );
}
