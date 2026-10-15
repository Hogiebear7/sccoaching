// Cross-provider rules for a GYM Membership: a Stripe or Revolut event must never overwrite a live Membership billed by the other,
// and the same provider stays idempotent. Since owner decision D1 (2026-10-15) Google Play and App Store purchases are a
// separate digital entitlement that never shares a row with a Membership, so the last section proves the two do not interact.
//
// Everything runs through the REAL route handlers, the REAL service and a REAL temporary datastore, with only the Google
// adapter faked. Webhooks are signed with throwaway test secrets generated here, not any real one. No network, no provider,
// no real token.
import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPlayFixture, type PlayFixture } from "../helpers/iap-play-fixture";

let fx: PlayFixture;
const DAY = 86_400_000;
const FUTURE = () => new Date(Date.now() + 30 * DAY).toISOString();
const PLAY_TOKEN = "fake-play-token-xp-1";
const PLAY_TOKEN_2 = "fake-play-token-xp-2";

const STRIPE_SECRET = "whsec_test_only_not_a_real_secret";
const REVOLUT_SECRET = "wsk_test_only_not_a_real_secret";
const savedEnv: Record<string, string | undefined> = {};

let eventCounter = 0;
async function stripe(type: string, object: Record<string, unknown>, id = `evt_test_${++eventCounter}`) {
  const { POST } = await import("@/app/api/stripe/webhook/route");
  const raw = JSON.stringify({ id, type, data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", STRIPE_SECRET).update(`${t}.${raw}`).digest("hex");
  return POST(new NextRequest("http://localhost/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": `t=${t},v1=${sig}` }, body: raw }));
}

async function revolut(event: string, orderId: string) {
  const { POST } = await import("@/app/api/billing/webhook/route");
  const raw = JSON.stringify({ event, order_id: orderId });
  const ts = String(Date.now());
  const sig = `v1=${createHmac("sha256", REVOLUT_SECRET).update(`v1.${ts}.${raw}`).digest("hex")}`;
  return POST(new NextRequest("http://localhost/api/billing/webhook", { method: "POST", headers: { "revolut-signature": sig, "revolut-request-timestamp": ts }, body: raw }));
}

const row = (userId = fx.memberA.id) => fx.db.findSubscriptionByUserId(userId)!;
const conflictEvents = () => fx.db.findIapEvents({ type: "provider_conflict_rejected" });
const checkoutCompleted = (sessionId: string, sub = "sub_incoming_1") => stripe("checkout.session.completed", { id: sessionId, mode: "subscription", subscription: sub, customer: "cus_incoming_1" });

beforeEach(async () => {
  for (const k of ["STRIPE_WEBHOOK_SECRET", "REVOLUT_WEBHOOK_SIGNING_SECRET"]) savedEnv[k] = process.env[k];
  process.env.STRIPE_WEBHOOK_SECRET = STRIPE_SECRET;
  process.env.REVOLUT_WEBHOOK_SIGNING_SECRET = REVOLUT_SECRET;
  fx = await createPlayFixture();
});
afterEach(() => {
  fx.cleanup();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("a live Stripe or Revolut Membership is never overwritten by the other provider", () => {
  it("rejects a Revolut event for a live Stripe row, and a Stripe event for a live Revolut row", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "active", provider: "stripe", providerSubscriptionId: "sub_live_stripe", currentPeriodEnd: FUTURE() });
    let before = row();
    await revolut("ORDER_COMPLETED", "sub_live_stripe");
    expect(row()).toEqual(before);

    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "active", provider: "revolut", providerSubscriptionId: "rev_live_order", currentPeriodEnd: FUTURE() });
    before = row();
    await stripe("invoice.paid", { id: "in_9", subscription: "rev_live_order", amount_paid: 100 });
    await stripe("customer.subscription.deleted", { id: "rev_live_order" });
    expect(row()).toEqual(before);
    expect(conflictEvents()).toHaveLength(3);
  });

  it("rejects a Stripe checkout completion for a row a different paid provider holds live, even when matched by setup order", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "active", provider: "revolut", providerSubscriptionId: "rev_live_order", providerSetupOrderId: "cs_setup_x", currentPeriodEnd: FUTURE() });
    const before = row();
    await checkoutCompleted("cs_setup_x");
    expect(row()).toEqual(before);
    expect(conflictEvents().at(-1)?.detail).toMatchObject({ existingProvider: "revolut", incomingProvider: "stripe" });
  });

  it.each(["active", "past_due", "paused"] as const)("a %s Stripe row refuses a Revolut event that carries its reference", async (status) => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status, provider: "stripe", providerSubscriptionId: "sub_protected", currentPeriodEnd: FUTURE() });
    const before = row();
    await revolut("ORDER_COMPLETED", "sub_protected");
    expect(row()).toEqual(before);
  });
});

describe("same-provider events stay idempotent and keep working", () => {
  it("Stripe: a repeated invoice for its own subscription, under different event ids, never regresses the period", async () => {
    const periodEnd = Math.floor((Date.now() + 60 * DAY) / 1000);
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "active", provider: "stripe", providerSubscriptionId: "sub_mine", currentPeriodEnd: FUTURE() });
    const invoice = { id: "in_dup", subscription: "sub_mine", amount_paid: 4900, currency: "eur", lines: { data: [{ period: { end: periodEnd } }] } };
    await stripe("invoice.paid", invoice, "evt_a");
    const afterFirst = row();
    await stripe("invoice.payment_succeeded", invoice, "evt_b");
    expect(row().currentPeriodEnd).toBe(afterFirst.currentPeriodEnd);
    expect(row()).toMatchObject({ provider: "stripe", status: "active", providerSubscriptionId: "sub_mine" });
    expect(conflictEvents()).toHaveLength(0);
  });

  it("Stripe: its own checkout completion activates a pending row and records provider stripe", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, billingOptionId: fx.ids.membershipOption, status: "pending", provider: "stripe", providerSetupOrderId: "cs_mine", currentPeriodEnd: null });
    await checkoutCompleted("cs_mine", "sub_new_mine");
    expect(row()).toMatchObject({ provider: "stripe", status: "active", providerSubscriptionId: "sub_new_mine", packageId: fx.ids.membershipPackage });
    expect(conflictEvents()).toHaveLength(0);
  });

  it("Revolut: its own event updates its own row, and a duplicate is ignored", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "pending", provider: "revolut", providerSubscriptionId: "rev_order_mine", currentPeriodEnd: null });
    expect((await revolut("ORDER_COMPLETED", "rev_order_mine")).status).toBe(200);
    expect(row()).toMatchObject({ provider: "revolut", status: "active" });
    const after = row();
    await revolut("ORDER_COMPLETED", "rev_order_mine");
    expect(row().providerSubscriptionId).toBe(after.providerSubscriptionId);
    expect(conflictEvents()).toHaveLength(0);
  });

  it("two Stripe completions of the same checkout, one retried, leave one consistent active row", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, billingOptionId: fx.ids.membershipOption, status: "pending", provider: "stripe", providerSetupOrderId: "cs_twice", currentPeriodEnd: null });
    const [a, b] = await Promise.all([checkoutCompleted("cs_twice", "sub_twice"), checkoutCompleted("cs_twice", "sub_twice")]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(row()).toMatchObject({ provider: "stripe", status: "active", providerSubscriptionId: "sub_twice" });
    expect(conflictEvents()).toHaveLength(0);
  });

  it("a manual row is taken over by the member's own web switch (provider none is not a paid provider)", async () => {
    fx.setSubscription(fx.memberA.id, {
      packageId: fx.ids.membershipPackage,
      status: "active",
      provider: "none",
      currentPeriodEnd: FUTURE(),
      pendingPackageId: fx.ids.membershipPackage,
      pendingBillingOptionId: fx.ids.membershipOption,
      pendingSetupOrderId: "cs_switch_manual",
      pendingStartedAt: new Date().toISOString(),
    });
    await stripe("checkout.session.completed", { id: "cs_switch_manual", mode: "subscription", subscription: "sub_switch", customer: "cus_s" });
    expect(row()).toMatchObject({ provider: "stripe", providerSubscriptionId: "sub_switch", status: "active" });
    expect(conflictEvents()).toHaveLength(0);
  });
});

describe("a store purchase and a Stripe/Revolut Membership never interact (owner decision D1)", () => {
  it.each(["stripe", "revolut"] as const)("a live %s Membership does not block a Play purchase, and the purchase leaves the Membership row byte-for-byte alone", async (provider) => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "active", provider, providerSubscriptionId: "sub_live_x", currentPeriodEnd: FUTURE() });
    const before = row();
    const res = await fx.claim(fx.memberA.id, PLAY_TOKEN);
    expect(res.status).toBe(200);
    expect(row()).toEqual(before);
    expect(conflictEvents()).toHaveLength(0);
    expect((await import("@/lib/membership-entitlement")).resolveMemberAccessForUser(fx.memberA.id)).toEqual({ digital: true, gymMembership: true });
  });

  it("a Stripe event for the Membership never changes the digital entitlement", async () => {
    await fx.claim(fx.memberA.id, PLAY_TOKEN, { expiryTimeMillis: Date.now() + 30 * DAY });
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "active", provider: "stripe", providerSubscriptionId: "sub_gym", currentPeriodEnd: FUTURE() });
    const before = fx.db.findDigitalEntitlement(fx.memberA.id, "google_play");
    await stripe("customer.subscription.deleted", { id: "sub_gym" });
    expect(fx.db.findDigitalEntitlement(fx.memberA.id, "google_play")).toEqual(before);
  });

  it("Google Play: a duplicate claim of its own token is idempotent", async () => {
    await fx.claim(fx.memberA.id, PLAY_TOKEN);
    const before = fx.db.findDigitalEntitlement(fx.memberA.id, "google_play");
    expect((await fx.verify(fx.memberA.id, { purchaseToken: PLAY_TOKEN })).status).toBe(200);
    expect(fx.db.findDigitalEntitlement(fx.memberA.id, "google_play")?.storeRefHash).toBe(before?.storeRefHash);
    expect(fx.db.findGooglePlayPurchasesByUserId(fx.memberA.id)).toHaveLength(1);
  });

  it("a second Play token on an account with a live Play plan is refused and binds nothing", async () => {
    await fx.claim(fx.memberA.id, PLAY_TOKEN);
    const res = await fx.claim(fx.memberA.id, PLAY_TOKEN_2);
    expect(res.status).toBe(409);
    expect(fx.db.findGooglePlayPurchaseByToken(PLAY_TOKEN_2)).toBeUndefined();
  });
});
