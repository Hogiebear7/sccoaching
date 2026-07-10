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
      const purchase = findPassPurchaseForSession(sessionId, object);
      if (!purchase) return ack("No matching purchase.");
      // Delayed payment methods complete the session before the money moves;
      // credit only once Stripe reports paid.
      if (paymentStatus !== "paid") return ack("Awaiting payment settlement.");

      const paid = transitionPurchase(purchase, "paid");
      if (paid) {
        const withRef: PurchaseRecord = {
          ...paid,
          providerPaymentRef:
            typeof object.payment_intent === "string" ? object.payment_intent : null,
        };
        savePurchase(withRef);
        const product = findClassPassProductById(purchase.productId);
        if (product) applyPaidPassPurchase(withRef, product);
        else
          console.warn("[stripe webhook] paid pass purchase has no product row", {
            purchaseId: purchase.id,
          });
      }
      return ack(paid ? "Passes credited." : "No transition applied.");
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
        currentPeriodEnd: addIntervalToNow(plan?.billingInterval === "annual" ? 365 : 30),
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
    const purchase = sessionId ? findPassPurchaseForSession(sessionId, object) : undefined;
    if (purchase) transitionPurchase(purchase, "failed");
    return ack("Payment failure recorded.");
  }

  if (event.type === "checkout.session.expired") {
    const sessionId = typeof object.id === "string" ? object.id : null;
    const purchase = sessionId ? findPassPurchaseForSession(sessionId, object) : undefined;
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

// Pass purchases are matched primarily by session id (providerOrderId) with
// the metadata purchase id as belt-and-braces.
function findPassPurchaseForSession(
  sessionId: string,
  object: Record<string, unknown>
): PurchaseRecord | undefined {
  const byOrder = findPurchaseByProviderOrderId(sessionId);
  if (byOrder && byOrder.kind === "pass_pack") return byOrder;
  const metadataId = readMetadataPurchaseId(object);
  if (metadataId) {
    const byId = findPurchaseById(metadataId);
    if (byId && byId.kind === "pass_pack") return byId;
  }
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

function readMetadataPurchaseId(object: Record<string, unknown>): string | null {
  const metadata = object.metadata;
  if (typeof metadata === "object" && metadata !== null) {
    const id = (metadata as Record<string, unknown>).purchase_id;
    if (typeof id === "string" && id.trim()) return id;
  }
  return null;
}
