import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findClassPassProductById,
  findMembershipPlanById,
  findPurchaseById,
  findPurchaseByProviderOrderId,
  findPurchaseByProviderPaymentRef,
  findSubscriptionByProviderOrderId,
  findSubscriptionBySetupOrderId,
  findSubscriptionByUserId,
  hasPaymentEvent,
  recordPaymentEvent,
  savePurchase,
  saveSubscription,
  type PurchaseRecord,
} from "@/lib/db";
import {
  applyPaidPassPurchase,
  applyRefundedPassPurchase,
  transitionPurchase,
} from "@/lib/payments";
import {
  isStripeWebhookConfigured,
  verifyStripeSignature,
} from "@/lib/providers/stripe-webhook";

function addIntervalToNow(intervalDays: number): string {
  const periodEnd = new Date();
  periodEnd.setDate(periodEnd.getDate() + intervalDays);
  return periodEnd.toISOString();
}

// Stripe event lifecycle endpoint — the ONLY path that credits purchased
// passes or activates Stripe-billed memberships. Safety layers:
//  1. signature verification (whsec_, 5-minute replay window);
//  2. event-id dedupe (Stripe retries reuse the same evt_ id) — replays
//    are acknowledged with 200 and never re-applied;
//  3. purchase/subscription state machines — an event that arrives out of
//    order (e.g. completed after refunded) applies nothing;
//  4. ledger-level idempotency — credits are keyed to the purchase id, so
//    even a *different* event carrying the same consequence can't double-credit.
export async function POST(request: NextRequest) {
  if (!isStripeWebhookConfigured()) {
    console.warn("[stripe webhook] rejected: signing secret not configured");
    return NextResponse.json(
      { success: false, message: "Webhook signing secret is not configured." },
      { status: 401 }
    );
  }

  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!verifyStripeSignature(rawBody, signature)) {
    console.warn("[stripe webhook] rejected: invalid signature");
    return NextResponse.json(
      { success: false, message: "Invalid webhook signature." },
      { status: 401 }
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const event = (payload ?? {}) as {
    id?: string;
    type?: string;
    data?: { object?: Record<string, unknown> };
  };

  if (typeof event.id !== "string" || typeof event.type !== "string" || !event.data?.object) {
    console.warn("[stripe webhook] rejected: malformed event payload");
    return NextResponse.json({ success: false, message: "Malformed event." }, { status: 400 });
  }

  // Stripe retries reuse the same event id — a processed id is final.
  if (hasPaymentEvent(event.id)) {
    return NextResponse.json({ success: true, message: "Event already processed." }, { status: 200 });
  }

  const object = event.data.object;
  const ack = (message: string) => {
    recordPaymentEvent({
      key: event.id as string,
      provider: "stripe",
      type: event.type as string,
      entityId: typeof object.id === "string" ? object.id : null,
      receivedAt: new Date().toISOString(),
    });
    return NextResponse.json({ success: true, message }, { status: 200 });
  };

  // ── Checkout session lifecycle ────────────────────────────────────────
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const sessionId = typeof object.id === "string" ? object.id : null;
    const mode = typeof object.mode === "string" ? object.mode : null;
    const paymentStatus =
      typeof object.payment_status === "string" ? object.payment_status : null;

    if (mode === "payment" && sessionId) {
      const purchase = findOneOffPurchaseForSession(sessionId, object);
      if (!purchase) return ack("No matching purchase.");
      // Delayed payment methods complete the session before the money moves;
      // apply only once Stripe reports paid.
      if (paymentStatus !== "paid") return ack("Awaiting payment settlement.");

      const paid = transitionPurchase(purchase, "paid");
      if (!paid) return ack("No transition applied.");

      const withRef: PurchaseRecord = {
        ...paid,
        providerPaymentRef:
          typeof object.payment_intent === "string" ? object.payment_intent : null,
      };
      savePurchase(withRef);

      if (purchase.kind === "pass_pack") {
        const product = findClassPassProductById(purchase.productId);
        if (product) applyPaidPassPurchase(withRef, product);
        else
          console.warn("[stripe webhook] paid pass purchase has no product row", {
            purchaseId: purchase.id,
          });
        return ack("Passes credited.");
      }

      // Intro membership: activate a bounded, non-renewing period. The
      // purchase state machine makes this once-only under replays, and the
      // paid purchase row is the durable once-per-member evidence.
      const plan = findMembershipPlanById(purchase.productId);
      const existing = findSubscriptionByUserId(purchase.userId);
      const introDays = plan?.introDurationDays ?? 42;
      const nowIso = new Date().toISOString();
      saveSubscription({
        userId: purchase.userId,
        planId: purchase.productId,
        status: "active",
        provider: "stripe",
        providerCustomerId:
          typeof object.customer === "string" ? object.customer : existing?.providerCustomerId ?? null,
        // No recurring subscription exists — nothing must ever renew this.
        providerSubscriptionId: null,
        providerSetupOrderId: sessionId,
        currentPeriodEnd: addIntervalToNow(introDays),
        lastWebhookEventAt: nowIso,
        sessionsUsedThisPeriod: 0,
        extraSessionGrants: [],
        periodLapsedNotifiedAt: null,
        createdAt: existing?.createdAt ?? nowIso,
        updatedAt: nowIso,
      });
      return ack("Introductory membership activated.");
    }

    if (mode === "subscription" && sessionId) {
      const subscription = findSubscriptionBySetupOrderId(sessionId);
      if (!subscription) {
        console.warn("[stripe webhook] no subscription matches session", { sessionId });
        return ack("No matching subscription.");
      }
      const plan = subscription.planId ? findMembershipPlanById(subscription.planId) : undefined;
      const isFreshPeriod = subscription.status !== "active";
      saveSubscription({
        ...subscription,
        status: "active",
        providerSubscriptionId:
          typeof object.subscription === "string"
            ? object.subscription
            : subscription.providerSubscriptionId,
        providerCustomerId:
          typeof object.customer === "string" ? object.customer : subscription.providerCustomerId,
        currentPeriodEnd: addIntervalToNow(
          plan?.billingInterval === "annual" ? 365 : plan?.billingInterval === "quarterly" ? 90 : 30
        ),
        sessionsUsedThisPeriod: isFreshPeriod ? 0 : subscription.sessionsUsedThisPeriod,
        extraSessionGrants: isFreshPeriod ? [] : subscription.extraSessionGrants,
        periodLapsedNotifiedAt: isFreshPeriod ? null : subscription.periodLapsedNotifiedAt,
        lastWebhookEventAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return ack("Membership activated.");
    }

    return ack("Session mode not handled.");
  }

  if (event.type === "checkout.session.async_payment_failed") {
    const sessionId = typeof object.id === "string" ? object.id : null;
    const purchase = sessionId ? findOneOffPurchaseForSession(sessionId, object) : undefined;
    if (purchase) transitionPurchase(purchase, "failed");
    return ack("Payment failure recorded.");
  }

  if (event.type === "checkout.session.expired") {
    const sessionId = typeof object.id === "string" ? object.id : null;
    const purchase = sessionId ? findOneOffPurchaseForSession(sessionId, object) : undefined;
    if (purchase) transitionPurchase(purchase, "cancelled");
    return ack("Expired session recorded.");
  }

  // ── Refunds (pass packs) ──────────────────────────────────────────────
  if (event.type === "charge.refunded") {
    const paymentIntent =
      typeof object.payment_intent === "string" ? object.payment_intent : null;
    const metadataPurchaseId = readMetadataPurchaseId(object);
    const purchase =
      (paymentIntent ? findPurchaseByProviderPaymentRef(paymentIntent) : undefined) ??
      (metadataPurchaseId ? findPurchaseById(metadataPurchaseId) : undefined);

    if (purchase && purchase.kind === "pass_pack") {
      const refunded = transitionPurchase(purchase, "refunded");
      if (refunded) applyRefundedPassPurchase(refunded);
      return ack(refunded ? "Refund applied." : "No transition applied.");
    }
    return ack("No matching purchase for refund.");
  }

  // ── Renewals ──────────────────────────────────────────────────────────
  // invoice.paid is the source of truth for billing periods: the covered
  // service period comes from the invoice lines, not from our own interval
  // arithmetic. Handles the first invoice (correcting the synthetic period
  // set at activation), every renewal, and successful past-due retries.
  // invoice.payment_succeeded is the same consequence under a legacy name;
  // both are safe to process because a period can only roll forward once.
  if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
    const subscriptionId = readInvoiceSubscriptionId(object);
    const subscription = subscriptionId
      ? findSubscriptionByProviderOrderId(subscriptionId)
      : undefined;

    if (!subscription) return ack("No matching subscription for invoice.");

    // A canceled membership stays canceled — a final invoice settling after
    // customer.subscription.deleted must not resurrect access.
    if (subscription.status === "canceled") return ack("Subscription is canceled.");

    const paidPeriodEnd = readInvoicePeriodEnd(object);
    const now = new Date().toISOString();

    // The period only ever rolls forward. An invoice whose covered period
    // doesn't extend past what we already have (replays under a different
    // event id, the duplicate legacy event, out-of-order delivery) still
    // confirms payment — so it can recover past_due — but never resets
    // usage or shortens the period a member is already inside.
    const advancesPeriod =
      paidPeriodEnd !== null &&
      (subscription.currentPeriodEnd === null || paidPeriodEnd > subscription.currentPeriodEnd);

    saveSubscription({
      ...subscription,
      status: "active",
      currentPeriodEnd: advancesPeriod ? paidPeriodEnd : subscription.currentPeriodEnd,
      sessionsUsedThisPeriod: advancesPeriod ? 0 : subscription.sessionsUsedThisPeriod,
      extraSessionGrants: advancesPeriod ? [] : subscription.extraSessionGrants,
      periodLapsedNotifiedAt: advancesPeriod ? null : subscription.periodLapsedNotifiedAt,
      lastWebhookEventAt: now,
      updatedAt: now,
    });

    return ack(advancesPeriod ? "Billing period rolled." : "Payment confirmed.");
  }

  // ── Subscription lifecycle ────────────────────────────────────────────
  if (event.type === "invoice.payment_failed" || event.type === "customer.subscription.deleted") {
    const subscriptionId =
      event.type === "customer.subscription.deleted"
        ? typeof object.id === "string"
          ? object.id
          : null
        : readInvoiceSubscriptionId(object);

    if (subscriptionId) {
      // Reuses the shared finder: Stripe subscription ids are stored in
      // providerSubscriptionId, which this finder matches on.
      const subscription = findSubscriptionByProviderOrderId(subscriptionId);
      if (subscription) {
        saveSubscription({
          ...subscription,
          status: event.type === "invoice.payment_failed" ? "past_due" : "canceled",
          lastWebhookEventAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        return ack("Subscription status updated.");
      }
    }
    return ack("No matching subscription.");
  }

  return ack("Event ignored.");
}

// One-off purchases (pass packs and intro memberships) are matched
// primarily by session id (providerOrderId) with the metadata purchase id
// as belt-and-braces.
function findOneOffPurchaseForSession(
  sessionId: string,
  object: Record<string, unknown>
): PurchaseRecord | undefined {
  const byOrder = findPurchaseByProviderOrderId(sessionId);
  if (byOrder) return byOrder;
  const metadataId = readMetadataPurchaseId(object);
  if (metadataId) return findPurchaseById(metadataId);
  return undefined;
}

// Invoice → subscription id across Stripe API versions: older versions put
// it at invoice.subscription; 2025+ versions nest it under
// invoice.parent.subscription_details.subscription.
function readInvoiceSubscriptionId(object: Record<string, unknown>): string | null {
  if (typeof object.subscription === "string") return object.subscription;
  const parent = object.parent;
  if (typeof parent === "object" && parent !== null) {
    const details = (parent as Record<string, unknown>).subscription_details;
    if (typeof details === "object" && details !== null) {
      const sub = (details as Record<string, unknown>).subscription;
      if (typeof sub === "string") return sub;
    }
  }
  return null;
}

// The service period an invoice covers ends at the latest line period end
// (epoch seconds). invoice.period_end is the invoicing window, not the
// covered service period, so it is only a last-resort fallback.
function readInvoicePeriodEnd(object: Record<string, unknown>): string | null {
  let latest = 0;

  const lines = object.lines;
  if (typeof lines === "object" && lines !== null) {
    const data = (lines as Record<string, unknown>).data;
    if (Array.isArray(data)) {
      for (const line of data) {
        if (typeof line !== "object" || line === null) continue;
        const period = (line as Record<string, unknown>).period;
        if (typeof period !== "object" || period === null) continue;
        const end = (period as Record<string, unknown>).end;
        if (typeof end === "number" && end > latest) latest = end;
      }
    }
  }

  if (latest === 0 && typeof object.period_end === "number") latest = object.period_end;

  return latest > 0 ? new Date(latest * 1000).toISOString() : null;
}

function readMetadataPurchaseId(object: Record<string, unknown>): string | null {
  const metadata = object.metadata;
  if (typeof metadata === "object" && metadata !== null) {
    const id = (metadata as Record<string, unknown>).purchase_id;
    if (typeof id === "string" && id.trim()) return id;
  }
  return null;
}
