import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findMembershipPlanById,
  findSubscriptionByUserId,
  findUserById,
  saveSubscription,
  type SubscriptionRecord,
} from "@/lib/db";
import { createCheckoutForPlan, isPendingCheckoutStale } from "@/lib/billing";
import { verifySession } from "@/lib/session";

export async function POST(request: NextRequest) {
  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

  if (!userId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to select a plan." },
      { status: 401 }
    );
  }

  const user = findUserById(userId);

  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to select a plan." },
      { status: 401 }
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

  const { planId } = (body ?? {}) as Record<string, unknown>;

  if (typeof planId !== "string" || !planId.trim()) {
    return NextResponse.json(
      { success: false, message: "A plan is required." },
      { status: 400 }
    );
  }

  const plan = findMembershipPlanById(planId);

  if (!plan || !plan.isActive) {
    return NextResponse.json(
      { success: false, message: "This plan is not available." },
      { status: 404 }
    );
  }

  const existingSubscription = findSubscriptionByUserId(userId);

  // Avoid creating a duplicate checkout while one is still recently in
  // progress for this same plan. Once it's stale (likely abandoned), allow
  // a fresh checkout rather than locking the member out forever.
  if (
    existingSubscription?.status === "pending" &&
    existingSubscription.planId === plan.id &&
    !isPendingCheckoutStale(existingSubscription.updatedAt)
  ) {
    return NextResponse.json(
      {
        success: false,
        message: "A checkout for this plan is already in progress. Complete or wait a few minutes before retrying.",
      },
      { status: 409 }
    );
  }

  const checkout = await createCheckoutForPlan({
    member: { id: user.id, email: user.email },
    plan,
    existingCustomerId: existingSubscription?.providerCustomerId ?? null,
  });

  if (checkout.error) {
    return NextResponse.json(
      { success: false, message: `Could not start checkout: ${checkout.error}` },
      { status: 502 }
    );
  }

  const now = new Date().toISOString();

  // Only a verified webhook (or a staff manual override) should ever set
  // status to "active". A successful checkout creation only means the
  // member can now go pay — it isn't payment confirmation.
  const subscription: SubscriptionRecord = {
    userId,
    planId: plan.id,
    status: checkout.checkoutUrl ? "pending" : "inactive",
    provider: checkout.provider,
    providerCustomerId: checkout.providerCustomerId ?? existingSubscription?.providerCustomerId ?? null,
    providerSubscriptionId: checkout.providerSubscriptionId ?? existingSubscription?.providerSubscriptionId ?? null,
    providerSetupOrderId: checkout.providerSetupOrderId ?? null,
    currentPeriodEnd: null,
    // A new order id means any previous webhook history no longer applies.
    lastWebhookEventAt: null,
    // Starting a checkout isn't payment confirmation, so it doesn't itself
    // start a new billing period — the webhook resets usage when it does.
    sessionsUsedThisPeriod: existingSubscription?.sessionsUsedThisPeriod ?? 0,
    periodLapsedNotifiedAt: existingSubscription?.periodLapsedNotifiedAt ?? null,
    createdAt: existingSubscription?.createdAt ?? now,
    updatedAt: now,
  };

  saveSubscription(subscription);

  return NextResponse.json(
    {
      success: true,
      checkoutUrl: checkout.checkoutUrl,
      message: checkout.checkoutUrl
        ? "Redirecting you to checkout to complete payment."
        : "Plan selected. Billing isn't configured yet, so this only records your choice — no charge occurs.",
    },
    { status: 200 }
  );
}
