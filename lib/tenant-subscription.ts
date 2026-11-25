// A tenant gym paying S&C for the platform, through S&C's OWN Stripe account (the same account the rest of the site uses; it is never a gym's own Stripe). Three things:
//   1. a Stripe customer for the gym (created once, remembered on the gym as platformBilling.stripeCustomerId, which is how the webhook finds the gym later),
//   2. a Checkout Session in subscription mode for the one platform price,
//   3. a Customer Portal session so the gym can update its card, see invoices or cancel.
// Money only ever moves in Stripe. The paid-through date is moved by the invoice.paid webhook (app/api/webhooks/tenant-billing), never by the page the gym returns to.
//
// Set up in Stripe (once): a Product with one recurring Price, its id in TENANT_PLATFORM_PRICE_ID; the Customer Portal switched on; a webhook endpoint for
// /api/webhooks/tenant-billing sending invoice.paid, whose signing secret is TENANT_BILLING_WEBHOOK_SECRET. Optional: TENANT_TRIAL_DAYS (a free trial before the first charge).
import { getConfiguredAppUrl, getConfiguredStripeSecretKey } from "./app-config";
import type { GymRecord } from "./gyms-schema";
import { bandForCount, tenantPriceMap, type TenantBand, type TenantInterval } from "./tenant-pricing";

const STRIPE_API_BASE = "https://api.stripe.com/v1";

export function tenantSubscriptionConfigured(): boolean {
  return Boolean(getConfiguredStripeSecretKey() && (tenantPriceMap() || process.env.TENANT_PLATFORM_PRICE_ID?.trim()));
}

function trialDays(): number {
  const n = Number(process.env.TENANT_TRIAL_DAYS ?? "0");
  return Number.isInteger(n) && n > 0 && n <= 90 ? n : 0;
}

function baseUrl(): string {
  return (getConfiguredAppUrl() ?? "http://localhost:3000").replace(/\/$/, "");
}

type Result<T> = ({ ok: true } & T) | { ok: false; message: string };

async function stripePost(path: string, params: Record<string, string>, idempotencyKey?: string): Promise<Result<{ data: Record<string, unknown> }>> {
  const key = getConfiguredStripeSecretKey();
  if (!key) return { ok: false, message: "Payments are not set up yet." };
  try {
    const res = await fetch(`${STRIPE_API_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: new URLSearchParams(params).toString(),
    });
    if (!res.ok) {
      console.warn(`[tenant subscription] Stripe ${path} failed (${res.status})`);
      return { ok: false, message: "The payment provider could not start that. Try again in a moment." };
    }
    return { ok: true, data: (await res.json()) as Record<string, unknown> };
  } catch {
    return { ok: false, message: "Could not reach the payment provider. Try again in a moment." };
  }
}

/** Creates the gym's Stripe customer. Idempotent per gym, so a double click cannot create two. */
export async function createTenantCustomer(gym: Pick<GymRecord, "id" | "name">, email: string): Promise<Result<{ customerId: string }>> {
  const res = await stripePost("/customers", { email, name: gym.name, "metadata[gym_id]": gym.id }, `tenant-customer:${gym.id}`);
  if (!res.ok) return res;
  const id = res.data.id;
  return typeof id === "string" && id.startsWith("cus_") ? { ok: true, customerId: id } : { ok: false, message: "The payment provider sent an unexpected reply." };
}

/** The Stripe price for a size band and interval: from TENANT_PRICES when it is set, else the single TENANT_PLATFORM_PRICE_ID (one price for every gym). */
export function priceIdFor(interval: TenantInterval, band: TenantBand): string | null {
  const map = tenantPriceMap();
  if (map) return map[interval][band];
  return process.env.TENANT_PLATFORM_PRICE_ID?.trim() || null;
}

export async function createTenantCheckout(gym: Pick<GymRecord, "id">, customerId: string, interval: TenantInterval = "month", memberCount = 0): Promise<Result<{ url: string }>> {
  const price = priceIdFor(interval, bandForCount(memberCount));
  if (!price) return { ok: false, message: "Payments are not set up yet." };
  const days = trialDays();
  const res = await stripePost("/checkout/sessions", {
    mode: "subscription",
    customer: customerId,
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    "metadata[gym_id]": gym.id,
    "subscription_data[metadata][gym_id]": gym.id,
    "subscription_data[metadata][band]": bandForCount(memberCount),
    "subscription_data[metadata][interval]": interval,
    ...(days ? { "subscription_data[trial_period_days]": String(days) } : {}),
    allow_promotion_codes: "true",
    success_url: `${baseUrl()}/staff/gym-setup?subscription=success`,
    cancel_url: `${baseUrl()}/staff/gym-setup?subscription=cancelled`,
  });
  if (!res.ok) return res;
  const url = res.data.url;
  return typeof url === "string" && url.startsWith("https://") ? { ok: true, url } : { ok: false, message: "The payment provider sent an unexpected reply." };
}

export async function createTenantPortal(customerId: string): Promise<Result<{ url: string }>> {
  const res = await stripePost("/billing_portal/sessions", { customer: customerId, return_url: `${baseUrl()}/staff/gym-setup` });
  if (!res.ok) return res;
  const url = res.data.url;
  return typeof url === "string" && url.startsWith("https://") ? { ok: true, url } : { ok: false, message: "The payment provider sent an unexpected reply." };
}

// ---- The 14-day money-back (owner decision 2026-11-25) -------------------------------------------------------------------------------------------------------------------
// Only a platform operator can do this (app/api/staff/gyms/[gymId]/refund), only within REFUND_WINDOW_DAYS of the gym's first payment, and it refunds the latest paid
// charge, cancels the subscription, and ends the gym's paid time so access stops. Nothing is deleted.
export const REFUND_WINDOW_DAYS = 14;

/** The last day (YYYY-MM-DD) a gym that first paid at `firstPaidAt` can still be refunded, or null when it has not paid. */
export function refundableUntil(firstPaidAt: string | undefined): string | null {
  if (!firstPaidAt) return null;
  const t = new Date(firstPaidAt).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + REFUND_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
}

async function stripeRequest(method: "GET" | "DELETE", path: string): Promise<Result<{ data: Record<string, unknown> }>> {
  const key = getConfiguredStripeSecretKey();
  if (!key) return { ok: false, message: "Payments are not set up yet." };
  try {
    const res = await fetch(`${STRIPE_API_BASE}${path}`, { method, headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) return { ok: false, message: "The payment provider could not do that. Check Stripe." };
    return { ok: true, data: (await res.json()) as Record<string, unknown> };
  } catch {
    return { ok: false, message: "Could not reach the payment provider." };
  }
}

/** Refunds the customer's latest paid, not-yet-refunded charge in full and cancels their subscriptions. */
export async function refundAndCancel(customerId: string): Promise<Result<{ refundedChargeId: string }>> {
  const charges = await stripeRequest("GET", `/charges?customer=${encodeURIComponent(customerId)}&limit=10`);
  if (!charges.ok) return charges;
  const list = (charges.data.data ?? []) as Array<{ id?: string; paid?: boolean; refunded?: boolean; amount_refunded?: number }>;
  const charge = list.find((c) => c.paid && !c.refunded && !c.amount_refunded && typeof c.id === "string");
  if (!charge?.id) return { ok: false, message: "There is no paid charge left to refund for this gym." };

  const refund = await stripePost("/refunds", { charge: charge.id }, `tenant-refund:${charge.id}`);
  if (!refund.ok) return refund;

  const subs = await stripeRequest("GET", `/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=10`);
  if (subs.ok) {
    for (const s of (subs.data.data ?? []) as Array<{ id?: string; status?: string }>) {
      if (typeof s.id === "string" && s.status !== "canceled") await stripeRequest("DELETE", `/subscriptions/${encodeURIComponent(s.id)}`);
    }
  }
  return { ok: true, refundedChargeId: charge.id };
}

// ---- Size-based pricing: keeping a gym on the right band ----------------------------------------------------------------------------------------------------------------
/** Monthly or yearly, from the length of the period an invoice paid for. */
export function intervalFromPeriod(startSec: number, endSec: number): TenantInterval {
  return endSec - startSec > 60 * 86_400 ? "year" : "month";
}

/**
 * After a renewal: if the band for the next period (the highest member count of the period just ended, see lib/tenant-pricing.ts) differs from the band the gym is on,
 * move its subscription to that band's price from the next invoice, with no proration. Returns the band the gym now pays for. A failed Stripe call keeps the old band so
 * the next renewal tries again.
 */
export async function moveSubscriptionToBand(customerId: string, interval: TenantInterval, currentBand: TenantBand | undefined, nextBand: TenantBand): Promise<TenantBand> {
  if (currentBand === nextBand || !tenantPriceMap()) return currentBand ?? nextBand;
  const price = priceIdFor(interval, nextBand);
  if (!price) return currentBand ?? nextBand;
  const subs = await stripeRequest("GET", `/subscriptions?customer=${encodeURIComponent(customerId)}&status=active&limit=1`);
  if (!subs.ok) return currentBand ?? nextBand;
  const sub = ((subs.data.data ?? []) as Array<{ id?: string; items?: { data?: Array<{ id?: string }> } }>)[0];
  const itemId = sub?.items?.data?.[0]?.id;
  if (!sub?.id || !itemId) return currentBand ?? nextBand;
  const res = await stripePost(`/subscriptions/${encodeURIComponent(sub.id)}`, { "items[0][id]": itemId, "items[0][price]": price, proration_behavior: "none", "metadata[band]": nextBand }, `tenant-band:${sub.id}:${nextBand}:${new Date().toISOString().slice(0, 7)}`);
  return res.ok ? nextBand : (currentBand ?? nextBand);
}
