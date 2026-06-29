import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findMembershipPlanById,
  findSubscriptionByUserId,
  findUserById,
  saveSubscription,
  type SubscriptionRecord,
  type SubscriptionStatus,
} from "@/lib/db";
import { verifySession } from "@/lib/session";

const STATUS_VALUES: SubscriptionStatus[] = [
  "inactive",
  "pending",
  "active",
  "past_due",
  "canceled",
];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const sessionUserId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage memberships." },
      { status: 401 }
    );
  }

  const staffUser = findUserById(sessionUserId);

  if (!staffUser) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage memberships." },
      { status: 401 }
    );
  }

  if (staffUser.role !== "staff") {
    return NextResponse.json(
      { success: false, message: "Only staff can manage memberships." },
      { status: 403 }
    );
  }

  const { userId } = await params;
  const member = findUserById(userId);

  if (!member) {
    return NextResponse.json(
      { success: false, message: "Member not found." },
      { status: 404 }
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

  const { status, planId } = (body ?? {}) as Record<string, unknown>;

  if (typeof status !== "string" || !STATUS_VALUES.includes(status as SubscriptionStatus)) {
    return NextResponse.json(
      { success: false, message: "A valid status is required." },
      { status: 400 }
    );
  }

  const existingSubscription = findSubscriptionByUserId(member.id);
  const resolvedPlanId =
    typeof planId === "string" && planId.trim() ? planId.trim() : existingSubscription?.planId ?? null;

  if (resolvedPlanId && !findMembershipPlanById(resolvedPlanId)) {
    return NextResponse.json(
      { success: false, message: "This plan does not exist." },
      { status: 404 }
    );
  }

  if (!resolvedPlanId) {
    return NextResponse.json(
      { success: false, message: "A plan is required to set a membership status." },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();

  // Switching into "active" (or onto a different plan) starts a fresh
  // billing period as far as this app is concerned, so the session count
  // resets. Re-saving an already-active subscription on the same plan
  // doesn't touch usage.
  const isEnteringFreshActivePeriod =
    status === "active" &&
    (existingSubscription?.status !== "active" || existingSubscription?.planId !== resolvedPlanId);

  // A manual staff override always records provider: "none" — it's separate
  // from the Revolut-backed flow (cash payment, comp membership, correcting
  // a stuck state, etc). It does not touch any in-flight Revolut order.
  const subscription: SubscriptionRecord = {
    userId: member.id,
    planId: resolvedPlanId,
    status: status as SubscriptionStatus,
    provider: "none",
    providerCustomerId: existingSubscription?.providerCustomerId ?? null,
    providerSubscriptionId: existingSubscription?.providerSubscriptionId ?? null,
    providerSetupOrderId: existingSubscription?.providerSetupOrderId ?? null,
    currentPeriodEnd: existingSubscription?.currentPeriodEnd ?? null,
    lastWebhookEventAt: existingSubscription?.lastWebhookEventAt ?? null,
    sessionsUsedThisPeriod: isEnteringFreshActivePeriod
      ? 0
      : existingSubscription?.sessionsUsedThisPeriod ?? 0,
    periodLapsedNotifiedAt: isEnteringFreshActivePeriod
      ? null
      : existingSubscription?.periodLapsedNotifiedAt ?? null,
    createdAt: existingSubscription?.createdAt ?? now,
    updatedAt: now,
  };

  saveSubscription(subscription);

  return NextResponse.json(
    { success: true, message: "Membership status updated." },
    { status: 200 }
  );
}
