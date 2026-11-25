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

const STRIPE_API_BASE = "https://api.stripe.com/v1";

export function tenantSubscriptionConfigured(): boolean {
  return Boolean(getConfiguredStripeSecretKey() && process.env.TENANT_PLATFORM_PRICE_ID?.trim());
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

export async function createTenantCheckout(gym: Pick<GymRecord, "id">, customerId: string): Promise<Result<{ url: string }>> {
  const price = process.env.TENANT_PLATFORM_PRICE_ID?.trim();
  if (!price) return { ok: false, message: "Payments are not set up yet." };
  const days = trialDays();
  const res = await stripePost("/checkout/sessions", {
    mode: "subscription",
    customer: customerId,
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    "metadata[gym_id]": gym.id,
    "subscription_data[metadata][gym_id]": gym.id,
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
