// Revolut-specific integration. Nothing outside lib/providers/ should know
// about Revolut's request/response shapes, header names, or API version —
// lib/billing.ts is the provider-neutral surface the rest of the app uses.
//
// Based on Revolut's published Merchant API docs (developer.revolut.com/docs/merchant):
//   - Customers: POST {baseUrl}/api/1.0/customers — creates a Customer record
//     that Revolut uses to attach saved payment methods for recurring billing.
//   - Subscriptions: POST {baseUrl}/api/1.0/subscriptions — creates a
//     recurring subscription linked to a Customer. Returns a setup_order_id;
//     the member pays via the hosted checkout URL from that setup order, which
//     also saves their payment method for future auto-charges.
//   - Orders: POST {baseUrl}/api/orders (kept for legacy/fallback use).
//   - Webhooks: SUBSCRIPTION_INITIATED fires at the start of each billing
//     period (including the first, after setup payment); SUBSCRIPTION_OVERDUE,
//     SUBSCRIPTION_CANCELLED, SUBSCRIPTION_FINISHED for lifecycle changes.
//     All events are HMAC-SHA256 signed — see revolut-webhook.ts.
//
// NOTE: The /api/1.0/subscriptions endpoint and its exact request/response
// shape should be verified against developer.revolut.com/docs/merchant/subscriptions
// before going live. The implementation below uses the best-documented shape
// but has not been tested against a live Revolut sandbox account.

const DEFAULT_API_VERSION = "2024-09-01";
// Plan pricing is denominated in EUR throughout the app — see lib/billing.ts.
const DEFAULT_CURRENCY = "EUR";

function getSecretKey(): string | null {
  return process.env.REVOLUT_SECRET_KEY?.trim() || null;
}

export function isRevolutConfigured(): boolean {
  return getSecretKey() !== null;
}

function getBaseUrl(): string {
  const env = process.env.REVOLUT_ENV?.trim().toLowerCase();
  return env === "production"
    ? "https://merchant.revolut.com"
    : "https://sandbox-merchant.revolut.com";
}

function getApiVersion(): string {
  return process.env.REVOLUT_API_VERSION?.trim() || DEFAULT_API_VERSION;
}

const ISO_4217_PATTERN = /^[A-Z]{3}$/;

// Fail loudly on a malformed currency env var rather than silently sending
// Revolut a value it will reject (or worse, one it accepts unexpectedly).
function getCurrency(): string {
  const value = process.env.REVOLUT_CURRENCY?.trim().toUpperCase() || DEFAULT_CURRENCY;

  if (!ISO_4217_PATTERN.test(value)) {
    throw new Error(
      `REVOLUT_CURRENCY must be a 3-letter ISO 4217 code (e.g. "USD"), got "${value}".`
    );
  }

  return value;
}

export interface RevolutOrderResult {
  ok: true;
  orderId: string;
  checkoutUrl: string;
}

export interface RevolutOrderError {
  ok: false;
  message: string;
}

export interface RevolutCustomerResult {
  ok: true;
  customerId: string;
}

export interface RevolutCustomerError {
  ok: false;
  message: string;
}

// Creates a Revolut Customer record. The customer ID is stored on the
// subscription so it can be reused on subsequent checkouts, avoiding
// duplicate customer records in Revolut for the same member.
export async function createRevolutCustomer(
  email: string
): Promise<RevolutCustomerResult | RevolutCustomerError> {
  const secretKey = getSecretKey();
  if (!secretKey) return { ok: false, message: "Revolut is not configured." };

  try {
    const res = await fetch(`${getBaseUrl()}/api/1.0/customers`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Revolut-Api-Version": getApiVersion(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email }),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      return {
        ok: false,
        message: `Revolut customer creation failed (${res.status}): ${errorBody.slice(0, 200)}`,
      };
    }

    const data = (await res.json()) as { id?: string };
    if (!data.id) {
      return { ok: false, message: "Revolut customer response was missing an id." };
    }

    return { ok: true, customerId: data.id };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Revolut customer request failed.",
    };
  }
}

export interface RevolutSubscriptionResult {
  ok: true;
  subscriptionId: string;
  // null when Revolut returns checkout_url directly in the subscription
  // response rather than as a separate setup order.
  setupOrderId: string | null;
  checkoutUrl: string;
}

export interface RevolutSubscriptionError {
  ok: false;
  message: string;
}

// Retrieves the hosted checkout URL for a Revolut setup order. Called after
// createRevolutSubscription to get the URL the member is redirected to for
// the first payment (which also saves their payment method for auto-renewal).
async function getRevolutSetupOrderCheckoutUrl(
  setupOrderId: string
): Promise<{ ok: true; checkoutUrl: string } | { ok: false; message: string }> {
  const secretKey = getSecretKey();
  if (!secretKey) return { ok: false, message: "Revolut is not configured." };

  try {
    const res = await fetch(`${getBaseUrl()}/api/orders/${setupOrderId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Revolut-Api-Version": getApiVersion(),
      },
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      return {
        ok: false,
        message: `Revolut setup order fetch failed (${res.status}): ${errorBody.slice(0, 200)}`,
      };
    }

    const data = (await res.json()) as { checkout_url?: string };
    if (!data.checkout_url) {
      return { ok: false, message: "Revolut setup order response was missing a checkout URL." };
    }

    return { ok: true, checkoutUrl: data.checkout_url };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Revolut setup order fetch failed.",
    };
  }
}

// Creates a Revolut recurring subscription linked to an existing Customer.
// Revolut returns a setup_order_id; we fetch its checkout URL so the member
// can complete the first payment (which also saves their payment method for
// subsequent auto-renewal charges).
//
// NOTE: Verify endpoint and request body shape against
// developer.revolut.com/docs/merchant/subscriptions before going live.
export async function createRevolutSubscription(input: {
  customerId: string;
  amountCents: number;
  billingIntervalMonths: number;
  internalReference: string;
}): Promise<RevolutSubscriptionResult | RevolutSubscriptionError> {
  const secretKey = getSecretKey();
  if (!secretKey) return { ok: false, message: "Revolut is not configured." };

  try {
    const res = await fetch(`${getBaseUrl()}/api/1.0/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Revolut-Api-Version": getApiVersion(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customer_id: input.customerId,
        currency: getCurrency(),
        amount: input.amountCents,
        billing_period: { unit: "MONTH", count: input.billingIntervalMonths },
        merchant_order_ext_ref: input.internalReference,
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      return {
        ok: false,
        message: `Revolut subscription creation failed (${res.status}): ${errorBody.slice(0, 200)}`,
      };
    }

    const data = (await res.json()) as {
      id?: string;
      setup_order_id?: string;
      checkout_url?: string;
    };

    if (!data.id) {
      return { ok: false, message: "Revolut subscription response was missing an id." };
    }

    // Some Revolut API versions return checkout_url directly on the
    // subscription object. Prefer that over a second round-trip to fetch the
    // setup order's checkout URL.
    if (data.checkout_url) {
      return {
        ok: true,
        subscriptionId: data.id,
        setupOrderId: data.setup_order_id ?? null,
        checkoutUrl: data.checkout_url,
      };
    }

    if (!data.setup_order_id) {
      return {
        ok: false,
        message: "Revolut subscription response was missing both checkout_url and setup_order_id.",
      };
    }

    const orderResult = await getRevolutSetupOrderCheckoutUrl(data.setup_order_id);
    if (!orderResult.ok) {
      return orderResult;
    }

    return {
      ok: true,
      subscriptionId: data.id,
      setupOrderId: data.setup_order_id,
      checkoutUrl: orderResult.checkoutUrl,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Revolut subscription request failed.",
    };
  }
}

// Creates a Revolut order for a single billing period and returns the
// hosted checkout URL the member should be redirected to. Returns ok:false
// (never throws) on any network/API failure so callers can show an honest
// error instead of a fake success state.
export async function createRevolutOrder(input: {
  amountCents: number;
  internalReference: string;
  customerEmail: string;
}): Promise<RevolutOrderResult | RevolutOrderError> {
  const secretKey = getSecretKey();

  if (!secretKey) {
    return { ok: false, message: "Revolut is not configured." };
  }

  try {
    const res = await fetch(`${getBaseUrl()}/api/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Revolut-Api-Version": getApiVersion(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: input.amountCents,
        currency: getCurrency(),
        merchant_order_ext_ref: input.internalReference,
        customer_email: input.customerEmail,
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      return {
        ok: false,
        message: `Revolut order creation failed (${res.status}): ${errorBody.slice(0, 200)}`,
      };
    }

    const data = (await res.json()) as { id?: string; checkout_url?: string };

    if (!data.id || !data.checkout_url) {
      return { ok: false, message: "Revolut response was missing an order id or checkout URL." };
    }

    return { ok: true, orderId: data.id, checkoutUrl: data.checkout_url };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Revolut request failed.",
    };
  }
}
