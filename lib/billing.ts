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

import type { BillingProvider, MembershipPlanRecord } from "./db";
import {
  createRevolutCustomer,
  createRevolutSubscription,
  isRevolutConfigured,
} from "./providers/revolut";
import { isRevolutWebhookConfigured } from "./providers/revolut-webhook";

export function isBillingProviderConfigured(): boolean {
  return isRevolutConfigured();
}

// A provider can be "half-configured" — checkout works (secret key set) but
// the webhook can't be verified (signing secret missing), so subscriptions
// would get stuck "pending" forever with no visible cause. Surfaced to
// staff on the Plans page so this doesn't fail silently in a live setup.
export function getBillingConfigurationStatus(): {
  checkoutConfigured: boolean;
  webhookConfigured: boolean;
} {
  return {
    checkoutConfigured: isRevolutConfigured(),
    webhookConfigured: isRevolutWebhookConfigured(),
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
  if (!isBillingProviderConfigured()) {
    return {
      provider: "none",
      checkoutUrl: null,
      providerSubscriptionId: null,
      providerSetupOrderId: null,
      providerCustomerId: null,
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
