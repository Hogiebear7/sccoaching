// Stripe Merchant integration — REST via fetch, no SDK dependency (same
// zero-dep pattern as lib/providers/revolut.ts). Only lib/billing.ts may
// import from here. Secrets are read from env at call time and never leave
// the server.
//
// Correct-usage notes:
//  - One-off pass packs use Checkout Sessions in `payment` mode.
//  - Recurring memberships use Checkout Sessions in `subscription` mode
//    with inline recurring price_data.
//  - Every create call sends an Idempotency-Key derived from OUR internal
//    id, so a double submit that slips past the app's own duplicate guard
//    still cannot create two Stripe objects.
//  - metadata carries the internal purchase id on both the session and the
//    PaymentIntent, which is how refunds are correlated back.

import { getConfiguredAppUrl, getConfiguredStripeSecretKey } from "@/lib/app-config";

const STRIPE_API_BASE = "https://api.stripe.com/v1";

function getSecretKey(): string | null {
  const key = getConfiguredStripeSecretKey();
  return key ? key : null;
}

export function isStripeConfigured(): boolean {
  return getSecretKey() !== null;
}

function getCurrency(): string {
  return (process.env.STRIPE_CURRENCY ?? "eur").trim().toLowerCase();
}

function getAppBaseUrl(): string {
  return (getConfiguredAppUrl() ?? "http://localhost:3000").replace(/\/$/, "");
}

type StripeOk = { ok: true; sessionId: string; checkoutUrl: string };
type StripeErr = { ok: false; message: string };

async function createCheckoutSession(
  params: Record<string, string>,
  idempotencyKey: string
): Promise<StripeOk | StripeErr> {
  const secretKey = getSecretKey();
  if (!secretKey) return { ok: false, message: "Stripe is not configured." };

  try {
    const res = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": idempotencyKey,
      },
      body: new URLSearchParams(params).toString(),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      return {
        ok: false,
        message: `Stripe session creation failed (${res.status}): ${errorBody.slice(0, 200)}`,
      };
    }

    const data = (await res.json()) as { id?: string; url?: string };
    if (!data.id || !data.url) {
      return { ok: false, message: "Stripe response was missing a session id or URL." };
    }
    return { ok: true, sessionId: data.id, checkoutUrl: data.url };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Stripe request failed.",
    };
  }
}

// One-off class pass pack: Checkout Session in `payment` mode. The purchase
// id rides on the session, its metadata, and the PaymentIntent metadata.
export async function createStripePassCheckout(input: {
  amountCents: number;
  productName: string;
  purchaseId: string;
  customerEmail: string;
}): Promise<StripeOk | StripeErr> {
  const base = getAppBaseUrl();
  return createCheckoutSession(
    {
      mode: "payment",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": getCurrency(),
      "line_items[0][price_data][unit_amount]": String(input.amountCents),
      "line_items[0][price_data][product_data][name]": input.productName,
      client_reference_id: input.purchaseId,
      "metadata[purchase_id]": input.purchaseId,
      "payment_intent_data[metadata][purchase_id]": input.purchaseId,
      customer_email: input.customerEmail,
      success_url: `${base}/dashboard/membership?passes=pending`,
      cancel_url: `${base}/dashboard/membership?passes=cancelled`,
    },
    `pass:${input.purchaseId}`
  );
}

// Recurring membership: Checkout Session in `subscription` mode. The
// subscription id itself only exists after payment and arrives via the
// checkout.session.completed webhook.
export async function createStripeSubscriptionCheckout(input: {
  amountCents: number;
  planName: string;
  interval: "month" | "year";
  /** Stripe recurring interval_count — 3 with interval "month" = quarterly. */
  intervalCount?: number;
  internalReference: string;
  customerEmail: string;
}): Promise<StripeOk | StripeErr> {
  const base = getAppBaseUrl();
  return createCheckoutSession(
    {
      mode: "subscription",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": getCurrency(),
      "line_items[0][price_data][unit_amount]": String(input.amountCents),
      "line_items[0][price_data][recurring][interval]": input.interval,
      "line_items[0][price_data][recurring][interval_count]": String(input.intervalCount ?? 1),
      "line_items[0][price_data][product_data][name]": input.planName,
      client_reference_id: input.internalReference,
      "metadata[internal_ref]": input.internalReference,
      "subscription_data[metadata][internal_ref]": input.internalReference,
      customer_email: input.customerEmail,
      success_url: `${base}/dashboard/membership?membership=pending`,
      cancel_url: `${base}/dashboard/membership?membership=cancelled`,
    },
    `sub:${input.internalReference}`
  );
}

// Catalog checkout (Category → Package → Billing Option). The line-item is
// resolved upstream by lib/billing.ts `resolveCheckoutLineItem` — either a
// stored Stripe price id or inline price_data — so this function stays a thin
// mode/metadata shell and the price-vs-inline decision lives in ONE place.
export async function createStripeCatalogCheckout(input: {
  mode: "subscription" | "payment";
  /** Pre-resolved `line_items[0][...]` params (price id OR price_data). */
  lineItemParams: Record<string, string>;
  /** Our internal id — pending subscription setup-order id, or purchase id. */
  reference: string;
  customerEmail: string;
}): Promise<StripeOk | StripeErr> {
  const base = getAppBaseUrl();
  const isSubscription = input.mode === "subscription";

  const metadata: Record<string, string> = isSubscription
    ? {
        "metadata[internal_ref]": input.reference,
        "subscription_data[metadata][internal_ref]": input.reference,
      }
    : {
        "metadata[purchase_id]": input.reference,
        "payment_intent_data[metadata][purchase_id]": input.reference,
      };

  return createCheckoutSession(
    {
      mode: input.mode,
      ...input.lineItemParams,
      client_reference_id: input.reference,
      ...metadata,
      customer_email: input.customerEmail,
      success_url: `${base}/dashboard/membership?membership=pending`,
      cancel_url: `${base}/dashboard/membership?membership=cancelled`,
    },
    `${isSubscription ? "catsub" : "catbuy"}:${input.reference}`
  );
}

// Cancels a Stripe subscription immediately (DELETE /v1/subscriptions/{id}).
// Used when a switch is confirmed, so the member's PREVIOUS subscription can't
// keep billing alongside the new one. Best-effort by design: the caller has
// already promoted the new membership, so a cancel failure must not undo that —
// it's logged for staff to reconcile. Treats "already cancelled / not found"
// as success (idempotent under webhook retries).
export async function cancelStripeSubscription(
  subscriptionId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const secretKey = getSecretKey();
  if (!secretKey) return { ok: false, message: "Stripe is not configured." };

  try {
    const res = await fetch(`${STRIPE_API_BASE}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (res.ok) return { ok: true };
    // Already gone (404) or already cancelled — nothing left to bill.
    if (res.status === 404) return { ok: true };
    const body = await res.text().catch(() => "");
    if (body.includes("No such subscription") || body.includes("already been canceled")) {
      return { ok: true };
    }
    return { ok: false, message: `Stripe cancel failed (${res.status}): ${body.slice(0, 200)}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Stripe cancel request failed." };
  }
}
