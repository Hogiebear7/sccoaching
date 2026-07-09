import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findMembershipPlanById,
  findSubscriptionByProviderOrderId,
  saveSubscription,
} from "@/lib/db";
import {
  isRevolutTimestampFresh,
  isRevolutWebhookConfigured,
  mapRevolutEventToStatus,
  verifyRevolutSignature,
} from "@/lib/providers/revolut-webhook";

function addIntervalToNow(intervalDays: number): string {
  const periodEnd = new Date();
  periodEnd.setDate(periodEnd.getDate() + intervalDays);
  return periodEnd.toISOString();
}

// Server-side billing lifecycle endpoint. Revolut (or any future provider)
// posts events here; this is the ONLY thing allowed to move a subscription
// to "active" — client requests never do. Signature verification is what
// makes that trustworthy.
export async function POST(request: NextRequest) {
  if (!isRevolutWebhookConfigured()) {
    console.warn("[billing webhook] rejected: webhook signing secret not configured");
    return NextResponse.json(
      { success: false, message: "Webhook signing secret is not configured." },
      { status: 401 }
    );
  }

  const rawBody = await request.text();
  const signature = request.headers.get("revolut-signature");
  const timestamp = request.headers.get("revolut-request-timestamp");

  if (!isRevolutTimestampFresh(timestamp)) {
    console.warn("[billing webhook] rejected: missing or stale Revolut-Request-Timestamp", { timestamp });
    return NextResponse.json(
      { success: false, message: "Webhook timestamp missing or stale." },
      { status: 401 }
    );
  }

  if (!verifyRevolutSignature(rawBody, timestamp, signature)) {
    console.warn("[billing webhook] rejected: invalid signature");
    return NextResponse.json(
      { success: false, message: "Invalid webhook signature." },
      { status: 401 }
    );
  }

  let payload: unknown;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.warn("[billing webhook] rejected: body was not valid JSON");
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const {
    event,
    order_id: rawOrderId,
    subscription_id: rawSubscriptionId,
  } = (payload ?? {}) as Record<string, unknown>;

  // Subscription lifecycle events (SUBSCRIPTION_INITIATED etc.) may carry
  // the subscription ID in subscription_id rather than order_id depending
  // on the Revolut API version. Accept either and prefer order_id.
  const entityId =
    typeof rawOrderId === "string"
      ? rawOrderId
      : typeof rawSubscriptionId === "string"
        ? rawSubscriptionId
        : null;

  if (typeof event !== "string" || entityId === null) {
    console.warn("[billing webhook] rejected: missing event or entity id", { payload });
    return NextResponse.json(
      { success: false, message: "Malformed webhook payload." },
      { status: 400 }
    );
  }

  const nextStatus = mapRevolutEventToStatus(event);

  // Unhandled event type (e.g. a dispute event) — acknowledge so Revolut
  // doesn't retry, but there's nothing to update.
  if (!nextStatus) {
    return NextResponse.json({ success: true, message: "Event ignored." }, { status: 200 });
  }

  const subscription = findSubscriptionByProviderOrderId(entityId);

  if (!subscription) {
    console.warn("[billing webhook] no subscription matches entity id", { entityId, event });
    return NextResponse.json(
      { success: true, message: "No matching subscription for this order." },
      { status: 200 }
    );
  }

  // Revolut doesn't guarantee webhook delivery order. If a fresher event was
  // already applied to this subscription, a late/out-of-order delivery
  // shouldn't be allowed to regress its status.
  const eventTimestampMs = Number(timestamp);
  const lastAppliedMs = subscription.lastWebhookEventAt
    ? new Date(subscription.lastWebhookEventAt).getTime()
    : null;

  if (lastAppliedMs !== null && eventTimestampMs <= lastAppliedMs) {
    console.warn("[billing webhook] ignored out-of-order event", {
      entityId,
      event,
      eventTimestampMs,
      lastAppliedMs,
    });
    return NextResponse.json(
      { success: true, message: "Event is older than the last applied update; ignored." },
      { status: 200 }
    );
  }

  const plan = subscription.planId ? findMembershipPlanById(subscription.planId) : undefined;

  // Revolut's webhook payload doesn't include a period-end date, so when a
  // subscription becomes active this is computed locally from the plan's
  // billing interval rather than sourced from the provider. A freshly
  // computed period end means a new period is starting, so session usage
  // resets with it.
  const isFreshPeriod = nextStatus === "active" && Boolean(plan);
  const currentPeriodEnd = isFreshPeriod
    ? addIntervalToNow(plan!.billingInterval === "annual" ? 365 : 30)
    : nextStatus === "active"
      ? subscription.currentPeriodEnd
      : null;

  saveSubscription({
    ...subscription,
    status: nextStatus,
    currentPeriodEnd,
    sessionsUsedThisPeriod: isFreshPeriod ? 0 : subscription.sessionsUsedThisPeriod,
    extraSessionGrants: isFreshPeriod ? [] : subscription.extraSessionGrants,
    periodLapsedNotifiedAt: isFreshPeriod ? null : subscription.periodLapsedNotifiedAt,
    lastWebhookEventAt: new Date(eventTimestampMs).toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json({ success: true, message: "Subscription updated." }, { status: 200 });
}
