// Stale Stripe checkout recovery. A Stripe Checkout session stays payable for up to 24 hours but this app treats a checkout as
// stale after 30 minutes. The cleanup job used to CLEAR a stale switch (and a Play takeover dropped the setup-order reference), so a
// member who paid late was charged while the webhook matched no row. The checkout is now PARKED in abandonedCheckouts and a late
// completion is reconciled through the same provider guard as an on-time one. Nothing is cancelled or refunded automatically.
//
// REAL Stripe webhook route, REAL cleanup job, REAL Play claim/service, REAL temporary datastore; only the Google adapter is faked.
// Webhooks are signed with a throwaway test secret generated here. No network, no provider, no real token.
import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPlayFixture, type PlayFixture } from "../helpers/iap-play-fixture";

let fx: PlayFixture;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const FUTURE = () => new Date(Date.now() + 30 * DAY).toISOString();
const PAST = () => new Date(Date.now() - 2 * DAY).toISOString();
const STALE = () => new Date(Date.now() - 2 * HOUR).toISOString();
const PLAY_TOKEN = "fake-play-token-sc-1";
const STRIPE_SECRET = "whsec_test_only_not_a_real_secret";
let savedSecret: string | undefined;

let eventCounter = 0;
async function stripe(type: string, object: Record<string, unknown>, id = `evt_sc_${++eventCounter}`) {
  const { POST } = await import("@/app/api/stripe/webhook/route");
  const raw = JSON.stringify({ id, type, data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", STRIPE_SECRET).update(`${t}.${raw}`).digest("hex");
  return POST(new NextRequest("http://localhost/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": `t=${t},v1=${sig}` }, body: raw }));
}
const completed = (sessionId: string, sub = "sub_late_1") => stripe("checkout.session.completed", { id: sessionId, mode: "subscription", subscription: sub, customer: "cus_late_1" });

async function runCleanup() {
  const { expireStaleCheckoutsJob } = await import("@/lib/jobs/expire-stale-checkouts");
  return expireStaleCheckoutsJob.run();
}

const row = (userId = fx.memberA.id) => fx.db.findSubscriptionByUserId(userId)!;
const lateEvents = () => fx.db.findIapEvents({ type: "late_checkout_recovery" });
const conflictEvents = () => fx.db.findIapEvents({ type: "provider_conflict_rejected" });

/** A Stripe member with an active plan who started (and abandoned) a switch to another package. */
function staleSwitch(sessionId = "cs_switch_1") {
  fx.setSubscription(fx.memberA.id, {
    packageId: fx.ids.appPackage,
    billingOptionId: fx.ids.appOption,
    status: "active",
    provider: "stripe",
    providerSubscriptionId: "sub_old_1",
    currentPeriodEnd: FUTURE(),
    pendingPackageId: fx.ids.membershipPackage,
    pendingBillingOptionId: fx.ids.membershipOption,
    pendingSetupOrderId: sessionId,
    pendingStartedAt: STALE(),
  });
}

/** A brand new pending checkout that was never paid and went stale. */
function stalePending(sessionId = "cs_pending_1") {
  fx.setSubscription(fx.memberA.id, {
    packageId: fx.ids.membershipPackage,
    billingOptionId: fx.ids.membershipOption,
    status: "pending",
    provider: "stripe",
    providerSetupOrderId: sessionId,
    currentPeriodEnd: null,
    updatedAt: STALE(),
  });
}

beforeEach(async () => {
  savedSecret = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = STRIPE_SECRET;
  fx = await createPlayFixture();
});
afterEach(() => {
  fx.cleanup();
  if (savedSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = savedSecret;
});

describe("cleanup parks a stale switch instead of discarding it", () => {
  it("moves the checkout out of the pending fields into abandonedCheckouts and leaves the live plan untouched", async () => {
    staleSwitch();
    const before = row();
    const result = await runCleanup();
    expect(result).toMatch(/cleared 1 abandoned switch/i);

    const after = row();
    expect(after).toMatchObject({ status: "active", provider: "stripe", providerSubscriptionId: "sub_old_1", packageId: before.packageId, currentPeriodEnd: before.currentPeriodEnd });
    expect(after.pendingSetupOrderId).toBeNull();
    expect(after.pendingPackageId).toBeNull();
    expect(after.abandonedCheckouts).toEqual([
      expect.objectContaining({ sessionId: "cs_switch_1", packageId: fx.ids.membershipPackage, billingOptionId: fx.ids.membershipOption, reason: "stale_switch" }),
    ]);
    expect(after.abandonedCheckouts?.[0].settledAt ?? null).toBeNull();
  });

  it("is idempotent: running the cleanup again does not add a second entry or touch the row", async () => {
    staleSwitch();
    await runCleanup();
    const once = row();
    await runCleanup();
    expect(row()).toEqual(once);
    expect(row().abandonedCheckouts).toHaveLength(1);
  });

  it("does not park a fresh (still within the retry window) switch", async () => {
    staleSwitch();
    fx.db.saveSubscription({ ...row(), pendingStartedAt: new Date().toISOString() });
    await runCleanup();
    expect(row().pendingSetupOrderId).toBe("cs_switch_1");
    expect(row().abandonedCheckouts ?? []).toEqual([]);
  });

  it("bounds how many abandoned checkouts a row keeps (newest kept)", async () => {
    const { parkAbandonedCheckout, MAX_ABANDONED_CHECKOUTS } = await import("@/lib/checkout-recovery");
    let list: ReturnType<typeof parkAbandonedCheckout> = [];
    for (let i = 0; i < MAX_ABANDONED_CHECKOUTS + 5; i++) {
      list = parkAbandonedCheckout(list, { sessionId: `cs_${i}`, packageId: null, billingOptionId: null, startedAt: STALE(), clearedAt: STALE(), reason: "stale_switch" });
    }
    expect(list).toHaveLength(MAX_ABANDONED_CHECKOUTS);
    expect(list.at(-1)?.sessionId).toBe(`cs_${MAX_ABANDONED_CHECKOUTS + 4}`);
  });
});

describe("a late payment after cleanup is reconciled, not lost", () => {
  it("applies a late switch completion (no live Play entitlement) exactly as an on-time switch would", async () => {
    staleSwitch();
    await runCleanup();
    expect(row().pendingSetupOrderId).toBeNull();

    const res = await completed("cs_switch_1", "sub_new_1");

    expect(res.status).toBe(200);
    expect(row()).toMatchObject({ provider: "stripe", status: "active", providerSubscriptionId: "sub_new_1", packageId: fx.ids.membershipPackage, billingOptionId: fx.ids.membershipOption, providerSetupOrderId: "cs_switch_1" });
    expect(row().abandonedCheckouts?.[0].settledAt).toBeTruthy();
    expect(lateEvents().map((e) => e.detail)).toEqual([{ outcome: "applied" }]);
    expect(conflictEvents()).toHaveLength(0);
  });

  it("a duplicate completion (different event id) afterwards is a no-op, not a second activation", async () => {
    staleSwitch();
    await runCleanup();
    await completed("cs_switch_1", "sub_new_1");
    const afterFirst = row();

    await completed("cs_switch_1", "sub_new_1");

    expect(row()).toMatchObject({ provider: "stripe", status: "active", providerSubscriptionId: "sub_new_1", packageId: fx.ids.membershipPackage });
    expect(row().abandonedCheckouts).toEqual(afterFirst.abandonedCheckouts);
    expect(lateEvents()).toHaveLength(1);
  });

  it("the same event id delivered twice is acknowledged once (existing event dedupe)", async () => {
    staleSwitch();
    await runCleanup();
    await stripe("checkout.session.completed", { id: "cs_switch_1", mode: "subscription", subscription: "sub_new_1" }, "evt_dup");
    const again = await stripe("checkout.session.completed", { id: "cs_switch_1", mode: "subscription", subscription: "sub_new_1" }, "evt_dup");
    expect((await again.json()).message).toBe("Event already processed.");
    expect(lateEvents()).toHaveLength(1);
  });

  it("a payment arriving BEFORE cleanup is unaffected by this change", async () => {
    staleSwitch();
    fx.db.saveSubscription({ ...row(), pendingStartedAt: new Date().toISOString() });
    await completed("cs_switch_1", "sub_new_1");
    expect(row()).toMatchObject({ provider: "stripe", status: "active", providerSubscriptionId: "sub_new_1", packageId: fx.ids.membershipPackage });
    expect(lateEvents()).toHaveLength(0);
  });

  it("a stale never-paid pending checkout flipped to inactive still activates when the late payment arrives", async () => {
    stalePending();
    await runCleanup();
    expect(row().status).toBe("inactive");
    expect(row().providerSetupOrderId).toBe("cs_pending_1");

    await completed("cs_pending_1", "sub_late_pending");

    expect(row()).toMatchObject({ provider: "stripe", status: "active", providerSubscriptionId: "sub_late_pending" });
  });

  it("does not cancel, refund or contact any provider while reconciling (no network)", async () => {
    staleSwitch();
    await runCleanup();
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error("network blocked in test");
    }) as typeof fetch;
    try {
      await completed("cs_switch_1", "sub_new_1");
    } finally {
      globalThis.fetch = realFetch;
    }
    // A switch replaces the member's own previous Stripe subscription (existing switch behaviour, best effort and without
    // throwing); nothing else is called, and nothing here refunds.
    expect(calls).toBeLessThanOrEqual(1);
    expect(row().status).toBe("active");
  });
});

describe("a late payment can never overwrite a live Play entitlement", () => {
  /** Stripe pending checkout -> Play claim takes the row over -> cleanup parks the displaced checkout. */
  async function playTakesOverPendingCheckout() {
    stalePending("cs_displaced_1");
    // Make the checkout still look pending-but-recent so the takeover parks it into the pending fields.
    fx.db.saveSubscription({ ...row(), updatedAt: new Date().toISOString() });
    const res = await fx.claim(fx.memberA.id, PLAY_TOKEN, { expiryTimeMillis: Date.now() + 30 * DAY });
    expect(res.status).toBe(200);
    expect(row()).toMatchObject({ provider: "google_play", status: "active", providerSubscriptionId: PLAY_TOKEN, providerSetupOrderId: null });
    expect(row().pendingSetupOrderId).toBe("cs_displaced_1");
    fx.db.saveSubscription({ ...row(), pendingStartedAt: STALE() });
    await runCleanup();
    expect(row().abandonedCheckouts).toEqual([expect.objectContaining({ sessionId: "cs_displaced_1", reason: "replaced_by_play" })]);
    expect(row().pendingSetupOrderId).toBeNull();
  }

  it("refuses the late completion, preserves the Play row and token, and records a manual-recovery audit event", async () => {
    await playTakesOverPendingCheckout();
    const before = row();
    const purchaseBefore = fx.db.findGooglePlayPurchaseByToken(PLAY_TOKEN);

    const res = await completed("cs_displaced_1", "sub_late_over_play");

    expect(res.status).toBe(200);
    expect((await res.json()).message).toBe("Not applied: another provider's subscription is already active.");
    expect(row()).toEqual(before);
    expect(row()).toMatchObject({ provider: "google_play", providerSubscriptionId: PLAY_TOKEN, status: "active" });
    expect(fx.db.findGooglePlayPurchaseByToken(PLAY_TOKEN)).toEqual(purchaseBefore);
    expect(lateEvents().map((e) => e.detail)).toEqual([{ outcome: "conflict_manual_recovery", existingProvider: "google_play" }]);
    expect(conflictEvents()).toHaveLength(1);
    // The parked checkout stays UNSETTLED so staff can still see and resolve it.
    expect(row().abandonedCheckouts?.[0].settledAt ?? null).toBeNull();
  });

  it("never puts the session id, the incoming subscription or any secret in the audit events", async () => {
    await playTakesOverPendingCheckout();
    await completed("cs_displaced_1", "sub_SECRET_REFERENCE_9");
    const everything = JSON.stringify(lateEvents()) + JSON.stringify(conflictEvents());
    for (const forbidden of ["cs_displaced_1", "sub_SECRET_REFERENCE_9", "cus_late_1", STRIPE_SECRET, PLAY_TOKEN]) expect(everything).not.toContain(forbidden);
  });

  it("applies the late completion once the Play entitlement has genuinely ended (paid-through date passed)", async () => {
    await playTakesOverPendingCheckout();
    fx.db.saveSubscription({ ...row(), status: "inactive", currentPeriodEnd: PAST() });

    await completed("cs_displaced_1", "sub_late_after_play");

    expect(row()).toMatchObject({ provider: "stripe", status: "active", providerSubscriptionId: "sub_late_after_play", packageId: fx.ids.membershipPackage });
    expect(lateEvents().map((e) => e.detail)).toEqual([{ outcome: "applied" }]);
    // The historical Play purchase record and its token binding are preserved.
    expect(fx.db.findGooglePlayPurchaseByToken(PLAY_TOKEN)).toBeDefined();
  });

  it("a Play claim that displaces a cleanup-flipped (inactive) Stripe checkout parks it rather than dropping the reference", async () => {
    stalePending("cs_inactive_1");
    await runCleanup();
    expect(row().status).toBe("inactive");

    const res = await fx.claim(fx.memberA.id, PLAY_TOKEN, { expiryTimeMillis: Date.now() + 30 * DAY });
    expect(res.status).toBe(200);
    expect(row()).toMatchObject({ provider: "google_play", providerSetupOrderId: null });
    expect(row().abandonedCheckouts).toEqual([expect.objectContaining({ sessionId: "cs_inactive_1", reason: "replaced_by_play" })]);

    // A late payment while Play is live is refused with the manual-recovery audit event.
    const before = row();
    await completed("cs_inactive_1", "sub_x");
    expect(row()).toEqual(before);
    expect(lateEvents().map((e) => e.detail)).toEqual([{ outcome: "conflict_manual_recovery", existingProvider: "google_play" }]);
  });

  it("repeated refused deliveries (different event ids) never change the row", async () => {
    await playTakesOverPendingCheckout();
    const before = row();
    await completed("cs_displaced_1", "sub_a");
    await completed("cs_displaced_1", "sub_b");
    expect(row()).toEqual(before);
  });
});

describe("an unknown session still matches nothing", () => {
  it("acknowledges and changes nothing for a session that was never parked", async () => {
    staleSwitch();
    await runCleanup();
    const before = row();
    const res = await completed("cs_never_seen", "sub_z");
    expect(res.status).toBe(200);
    expect(row()).toEqual(before);
    expect(lateEvents()).toHaveLength(0);
  });
});
