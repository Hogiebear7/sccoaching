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

import type { BillingProvider, ClassPassProductRecord, MembershipPlanRecord } from "./db";
import {
  createRevolutCustomer,
  createRevolutOrder,
  createRevolutSubscription,
  isRevolutConfigured,
} from "./providers/revolut";
import { isRevolutWebhookConfigured } from "./providers/revolut-webhook";
import {
  createStripePassCheckout,
  createStripeSubscriptionCheckout,
  isStripeConfigured,
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
    const result = await createStripeSubscriptionCheckout({
      amountCents: input.plan.priceCents,
      planName: input.plan.name,
      interval: input.plan.billingInterval === "annual" ? "year" : "month",
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

  const billingIntervalMonths = input.plan.billingInterval === "annual" ? 12 : 1;

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

// One-off checkout for a class pass pack. The internal purchase id doubles
// as the provider idempotency key and the reconciliation reference.
export async function createPassPackCheckout(input: {
  member: { id: string; email: string };
  product: ClassPassProductRecord;
  purchaseId: string;
}): Promise<PassCheckoutResult> {
  const provider = activeBillingProvider();

  if (provider === "stripe") {
    const result = await createStripePassCheckout({
      amountCents: input.product.priceCents,
      productName: `${input.product.name} (${input.product.passCount} class passes)`,
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
      amountCents: input.product.priceCents,
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
