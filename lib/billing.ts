// Provider-neutral billing surface. App code (API routes, UI) should only
// import from this file, never from lib/providers/* directly — that keeps
// provider-specific payload shapes contained to one place and makes it
// possible to swap providers later without touching the rest of the app.
//
// Revolut is the active provider (see lib/providers/revolut.ts). It is
// configured when REVOLUT_SECRET_KEY is set; it is not set in this
// environment, so isBillingProviderConfigured() returns false and
// createCheckoutForPlan() returns a "not configured" result rather than
// faking a successful checkout. See docs/billing-revolut.md for what's
// needed to make it live.

import type {
  BillingProvider,
  MembershipBillingOptionRecord,
  MembershipPlanRecord,
} from "./db";
import {
  createRevolutCustomer,
  createRevolutOrder,
  createRevolutSubscription,
  isRevolutConfigured,
} from "./providers/revolut";
import { isRevolutWebhookConfigured } from "./providers/revolut-webhook";
import {
  cancelStripeSubscription,
  createStripeCatalogCheckout,
  createStripePassCheckout,
  createStripeSubscriptionCheckout,
  isStripeConfigured,
  pauseStripeSubscription,
  resumeStripeSubscription,
} from "./providers/stripe";
import { isStripeWebhookConfigured } from "./providers/stripe-webhook";

// Stripe is the primary provider; Revolut remains as a configured fallback
// so existing sandbox setups keep working. Selection is by configuration:
// whichever provider has its secret key set wins, Stripe first.
export function activeBillingProvider(): BillingProvider {
  if (isStripeConfigured()) return "stripe";
  if (isRevolutConfigured()) return "revolut";
  return "none";
}

export function isBillingProviderConfigured(): boolean {
  return activeBillingProvider() !== "none";
}

// A provider can be "half-configured" — checkout works (secret key set) but
// the webhook can't be verified (signing secret missing), so subscriptions
// would get stuck "pending" forever with no visible cause. Surfaced to
// staff on the Plans page so this doesn't fail silently in a live setup.
export function getBillingConfigurationStatus(): {
  checkoutConfigured: boolean;
  webhookConfigured: boolean;
} {
  const provider = activeBillingProvider();
  return {
    checkoutConfigured: provider !== "none",
    webhookConfigured:
      provider === "stripe"
        ? isStripeWebhookConfigured()
        : provider === "revolut"
          ? isRevolutWebhookConfigured()
          : false,
  };
}

// Plan pricing is denominated in EUR throughout the app.
export function formatPriceCents(priceCents: number): string {
  return `€${(priceCents / 100).toFixed(2)}`;
}

// How long a "pending" checkout (created but never paid) is treated as
// still in progress before a member is allowed to retry. Without this, an
// abandoned checkout would lock a member out of that plan forever, since
// only a webhook event can otherwise move status off "pending".
export const PENDING_CHECKOUT_STALE_AFTER_MS = 30 * 60 * 1000;

export function isPendingCheckoutStale(updatedAt: string): boolean {
  return Date.now() - new Date(updatedAt).getTime() > PENDING_CHECKOUT_STALE_AFTER_MS;
}

// Stripe-native recurring mapping: Stripe owns period arithmetic (month
// boundaries, leap years); the app never does day-count billing math.
// Quarterly = a 3-month recurring interval, per Stripe's supported model.
export function stripeRecurringInterval(billingInterval: MembershipPlanRecord["billingInterval"]): {
  interval: "month" | "year";
  intervalCount: number;
} {
  if (billingInterval === "annual") return { interval: "year", intervalCount: 1 };
  if (billingInterval === "quarterly") return { interval: "month", intervalCount: 3 };
  return { interval: "month", intervalCount: 1 };
}

export interface CheckoutResult {
  provider: BillingProvider;
  checkoutUrl: string | null;
  // Revolut subscription ID — what SUBSCRIPTION_* webhook events carry as
  // order_id. Stored in providerSubscriptionId on the subscription record.
  providerSubscriptionId: string | null;
  // Revolut setup order ID — the one-time order for the first payment.
  // Stored separately so providerSubscriptionId stays clean for webhook lookup.
  providerSetupOrderId: string | null;
  providerCustomerId: string | null;
  error: string | null;
}

export async function createCheckoutForPlan(input: {
  member: { id: string; email: string };
  plan: MembershipPlanRecord;
  // Pass the member's existing Revolut Customer ID (if any) to avoid creating
  // duplicate customer records for the same member across multiple checkouts.
  existingCustomerId?: string | null;
}): Promise<CheckoutResult> {
  const provider = activeBillingProvider();

  if (provider === "none") {
    return {
      provider: "none",
      checkoutUrl: null,
      providerSubscriptionId: null,
      providerSetupOrderId: null,
      providerCustomerId: null,
      error: null,
    };
  }

  if (provider === "stripe") {
    // Stripe: the subscription id only exists after payment; the session id
    // is stored (providerSetupOrderId) so the checkout.session.completed
    // webhook can find this subscription row and attach the real ids.
    const recurring = stripeRecurringInterval(input.plan.billingInterval);
    const result = await createStripeSubscriptionCheckout({
      amountCents: input.plan.priceCents,
      planName: input.plan.name,
      interval: recurring.interval,
      intervalCount: recurring.intervalCount,
      internalReference: `${input.member.id}:${input.plan.id}:${Date.now()}`,
      customerEmail: input.member.email,
    });

    if (!result.ok) {
      return {
        provider: "stripe",
        checkoutUrl: null,
        providerSubscriptionId: null,
        providerSetupOrderId: null,
        providerCustomerId: null,
        error: result.message,
      };
    }

    return {
      provider: "stripe",
      checkoutUrl: result.checkoutUrl,
      providerSubscriptionId: null,
      providerSetupOrderId: result.sessionId,
      providerCustomerId: input.existingCustomerId ?? null,
      error: null,
    };
  }

  let customerId = input.existingCustomerId ?? null;

  if (!customerId) {
    const customerResult = await createRevolutCustomer(input.member.email);
    if (!customerResult.ok) {
      return {
        provider: "revolut",
        checkoutUrl: null,
        providerSubscriptionId: null,
        providerSetupOrderId: null,
        providerCustomerId: null,
        error: customerResult.message,
      };
    }
    customerId = customerResult.customerId;
  }

  const billingIntervalMonths =
    input.plan.billingInterval === "annual" ? 12 : input.plan.billingInterval === "quarterly" ? 3 : 1;

  const result = await createRevolutSubscription({
    customerId,
    amountCents: input.plan.priceCents,
    billingIntervalMonths,
    internalReference: `${input.member.id}:${input.plan.id}:${Date.now()}`,
  });

  if (!result.ok) {
    return {
      provider: "revolut",
      checkoutUrl: null,
      providerSubscriptionId: null,
      providerSetupOrderId: null,
      providerCustomerId: customerId,
      error: result.message,
    };
  }

  return {
    provider: "revolut",
    checkoutUrl: result.checkoutUrl,
    providerSubscriptionId: result.subscriptionId,
    providerSetupOrderId: result.setupOrderId,
    providerCustomerId: customerId,
    error: null,
  };
}

export interface PassCheckoutResult {
  provider: BillingProvider;
  /** Stripe checkout session id / Revolut order id. */
  providerOrderId: string | null;
  checkoutUrl: string | null;
  error: string | null;
}

// Generic one-off (payment-mode) checkout — anything webhook-confirmed
// through a PurchaseRecord.
export async function createOneOffCheckout(input: {
  member: { id: string; email: string };
  productName: string;
  amountCents: number;
  purchaseId: string;
}): Promise<PassCheckoutResult> {
  const provider = activeBillingProvider();

  if (provider === "stripe") {
    const result = await createStripePassCheckout({
      amountCents: input.amountCents,
      productName: input.productName,
      purchaseId: input.purchaseId,
      customerEmail: input.member.email,
    });
    if (!result.ok) {
      return { provider: "stripe", providerOrderId: null, checkoutUrl: null, error: result.message };
    }
    return {
      provider: "stripe",
      providerOrderId: result.sessionId,
      checkoutUrl: result.checkoutUrl,
      error: null,
    };
  }

  if (provider === "revolut") {
    const result = await createRevolutOrder({
      amountCents: input.amountCents,
      internalReference: input.purchaseId,
      customerEmail: input.member.email,
    });
    if (!result.ok) {
      return { provider: "revolut", providerOrderId: null, checkoutUrl: null, error: result.message };
    }
    return {
      provider: "revolut",
      providerOrderId: result.orderId,
      checkoutUrl: result.checkoutUrl,
      error: null,
    };
  }

  return { provider: "none", providerOrderId: null, checkoutUrl: null, error: "No payment provider is configured." };
}

// ── Catalog checkout: the ONE place the price-vs-inline decision lives ──
//
// A billing option is turned into Stripe line-item params here so no route
// duplicates this logic. Stored stripePriceId wins (the Product+Price model
// we want in production); otherwise we build inline price_data straight from
// the option record so local/sandbox works with zero Stripe dashboard setup.
// To later REQUIRE price ids everywhere, delete the inline branch and reject
// options without an id — callers don't change.
function getCurrencyFor(option: MembershipBillingOptionRecord): string {
  return (option.currency || process.env.STRIPE_CURRENCY || "eur").trim().toLowerCase();
}

export function resolveCheckoutLineItem(input: {
  option: MembershipBillingOptionRecord;
  productName: string;
}): { mode: "subscription" | "payment"; lineItemParams: Record<string, string>; usedPriceId: boolean } {
  const { option } = input;
  const mode = option.billingType === "recurring" ? "subscription" : "payment";

  // Preferred path: a real Stripe Price id.
  if (option.stripePriceId && option.stripePriceId.trim()) {
    return {
      mode,
      usedPriceId: true,
      lineItemParams: {
        "line_items[0][price]": option.stripePriceId.trim(),
        "line_items[0][quantity]": "1",
      },
    };
  }

  // Fallback path: inline price_data derived from the option record.
  const params: Record<string, string> = {
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": getCurrencyFor(option),
    "line_items[0][price_data][unit_amount]": String(option.amountCents),
    "line_items[0][price_data][product_data][name]": input.productName,
  };
  if (option.billingType === "recurring") {
    params["line_items[0][price_data][recurring][interval]"] =
      option.intervalUnit === "year" ? "year" : "month";
    params["line_items[0][price_data][recurring][interval_count]"] = String(
      option.intervalCount ?? 1
    );
  }
  return { mode, usedPriceId: false, lineItemParams: params };
}

// Cancels a member's previous provider subscription after a switch confirms.
// Provider-neutral surface; only Stripe is implemented (the only provider with
// live recurring subscriptions here). Manual ("none") subs have no external
// subscription to cancel — the app record is simply replaced. Best-effort;
// returns the error for logging without throwing.
export async function cancelProviderSubscription(input: {
  provider: BillingProvider;
  providerSubscriptionId: string;
}): Promise<{ ok: boolean; message: string | null }> {
  if (input.provider !== "stripe") return { ok: true, message: null };
  const result = await cancelStripeSubscription(input.providerSubscriptionId);
  return result.ok ? { ok: true, message: null } : { ok: false, message: result.message };
}

// Pause/resume are Stripe-only at the provider level — other providers (or
// manual/no provider) have no live billing to touch, so they no-op success.
// Access is still blocked locally either way: it's driven by subscription
// status, not by whether a provider call happened.
export async function pauseProviderSubscription(input: {
  provider: BillingProvider;
  providerSubscriptionId: string;
  resumesAtUnixSeconds: number;
}): Promise<{ ok: boolean; message: string | null }> {
  if (input.provider !== "stripe") return { ok: true, message: null };
  const result = await pauseStripeSubscription(input.providerSubscriptionId, input.resumesAtUnixSeconds);
  return result.ok ? { ok: true, message: null } : { ok: false, message: result.message };
}

export async function resumeProviderSubscription(input: {
  provider: BillingProvider;
  providerSubscriptionId: string;
}): Promise<{ ok: boolean; message: string | null }> {
  if (input.provider !== "stripe") return { ok: true, message: null };
  const result = await resumeStripeSubscription(input.providerSubscriptionId);
  return result.ok ? { ok: true, message: null } : { ok: false, message: result.message };
}

export interface CatalogCheckoutResult {
  provider: BillingProvider;
  mode: "subscription" | "payment";
  /** Stripe checkout session id (stored as setup-order id / provider order id). */
  sessionId: string | null;
  checkoutUrl: string | null;
  error: string | null;
}

// Creates the hosted checkout for a catalog billing option. Recurring →
// subscription mode; one-time → payment mode. Stripe only (the catalog is a
// Stripe-first surface); returns a "not configured" error otherwise.
export async function createCatalogCheckout(input: {
  member: { id: string; email: string };
  option: MembershipBillingOptionRecord;
  productName: string;
  /** Pending subscription setup-order id (recurring) or purchase id (one-time). */
  reference: string;
}): Promise<CatalogCheckoutResult> {
  const provider = activeBillingProvider();

  if (provider !== "stripe") {
    return {
      provider,
      mode: input.option.billingType === "recurring" ? "subscription" : "payment",
      sessionId: null,
      checkoutUrl: null,
      error: "Online checkout isn't configured.",
    };
  }

  const { mode, lineItemParams, usedPriceId } = resolveCheckoutLineItem({
    option: input.option,
    productName: input.productName,
  });

  if (!usedPriceId) {
    console.info("[catalog checkout] no stripePriceId on option, using inline price_data", {
      optionId: input.option.id,
    });
  }

  const result = await createStripeCatalogCheckout({
    mode,
    lineItemParams,
    reference: input.reference,
    customerEmail: input.member.email,
  });

  if (!result.ok) {
    return { provider: "stripe", mode, sessionId: null, checkoutUrl: null, error: result.message };
  }
  return { provider: "stripe", mode, sessionId: result.sessionId, checkoutUrl: result.checkoutUrl, error: null };
}
