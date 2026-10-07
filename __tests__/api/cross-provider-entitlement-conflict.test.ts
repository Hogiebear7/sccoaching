// Cross-provider entitlement conflicts: a Stripe or Revolut completion must never overwrite a live Google Play entitlement,
// a live Stripe or Revolut entitlement must never be overwritten by another provider or by a Play claim, and the same
// provider stays idempotent.
//
// Everything runs through the REAL route handlers (Stripe webhook, Revolut webhook, Play verify, Play notifications), the
// REAL service and a REAL temporary datastore, with only the Google adapter faked. Webhooks are signed with throwaway
// test secrets generated here, not any real one. No network, no provider, no real token.
import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPlayFixture, type PlayFixture } from "../helpers/iap-play-fixture";

let fx: PlayFixture;
const DAY = 86_400_000;
const FUTURE = () => new Date(Date.now() + 30 * DAY).toISOString();
const PAST = () => new Date(Date.now() - 2 * DAY).toISOString();
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

/** A live Google Play entitlement, as the real claim path would have left it, including a stale setup-order id. */
async function livePlay(opts: { cancelledButPaid?: boolean } = {}) {
  await fx.claim(fx.memberA.id, PLAY_TOKEN, { expiryTimeMillis: Date.now() + 30 * DAY });
  if (opts.cancelledButPaid) {
    fx.adapter.setSnapshot(PLAY_TOKEN, { state: "SUBSCRIPTION_STATE_CANCELED", autoRenewing: false });
    await fx.rtdn(fx.subscriptionEvent(PLAY_TOKEN, 3));
  }
  // The hazard from the review: a Play row that still carries an old Stripe checkout reference.
  fx.db.saveSubscription({ ...row(), providerSetupOrderId: "cs_stale_setup", pendingSetupOrderId: "cs_stale_pending" });
  expect(row()).toMatchObject({ provider: "google_play", status: "active", providerSubscriptionId: PLAY_TOKEN });
}

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

describe("a live Google Play entitlement is never overwritten by Stripe", () => {
  it.each([
    ["checkout completion matched by the stale setup-order id", () => checkoutCompleted("cs_stale_setup")],
    ["switch completion matched by the stale pending-order id", () => checkoutCompleted("cs_stale_pending")],
    ["invoice.paid carrying the row's reference", () => stripe("invoice.paid", { id: "in_1", subscription: PLAY_TOKEN, amount_paid: 999, currency: "eur" })],
    ["invoice.payment_failed carrying the row's reference", () => stripe("invoice.payment_failed", { id: "in_2", subscription: PLAY_TOKEN })],
    ["customer.subscription.deleted carrying the row's reference", () => stripe("customer.subscription.deleted", { id: PLAY_TOKEN })],
  ])("rejects a %s and leaves the Play row, token and paid-through date untouched", async (_label, send) => {
    await livePlay();
    const before = row();
    const purchaseBefore = fx.db.findGooglePlayPurchaseByToken(PLAY_TOKEN);
    const eventsBefore = fx.db.findIapEvents().length;

    const res = await send();

    expect(res.status).toBe(200);
    expect((await res.json()).message).toBe("Not applied: another provider's subscription is already active.");
    expect(row()).toEqual(before);
    expect(row()).toMatchObject({ provider: "google_play", providerSubscriptionId: PLAY_TOKEN, status: "active" });
    expect(fx.db.findGooglePlayPurchaseByToken(PLAY_TOKEN)).toEqual(purchaseBefore);
    expect(fx.db.findIapEvents().length).toBe(eventsBefore + 1);
    expect(conflictEvents().at(-1)).toMatchObject({ provider: "stripe", userId: fx.memberA.id, detail: { code: "other_provider_active", incomingProvider: "stripe", existingProvider: "google_play", source: "stripe_webhook" } });
  });

  it("treats a cancelled-but-still-paid Play subscription as active until its paid-through date", async () => {
    await livePlay({ cancelledButPaid: true });
    expect(row().status).toBe("active");
    const before = row();
    await checkoutCompleted("cs_stale_setup");
    expect(row()).toEqual(before);
    expect(conflictEvents()).toHaveLength(1);
  });

  it("is idempotent when the same refused event is delivered again, and records the audit event once", async () => {
    await livePlay();
    const before = row();
    await stripe("checkout.session.completed", { id: "cs_stale_setup", mode: "subscription", subscription: "sub_x" }, "evt_same");
    const again = await stripe("checkout.session.completed", { id: "cs_stale_setup", mode: "subscription", subscription: "sub_x" }, "evt_same");
    expect((await again.json()).message).toBe("Event already processed.");
    expect(row()).toEqual(before);
    expect(conflictEvents()).toHaveLength(1);
  });

  it("keeps the earlier audit history intact", async () => {
    await livePlay();
    const history = fx.db.findIapEvents();
    await checkoutCompleted("cs_stale_setup");
    expect(fx.db.findIapEvents().slice(0, history.length)).toEqual(history);
  });

  it("never puts a provider reference, payload text or secret in the response or the audit event", async () => {
    await livePlay();
    const res = await checkoutCompleted("cs_stale_setup", "sub_SECRET_REFERENCE_123");
    const everything = JSON.stringify(await res.json()) + JSON.stringify(conflictEvents());
    for (const forbidden of ["sub_SECRET_REFERENCE_123", "cus_incoming_1", "cs_stale_setup", STRIPE_SECRET, PLAY_TOKEN]) expect(everything).not.toContain(forbidden);
    expect(Object.keys(conflictEvents()[0].detail).sort()).toEqual(["code", "existingProvider", "incomingProvider", "referenceHash", "source"]);
  });
});

describe("a live Google Play entitlement is never overwritten by Revolut", () => {
  it("rejects a Revolut completion carrying the row's reference and leaves the row untouched", async () => {
    await livePlay();
    const before = row();
    const res = await revolut("ORDER_COMPLETED", PLAY_TOKEN);
    expect(res.status).toBe(200);
    expect((await res.json()).message).toBe("Not applied: another provider's subscription is already active.");
    expect(row()).toEqual(before);
    expect(conflictEvents().at(-1)).toMatchObject({ provider: "revolut", detail: { code: "other_provider_active", source: "revolut_webhook" } });
  });

  it("rejects every Revolut status event for it, including a cancellation", async () => {
    await livePlay();
    const before = row();
    for (const event of ["ORDER_COMPLETED", "ORDER_FAILED", "ORDER_CANCELLED", "SUBSCRIPTION_CANCELLED"]) await revolut(event, PLAY_TOKEN);
    expect(row()).toEqual(before);
  });
});

describe("a live Stripe or Revolut entitlement is never overwritten by another provider or a Play claim", () => {
  it.each(["stripe", "revolut"] as const)("rejects a Play claim over a live %s App Subscription, binds nothing and acknowledges nothing", async (provider) => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.appPackage, status: "active", provider, providerSubscriptionId: `${provider}-ref-1`, currentPeriodEnd: FUTURE() });
    const before = row();

    const res = await fx.claim(fx.memberA.id, PLAY_TOKEN);

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("other_provider_active");
    expect(row()).toEqual(before);
    expect(fx.db.findGooglePlayPurchaseByToken(PLAY_TOKEN)).toBeUndefined();
    expect(fx.adapter.ackCalls).toEqual([]);
    expect(conflictEvents().at(-1)).toMatchObject({ provider: "google_play", detail: { code: "other_provider_active", existingProvider: provider, source: "google_play_claim" } });
  });

  it.each(["stripe", "revolut"] as const)("rejects a Play claim over a live %s Membership too", async (provider) => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "active", provider, providerSubscriptionId: `${provider}-ref-2`, currentPeriodEnd: FUTURE() });
    const before = row();
    const res = await fx.claim(fx.memberA.id, PLAY_TOKEN);
    expect(res.status).toBe(409);
    expect(row()).toEqual(before);
    expect(fx.db.findGooglePlayPurchaseByToken(PLAY_TOKEN)).toBeUndefined();
  });

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

  it("treats a Stripe subscription cancelled at period end as active until the paid-through date", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "active", provider: "stripe", providerSubscriptionId: "sub_ending", currentPeriodEnd: FUTURE() });
    expect((await fx.claim(fx.memberA.id, PLAY_TOKEN)).status).toBe(409);
    // Once the paid period has passed it no longer blocks.
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "active", provider: "stripe", providerSubscriptionId: "sub_ending", currentPeriodEnd: PAST() });
    expect((await fx.claim(fx.memberA.id, PLAY_TOKEN_2)).status).toBe(200);
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

  it("Google Play: a duplicate claim of its own token is idempotent", async () => {
    await fx.claim(fx.memberA.id, PLAY_TOKEN);
    const before = row();
    expect((await fx.verify(fx.memberA.id, { purchaseToken: PLAY_TOKEN })).status).toBe(200);
    expect(row().providerSubscriptionId).toBe(before.providerSubscriptionId);
    expect(fx.db.findGooglePlayPurchasesByUserId(fx.memberA.id)).toHaveLength(1);
  });
});

describe("an ended entitlement does not block another provider", () => {
  it("expired Play, then a Stripe completion for a checkout that was pending when the Play purchase happened, is promoted to Stripe", async () => {
    // A pending Stripe Membership checkout exists. The member then buys through Google Play instead.
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, billingOptionId: fx.ids.membershipOption, status: "pending", provider: "stripe", providerSetupOrderId: "cs_pending_1", currentPeriodEnd: null });
    expect((await fx.claim(fx.memberA.id, PLAY_TOKEN)).status).toBe(200);
    // The checkout intent was kept out of the way (not lost, and not left where a webhook could match it unguarded).
    expect(row()).toMatchObject({ provider: "google_play", providerSetupOrderId: null, pendingSetupOrderId: "cs_pending_1", pendingPackageId: fx.ids.membershipPackage });

    // While Play is live the Stripe completion is refused.
    const live = row();
    await checkoutCompleted("cs_pending_1", "sub_late");
    expect(row()).toEqual(live);

    // Play ends. A fresh completion for that checkout may now take the row, because nothing is being replaced.
    fx.adapter.setSnapshot(PLAY_TOKEN, { state: "SUBSCRIPTION_STATE_EXPIRED", expiryTimeMillis: Date.now() - 1000 });
    await fx.rtdn(fx.subscriptionEvent(PLAY_TOKEN, 13));
    expect(row().status).toBe("canceled");
    await stripe("checkout.session.completed", { id: "cs_pending_1", mode: "subscription", subscription: "sub_after_expiry", customer: "cus_1" });
    expect(row()).toMatchObject({ provider: "stripe", status: "active", providerSubscriptionId: "sub_after_expiry", packageId: fx.ids.membershipPackage, pendingSetupOrderId: null });
  });

  it("a cancelled or expired Stripe subscription does not block a Play claim, and the Stripe history is kept in the audit trail", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "canceled", provider: "stripe", providerSubscriptionId: "sub_gone", currentPeriodEnd: PAST() });
    expect((await fx.claim(fx.memberA.id, PLAY_TOKEN)).status).toBe(200);
    expect(row()).toMatchObject({ provider: "google_play", status: "active" });
  });
});

describe("concurrent conflicting completions", () => {
  it.each(["stripe first", "play first"])("exactly one provider ends up active and the other is rejected (%s)", async (order) => {
    // The member has a pending Stripe checkout and also holds a valid Google Play purchase to claim.
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, billingOptionId: fx.ids.membershipOption, status: "pending", provider: "stripe", providerSetupOrderId: "cs_race", currentPeriodEnd: null });
    fx.adapter.setSnapshot(PLAY_TOKEN, { accountBinding: fx.bindingFor(fx.memberA.id), expiryTimeMillis: Date.now() + 30 * DAY });

    const sendStripe = () => stripe("checkout.session.completed", { id: "cs_race", mode: "subscription", subscription: "sub_race", customer: "cus_race" });
    const sendPlay = () => fx.verify(fx.memberA.id, { purchaseToken: PLAY_TOKEN });
    const results = await Promise.all(order === "stripe first" ? [sendStripe(), sendPlay()] : [sendPlay(), sendStripe()]);
    for (const r of results) expect([200, 409]).toContain(r.status);

    const final = row();
    expect(["stripe", "google_play"]).toContain(final.provider);
    expect(final.status).toBe("active");
    if (final.provider === "stripe") {
      // Stripe won: Play was refused and bound nothing.
      expect(final.providerSubscriptionId).toBe("sub_race");
      expect(fx.db.findGooglePlayPurchaseByToken(PLAY_TOKEN)).toBeUndefined();
      expect(fx.adapter.ackCalls).toEqual([]);
    } else {
      // Play won: the Stripe completion was refused and audited, and the Play entitlement is intact.
      expect(final.providerSubscriptionId).toBe(PLAY_TOKEN);
      expect(conflictEvents().some((e) => e.provider === "stripe")).toBe(true);
    }
    // Never both: the row has one provider and one reference.
    expect([final.providerSubscriptionId]).toHaveLength(1);
  });

  it("two Stripe completions of the same checkout, one retried, leave one consistent active row", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, billingOptionId: fx.ids.membershipOption, status: "pending", provider: "stripe", providerSetupOrderId: "cs_twice", currentPeriodEnd: null });
    const [a, b] = await Promise.all([checkoutCompleted("cs_twice", "sub_twice"), checkoutCompleted("cs_twice", "sub_twice")]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(row()).toMatchObject({ provider: "stripe", status: "active", providerSubscriptionId: "sub_twice" });
    expect(conflictEvents()).toHaveLength(0);
  });
});

describe("existing Membership conflict behaviour is unchanged", () => {
  it("still answers membership_active for a Play claim over a live manual Membership", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "active", provider: "none", currentPeriodEnd: FUTURE() });
    const res = await fx.claim(fx.memberA.id, PLAY_TOKEN);
    expect((await res.json()).code).toBe("membership_active");
  });

  it("still lets a manual row be taken over by the member's own web switch (provider none is not a paid provider)", async () => {
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

// ── Added during validation of this PR ────────────────────────────────────────────────────────────────────────────

describe("every entitled state of a live Google Play row is protected", () => {
  it.each(["active", "past_due", "paused"] as const)("a %s Play row refuses Stripe and Revolut and is left untouched", async (status) => {
    fx.setSubscription(fx.memberA.id, {
      packageId: fx.ids.appPackage,
      status,
      provider: "google_play",
      providerSubscriptionId: PLAY_TOKEN,
      providerSetupOrderId: "cs_stale_setup",
      currentPeriodEnd: status === "past_due" ? PAST() : FUTURE(),
    });
    const before = row();

    await checkoutCompleted("cs_stale_setup");
    await stripe("invoice.paid", { id: "in_s", subscription: PLAY_TOKEN, amount_paid: 100 });
    await revolut("ORDER_COMPLETED", PLAY_TOKEN);

    expect(row()).toEqual(before);
    expect(conflictEvents()).toHaveLength(3);
  });

  it.each(["active", "past_due", "paused"] as const)("a %s Stripe row refuses a Play claim and binds nothing", async (status) => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.appPackage, status, provider: "stripe", providerSubscriptionId: "sub_state", currentPeriodEnd: status === "past_due" ? PAST() : FUTURE() });
    const before = row();
    const res = await fx.claim(fx.memberA.id, PLAY_TOKEN);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("other_provider_active");
    expect(row()).toEqual(before);
    expect(fx.db.findGooglePlayPurchaseByToken(PLAY_TOKEN)).toBeUndefined();
    expect(fx.adapter.ackCalls).toEqual([]);
  });
});

describe("provider-reference handlers refuse a mismatched row even when it is no longer entitled", () => {
  it.each(["canceled", "inactive", "pending"] as const)("a %s Play row still refuses a Stripe or Revolut event that carries its reference", async (status) => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.appPackage, status, provider: "google_play", providerSubscriptionId: PLAY_TOKEN, currentPeriodEnd: PAST() });
    const before = row();
    await stripe("invoice.paid", { id: "in_ended", subscription: PLAY_TOKEN, amount_paid: 100 });
    await stripe("customer.subscription.deleted", { id: PLAY_TOKEN });
    await revolut("ORDER_COMPLETED", PLAY_TOKEN);
    expect(row()).toEqual(before);
    expect(conflictEvents()).toHaveLength(3);
  });
});

describe("release-blocker regressions", () => {
  it("a Play claim over a live Stripe row whose package can no longer be resolved is refused BEFORE any purchase row exists", async () => {
    // liveEntitlement() reads such a row as "grants nothing", but the member is still being billed by Stripe. The claim
    // must not bind the token, acknowledge it, or replace the row.
    fx.setSubscription(fx.memberA.id, { packageId: "pkg-since-deleted", status: "active", provider: "stripe", providerSubscriptionId: "sub_orphan_pkg", currentPeriodEnd: FUTURE() });
    const before = row();

    const res = await fx.claim(fx.memberA.id, PLAY_TOKEN);

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("other_provider_active");
    expect(fx.db.findGooglePlayPurchaseByToken(PLAY_TOKEN)).toBeUndefined();
    expect(fx.adapter.ackCalls).toEqual([]);
    expect(row()).toEqual(before);
    expect(conflictEvents().at(-1)?.detail).toMatchObject({ source: "google_play_claim", existingProvider: "stripe" });
  });

  it("a replayed refused Revolut event leaves the row untouched every time and every audit record stays sanitized", async () => {
    await livePlay();
    const before = row();
    for (let i = 0; i < 3; i++) await revolut("ORDER_COMPLETED", PLAY_TOKEN);
    expect(row()).toEqual(before);
    for (const e of conflictEvents()) {
      expect(Object.keys(e.detail).sort()).toEqual(["code", "existingProvider", "incomingProvider", "referenceHash", "source"]);
      expect(JSON.stringify(e)).not.toContain(PLAY_TOKEN);
    }
  });

  it("a refused completion never creates a revenue event or touches the Play purchase record", async () => {
    await livePlay();
    const revenueBefore = fx.db.findAllRevenueEvents().length;
    const purchaseBefore = fx.db.findGooglePlayPurchaseByToken(PLAY_TOKEN);
    await stripe("invoice.paid", { id: "in_rev", subscription: PLAY_TOKEN, amount_paid: 4900, currency: "eur" });
    await revolut("ORDER_COMPLETED", PLAY_TOKEN);
    expect(fx.db.findAllRevenueEvents()).toHaveLength(revenueBefore);
    expect(fx.db.findGooglePlayPurchaseByToken(PLAY_TOKEN)).toEqual(purchaseBefore);
  });
});

describe("purchase context also refuses while another paid provider is billing the account", () => {
  it.each(["stripe", "revolut"] as const)("is refused for a live %s row even when its package no longer resolves", async (provider) => {
    fx.setSubscription(fx.memberA.id, { packageId: "pkg-since-deleted", status: "active", provider, providerSubscriptionId: `${provider}-orphan`, currentPeriodEnd: FUTURE() });
    const res = await fx.context(fx.memberA.id);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("other_provider_active");
  });
});
