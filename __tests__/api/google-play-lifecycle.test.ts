// The Google Play App Subscription lifecycle, end to end through the REAL route handlers, the REAL service and a REAL
// datastore file, with a fake provider adapter (helpers/iap-play-fixture.ts). No network, no real token, no
// provider contacted. Covers the plan's entitlement matrix: Membership conflict, purchase context, kill switch,
// no entitlement before verification, acknowledgement and its retry, grace/hold/pause/cancel/expiry/renewal,
// refund and revocation, duplicate / out-of-order / stale notifications, reconciliation, and audit.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPlayFixture, type PlayFixture } from "../helpers/iap-play-fixture";

let fx: PlayFixture;
const T1 = "fake-play-token-lifecycle-1";
const T2 = "fake-play-token-lifecycle-2";
const DAY = 86_400_000;

const sub = (userId = fx.memberA.id) => fx.db.findSubscriptionByUserId(userId);
const purchase = (token = T1) => fx.db.findGooglePlayPurchaseByToken(token);
const eventTypes = () => fx.db.findIapEvents().map((e) => e.type);
const tier = async (userId = fx.memberA.id) => (await import("@/lib/membership-entitlement")).resolveMemberTierForUser(userId);

beforeEach(async () => {
  fx = await createPlayFixture();
});
afterEach(() => fx.cleanup());

describe("claim over an existing Membership (owner default D1)", () => {
  it.each(["active", "past_due", "paused"] as const)("rejects a claim while a %s Membership exists: no purchase row, no acknowledgement, no entitlement, nothing booked", async (status) => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status });
    const before = sub();

    const res = await fx.claim(fx.memberA.id, T1);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false, code: "membership_active", message: expect.stringMatching(/^You already have an active gym Membership/) });
    expect(purchase()).toBeUndefined(); // the token stays unbound: no pending intent
    expect(fx.adapter.ackCalls).toEqual([]); // not acknowledged: Google refunds it itself
    expect(sub()).toEqual(before);
    expect(fx.db.findAllRevenueEvents()).toEqual([]);
    expect(eventTypes()).toEqual(["claim_rejected_conflict"]);
  });

  it("allows the claim once the Membership is no longer active, and preserves its history", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "canceled" });
    expect((await fx.claim(fx.memberA.id, T1)).status).toBe(200);
    expect(sub()).toMatchObject({ packageId: fx.ids.appPackage, provider: "google_play", status: "active", createdAt: expect.any(String) });
  });

  it.each([
    ["pending", { status: "pending" as const }],
    ["lapsed", { status: "active" as const, currentPeriodEnd: "2026-01-01T00:00:00.000Z" }],
  ])("allows the claim over a %s Membership", async (_label, over) => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, ...over });
    expect((await fx.claim(fx.memberA.id, T1)).status).toBe(200);
  });

  it("refuses a second Play subscription on an account that already has a live one, without binding the new token", async () => {
    await fx.claim(fx.memberA.id, T1);
    const res = await fx.claim(fx.memberA.id, T2);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("play_billing_active");
    expect(purchase(T2)).toBeUndefined();
    expect(sub()?.providerSubscriptionId).toBe(T1);
  });

  it("replaces a MANUAL App Subscription with the Play-billed one (one row, no overlap)", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.appPackage, status: "active", provider: "none" });
    expect((await fx.claim(fx.memberA.id, T1)).status).toBe(200);
    expect(sub()).toMatchObject({ provider: "google_play", providerSubscriptionId: T1 });
  });
});

describe("purchase context", () => {
  it("returns the session user's own binding and nobody else's, ignoring any client-supplied id", async () => {
    const res = await fx.context(fx.memberA.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ obfuscatedAccountId: fx.bindingFor(fx.memberA.id), environment: "test" });
    expect(body.data.obfuscatedAccountId).not.toBe(fx.bindingFor(fx.memberB.id));
    expect(JSON.stringify(body)).not.toContain(fx.memberA.id); // one-way: no raw user id
  });

  it("requires a session", async () => {
    expect((await fx.context(undefined)).status).toBe(401);
  });

  it("is refused for a member with an active Membership, so no purchase intent starts", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "active" });
    const res = await fx.context(fx.memberA.id);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("membership_active");
  });

  it("is refused while a Play subscription is live", async () => {
    await fx.claim(fx.memberA.id, T1);
    expect((await (await fx.context(fx.memberA.id)).json()).code).toBe("play_billing_active");
  });

  it("is refused when Google Play is not configured", async () => {
    fx.adapter.configured = false;
    expect((await fx.context(fx.memberA.id)).status).toBe(503);
  });
});

describe("kill switch (owner default D7): default off, gates new claims, never lifecycle", () => {
  it("is OFF by default: verify and purchase context answer 503 iap_disabled and contact nobody", async () => {
    fx.cleanup();
    fx = await createPlayFixture({ enabled: false });
    fx.adapter.setSnapshot(T1, { accountBinding: fx.bindingFor(fx.memberA.id) });

    const res = await fx.verify(fx.memberA.id, { purchaseToken: T1 });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "iap_disabled" });
    expect((await fx.context(fx.memberA.id)).status).toBe(503);
    expect(fx.adapter.fetchCalls).toEqual([]);
    expect(purchase()).toBeUndefined();
    expect(eventTypes()).toEqual(["claim_rejected_disabled"]);
  });

  it.each([
    ["enabled flag alone", { GOOGLE_PLAY_IAP_ENABLED: "true", GOOGLE_PLAY_IAP_ENVIRONMENT: undefined }],
    ["environment alone", { GOOGLE_PLAY_IAP_ENABLED: undefined, GOOGLE_PLAY_IAP_ENVIRONMENT: "staging" }],
    ["a truthy-looking value that is not exactly true", { GOOGLE_PLAY_IAP_ENABLED: "1", GOOGLE_PLAY_IAP_ENVIRONMENT: "staging" }],
    ["an unknown environment label", { GOOGLE_PLAY_IAP_ENABLED: "true", GOOGLE_PLAY_IAP_ENVIRONMENT: "prod" }],
  ])("stays off with %s", async (_label, env) => {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const { isGooglePlayIapEnabled } = await import("@/lib/iap/config");
    expect(isGooglePlayIapEnabled()).toBe(false);
  });

  it("does NOT stop lifecycle processing: an expiry still withdraws access with the switch off", async () => {
    await fx.claim(fx.memberA.id, T1);
    expect(await tier()).toBe("app_subscription");

    delete process.env.GOOGLE_PLAY_IAP_ENABLED;
    fx.adapter.setSnapshot(T1, { state: "SUBSCRIPTION_STATE_EXPIRED", expiryTimeMillis: Date.now() - 1000 });
    const res = await fx.rtdn(fx.subscriptionEvent(T1, 13));

    expect(res.status).toBe(200);
    expect(sub()?.status).toBe("canceled");
    expect(await tier()).toBe("free");
  });
});

describe("no entitlement before server verification (owner default D5)", () => {
  it.each(["timeout", "network", "server_error", "rate_limited", "unauthorized"] as const)("a provider %s grants nothing and answers a retryable 502", async (code) => {
    fx.adapter.setSnapshot(T1, { accountBinding: fx.bindingFor(fx.memberA.id) });
    fx.adapter.failFetch(code);
    const res = await fx.verify(fx.memberA.id, { purchaseToken: T1 });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ success: false, code: "provider_unavailable", message: "Google Play couldn't be reached. Try again shortly." });
    expect(purchase()).toBeUndefined();
    expect(sub()).toBeUndefined();
    expect(await tier()).toBe("free");
  });

  it("a provider answer that is not entitling (expired) records the purchase but grants no access", async () => {
    fx.adapter.setSnapshot(T1, { accountBinding: fx.bindingFor(fx.memberA.id), state: "SUBSCRIPTION_STATE_EXPIRED", expiryTimeMillis: Date.now() - 1000 });
    const res = await fx.verify(fx.memberA.id, { purchaseToken: T1 });
    expect(res.status).toBe(200);
    expect(await tier()).toBe("free");
    expect(fx.adapter.ackCalls).toEqual([]);
  });

  it("an unconfigured provider is a 503, and no provider text is ever in a response", async () => {
    fx.adapter.setSnapshot(T1, { accountBinding: fx.bindingFor(fx.memberA.id) });
    fx.adapter.failFetch("bad_request");
    const res = await fx.verify(fx.memberA.id, { purchaseToken: T1 });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toMatch(/bad_request|status|googleapis/i);
  });
});

describe("acknowledgement", () => {
  it("acknowledges only after the entitlement is written, and records it", async () => {
    await fx.claim(fx.memberA.id, T1);
    expect(fx.adapter.ackCalls).toEqual([T1]);
    expect(purchase()).toMatchObject({ acknowledged: true, acknowledgementState: "acknowledged", acknowledgementAttempts: 1 });
    expect(eventTypes()).toEqual(expect.arrayContaining(["purchase_claimed", "entitlement_granted", "acknowledgement_succeeded"]));
  });

  it("a failed acknowledgement does not withdraw the entitlement and is recorded for retry", async () => {
    fx.adapter.failAcknowledge("server_error");
    const res = await fx.claim(fx.memberA.id, T1);
    expect(res.status).toBe(200);
    expect((await res.json()).data.acknowledged).toBe(false);
    expect(await tier()).toBe("app_subscription");
    expect(purchase()).toMatchObject({ acknowledged: false, acknowledgementState: "failed", acknowledgementAttempts: 1, acknowledgementError: "server_error" });
  });

  it("the retry job completes it, respecting the minimum interval", async () => {
    fx.adapter.failAcknowledge("timeout");
    await fx.claim(fx.memberA.id, T1);
    const { retryGooglePlayAcknowledgements, ACK_RETRY_MIN_INTERVAL_MS } = await import("@/lib/iap/service");

    const tooSoon = await retryGooglePlayAcknowledgements({ nowMs: Date.now() + 60_000 });
    expect(tooSoon.considered).toBe(0);

    const later = await retryGooglePlayAcknowledgements({ nowMs: Date.now() + ACK_RETRY_MIN_INTERVAL_MS + 1000 });
    expect(later).toMatchObject({ considered: 1, processed: 1, failed: 0 });
    expect(purchase()).toMatchObject({ acknowledged: true, acknowledgementState: "acknowledged", acknowledgementAttempts: 2 });
  });

  it("stops retrying after the attempt cap and after Google's refund window", async () => {
    fx.adapter.failAcknowledge("server_error", 50);
    await fx.claim(fx.memberA.id, T1);
    const { retryGooglePlayAcknowledgements, ACK_RETRY_MIN_INTERVAL_MS, MAX_ACK_ATTEMPTS, ACK_WINDOW_MS } = await import("@/lib/iap/service");

    let now = Date.now();
    for (let i = 0; i < MAX_ACK_ATTEMPTS + 3; i++) {
      now += ACK_RETRY_MIN_INTERVAL_MS + 1000;
      await retryGooglePlayAcknowledgements({ nowMs: now });
    }
    expect(purchase()?.acknowledgementAttempts).toBe(MAX_ACK_ATTEMPTS);

    // A fresh purchase past the window is never retried.
    fx.adapter.failAcknowledge("server_error", 5);
    await fx.claim(fx.memberB.id, T2);
    const past = await retryGooglePlayAcknowledgements({ nowMs: Date.now() + ACK_WINDOW_MS + 1000 });
    expect(past.considered).toBe(0);
  });

  it("never acknowledges a revoked purchase", async () => {
    fx.adapter.failAcknowledge("server_error");
    await fx.claim(fx.memberA.id, T1, { orderId: "GPA.void-1" });
    await fx.rtdn(fx.voidedEvent(T1, "GPA.void-1"));
    const { retryGooglePlayAcknowledgements, ACK_RETRY_MIN_INTERVAL_MS } = await import("@/lib/iap/service");
    const calls = fx.adapter.ackCalls.length;
    await retryGooglePlayAcknowledgements({ nowMs: Date.now() + ACK_RETRY_MIN_INTERVAL_MS + 1000 });
    expect(fx.adapter.ackCalls.length).toBe(calls);
  });
});

describe("lifecycle states via notification (state is re-fetched, never trusted from the payload)", () => {
  beforeEach(async () => {
    await fx.claim(fx.memberA.id, T1);
  });

  it("grace period keeps access (past_due)", async () => {
    fx.adapter.setSnapshot(T1, { state: "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" });
    await fx.rtdn(fx.subscriptionEvent(T1, 6));
    expect(sub()?.status).toBe("past_due");
    expect(await tier()).toBe("app_subscription");
  });

  it("account hold removes access", async () => {
    fx.adapter.setSnapshot(T1, { state: "SUBSCRIPTION_STATE_ON_HOLD" });
    await fx.rtdn(fx.subscriptionEvent(T1, 5));
    expect(sub()?.status).toBe("canceled");
    expect(await tier()).toBe("free");
    expect(eventTypes()).toContain("entitlement_expired");
  });

  it("a pause keeps the row paused", async () => {
    fx.adapter.setSnapshot(T1, { state: "SUBSCRIPTION_STATE_PAUSED" });
    await fx.rtdn(fx.subscriptionEvent(T1, 10));
    expect(sub()?.status).toBe("paused");
  });

  it("ordinary cancellation keeps access to the paid expiry (owner default D5)", async () => {
    const expiry = Date.now() + 10 * DAY;
    fx.adapter.setSnapshot(T1, { state: "SUBSCRIPTION_STATE_CANCELED", autoRenewing: false, expiryTimeMillis: expiry });
    await fx.rtdn(fx.subscriptionEvent(T1, 3));
    expect(sub()).toMatchObject({ status: "active", currentPeriodEnd: new Date(expiry).toISOString() });
    expect(await tier()).toBe("app_subscription");
    expect(purchase()?.status).toBe("canceled");
  });

  it("expiry ends access", async () => {
    fx.adapter.setSnapshot(T1, { state: "SUBSCRIPTION_STATE_EXPIRED", expiryTimeMillis: Date.now() - 1000 });
    await fx.rtdn(fx.subscriptionEvent(T1, 13));
    expect(sub()?.status).toBe("canceled");
    expect(await tier()).toBe("free");
  });

  it("a renewal extends the period and books one revenue event per order", async () => {
    const expiry = Date.now() + 60 * DAY;
    fx.adapter.setSnapshot(T1, { orderId: "GPA.renew-2", expiryTimeMillis: expiry });
    await fx.rtdn(fx.subscriptionEvent(T1, 2));
    await fx.rtdn(fx.subscriptionEvent(T1, 2));
    expect(sub()?.currentPeriodEnd).toBe(new Date(expiry).toISOString());
    expect(fx.db.findAllRevenueEvents().filter((e) => e.providerRef === "GPA.renew-2")).toHaveLength(1);
  });

  it("an ambiguous or pending provider state records the purchase but does not touch entitlement", async () => {
    const before = sub();
    fx.adapter.setSnapshot(T1, { state: "SUBSCRIPTION_STATE_PENDING" });
    await fx.rtdn(fx.subscriptionEvent(T1, 4));
    expect(sub()?.status).toBe(before?.status);
  });
});

describe("refund and revocation (voided purchases)", () => {
  beforeEach(async () => {
    await fx.claim(fx.memberA.id, T1, { orderId: "GPA.cur" });
  });

  it("a voided CURRENT order ends access immediately and marks the purchase revoked", async () => {
    // Even if Google still reports the state as active, a voided current order ends access.
    const res = await fx.rtdn(fx.voidedEvent(T1, "GPA.cur"));
    expect(res.status).toBe(200);
    expect(sub()?.status).toBe("canceled");
    expect(await tier()).toBe("free");
    expect(purchase()).toMatchObject({ revocationReason: "voided", revokedAt: expect.any(String) });
    expect(eventTypes()).toContain("entitlement_revoked");
  });

  it("a voided purchase stays void: no later snapshot, notification or re-verify can re-entitle it", async () => {
    await fx.rtdn(fx.voidedEvent(T1, "GPA.cur"));
    fx.adapter.setSnapshot(T1, { state: "SUBSCRIPTION_STATE_ACTIVE", expiryTimeMillis: Date.now() + 30 * DAY });
    await fx.rtdn(fx.subscriptionEvent(T1, 2));
    await fx.verify(fx.memberA.id, { purchaseToken: T1 });
    expect(await tier()).toBe("free");
    expect(sub()?.status).toBe("canceled");
  });

  it("a voided PRIOR order leaves the current period alone", async () => {
    await fx.rtdn(fx.voidedEvent(T1, "GPA.an-earlier-period"));
    expect(await tier()).toBe("app_subscription");
    expect(purchase()?.revokedAt).toBeUndefined();
  });

  it("a voided one-time product (productType 2) is ignored", async () => {
    await fx.rtdn(fx.voidedEvent(T1, "GPA.cur", 2));
    expect(await tier()).toBe("app_subscription");
  });

  it("revocation preserves history: the purchase row, its events and the revenue booking remain", async () => {
    const revenueBefore = fx.db.findAllRevenueEvents().length;
    await fx.rtdn(fx.voidedEvent(T1, "GPA.cur"));
    expect(purchase()).toBeDefined();
    expect(fx.db.findAllRevenueEvents()).toHaveLength(revenueBefore);
    expect(eventTypes()).toEqual(expect.arrayContaining(["purchase_claimed", "entitlement_granted"]));
  });
});

describe("notification idempotency and ordering", () => {
  beforeEach(async () => {
    await fx.claim(fx.memberA.id, T1);
  });

  it("processes a duplicate or replayed message id once", async () => {
    fx.adapter.setSnapshot(T1, { state: "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" });
    const calls = fx.adapter.fetchCalls.length;
    await fx.rtdn(fx.subscriptionEvent(T1, 6), { messageId: "dup-1" });
    const replay = await fx.rtdn(fx.subscriptionEvent(T1, 6), { messageId: "dup-1" });
    expect(replay.status).toBe(200);
    expect((await replay.json()).message).toMatch(/Duplicate/);
    expect(fx.adapter.fetchCalls.length).toBe(calls + 1);
  });

  it("a message with no id is keyed by its payload so identical redeliveries still collapse", async () => {
    const calls = fx.adapter.fetchCalls.length;
    const ev = fx.subscriptionEvent(T1, 2);
    await fx.rtdn(ev, { messageId: null });
    await fx.rtdn(ev, { messageId: null });
    expect(fx.adapter.fetchCalls.length).toBe(calls + 1);
  });

  it("drops a slow, older provider answer that arrives after a newer one (out of order)", async () => {
    // Event A issues its provider call while the subscription is still active, and is held open.
    const gate = fx.adapter.gateNextFetch();
    const slow = fx.rtdn(fx.subscriptionEvent(T1, 2), { messageId: "slow" });
    while (fx.adapter.fetchCalls.length < 2) await new Promise((r) => setTimeout(r, 2));
    // The subscription then expires; event B issues later and applies first.
    fx.adapter.setSnapshot(T1, { state: "SUBSCRIPTION_STATE_EXPIRED", expiryTimeMillis: Date.now() - 1000 });
    await new Promise((r) => setTimeout(r, 5));
    await fx.rtdn(fx.subscriptionEvent(T1, 13), { messageId: "fast" });
    expect(sub()?.status).toBe("canceled");

    gate.release(); // A now returns the OLD "active" answer.
    await slow;
    expect(sub()?.status).toBe("canceled");
    expect(await tier()).toBe("free");
    expect(eventTypes()).toContain("notification_stale");
  });

  it("retries a delivery whose provider call failed, using the same message id, and then completes it", async () => {
    fx.adapter.setSnapshot(T1, { state: "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" });
    fx.adapter.failFetch("timeout");
    const first = await fx.rtdn(fx.subscriptionEvent(T1, 6), { messageId: "retry-1" });
    expect(first.status).toBe(502);
    expect(fx.db.findIapNotification("retry-1")?.processedAt).toBeNull();

    const second = await fx.rtdn(fx.subscriptionEvent(T1, 6), { messageId: "retry-1" });
    expect(second.status).toBe(200);
    expect(sub()?.status).toBe("past_due");
    expect(fx.db.findIapNotification("retry-1")).toMatchObject({ outcome: "applied", attempts: 2 });
  });

  it("gives up after the attempt cap with a 200 so Pub/Sub stops, leaving the purchase to reconciliation", async () => {
    const { MAX_NOTIFICATION_ATTEMPTS } = await import("@/lib/iap/service");
    fx.adapter.failFetch("server_error", MAX_NOTIFICATION_ATTEMPTS + 5);
    let last = 502;
    for (let i = 0; i < MAX_NOTIFICATION_ATTEMPTS + 1; i++) last = (await fx.rtdn(fx.subscriptionEvent(T1, 2), { messageId: "stuck" })).status;
    expect(last).toBe(200);
    expect(fx.db.findIapNotification("stuck")?.outcome).toBe("gave_up");
  });

  it("answers 200 and completes when Google no longer recognises the token", async () => {
    fx.adapter.failFetch("not_found");
    const res = await fx.rtdn(fx.subscriptionEvent(T1, 2), { messageId: "gone" });
    expect(res.status).toBe(200);
    expect(fx.db.findIapNotification("gone")?.outcome).toBe("provider_rejected");
  });

  it("rejects a bad or missing shared secret with 401, and a notification for another app is ignored", async () => {
    expect((await fx.rtdn(fx.subscriptionEvent(T1), { token: "wrong" })).status).toBe(401);
    expect((await fx.rtdn(fx.subscriptionEvent(T1), { token: null })).status).toBe(401);
    const other = { ...fx.subscriptionEvent(T1), packageName: "com.someone.else" };
    const calls = fx.adapter.fetchCalls.length;
    expect((await fx.rtdn(other)).status).toBe(200);
    expect(fx.adapter.fetchCalls.length).toBe(calls);
  });

  it("acknowledges a test notification without touching anything", async () => {
    const res = await fx.rtdn({ version: "1.0", packageName: "com.example.app", eventTimeMillis: "1", testNotification: { version: "1.0" } });
    expect((await res.json()).message).toBe("Test notification received.");
  });
});

describe("stale tokens cannot rewrite the subscription row", () => {
  it("a notification for an OLD token does not overwrite the row now billed through a NEWER token", async () => {
    await fx.claim(fx.memberA.id, T1);
    // The first subscription ends, and the member buys again (a resubscribe: a fresh, unlinked token).
    fx.adapter.setSnapshot(T1, { state: "SUBSCRIPTION_STATE_EXPIRED", expiryTimeMillis: Date.now() - 1000 });
    await fx.rtdn(fx.subscriptionEvent(T1, 13));
    expect((await fx.claim(fx.memberA.id, T2, { orderId: "GPA.new" })).status).toBe(200);
    expect(sub()?.providerSubscriptionId).toBe(T2);

    // A late, replayed event for the old token arrives, and the provider (wrongly or not) says "active".
    fx.adapter.setSnapshot(T1, { state: "SUBSCRIPTION_STATE_ACTIVE", expiryTimeMillis: Date.now() + 30 * DAY });
    await fx.rtdn(fx.subscriptionEvent(T1, 2));

    expect(sub()).toMatchObject({ providerSubscriptionId: T2, status: "active" });
  });

  it("an expiry notification for an old token never cancels a NEWER live subscription", async () => {
    await fx.claim(fx.memberA.id, T1);
    fx.adapter.setSnapshot(T1, { state: "SUBSCRIPTION_STATE_EXPIRED", expiryTimeMillis: Date.now() - 1000 });
    await fx.rtdn(fx.subscriptionEvent(T1, 13));
    await fx.claim(fx.memberA.id, T2);
    await fx.rtdn(fx.subscriptionEvent(T1, 13), { messageId: "late-old-expiry" });
    expect(sub()).toMatchObject({ providerSubscriptionId: T2, status: "active" });
    expect(await tier()).toBe("app_subscription");
  });

  it("a notification for an old token cannot overwrite an active gym Membership bought afterwards", async () => {
    await fx.claim(fx.memberA.id, T1);
    fx.adapter.setSnapshot(T1, { state: "SUBSCRIPTION_STATE_EXPIRED", expiryTimeMillis: Date.now() - 1000 });
    await fx.rtdn(fx.subscriptionEvent(T1, 13));
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "active" });
    const before = sub();

    fx.adapter.setSnapshot(T1, { state: "SUBSCRIPTION_STATE_ACTIVE", expiryTimeMillis: Date.now() + 30 * DAY });
    await fx.rtdn(fx.subscriptionEvent(T1, 2), { messageId: "old-token-resurrection" });

    expect(sub()).toEqual(before);
    expect(await tier()).toBe("membership");
  });

  it("a direct successor token (linkedPurchaseToken) takes over the row", async () => {
    await fx.claim(fx.memberA.id, T1);
    const res = await fx.claim(fx.memberA.id, T2, { linkedPurchaseToken: T1, orderId: "GPA.upgrade" });
    expect(res.status).toBe(200);
    expect(sub()?.providerSubscriptionId).toBe(T2);
  });
});

describe("reconciliation (a lost notification must not leave access running past the paid expiry)", () => {
  it("re-checks an active purchase whose paid period has passed and ends access", async () => {
    await fx.claim(fx.memberA.id, T1, { expiryTimeMillis: Date.now() + DAY });
    fx.adapter.setSnapshot(T1, { state: "SUBSCRIPTION_STATE_EXPIRED", expiryTimeMillis: Date.now() + DAY });
    const { reconcileGooglePlayPurchases } = await import("@/lib/iap/service");

    const summary = await reconcileGooglePlayPurchases({ nowMs: Date.now() + 2 * DAY });

    expect(summary).toMatchObject({ considered: 1, processed: 1, failed: 0 });
    expect(sub()?.status).toBe("canceled");
    expect(eventTypes()).toContain("reconciliation_run");
  });

  it("leaves fresh purchases alone, skips when unconfigured, and stops early on rejected credentials", async () => {
    await fx.claim(fx.memberA.id, T1);
    await fx.claim(fx.memberB.id, T2);
    const { reconcileGooglePlayPurchases, RECONCILE_STALE_AFTER_MS } = await import("@/lib/iap/service");

    expect((await reconcileGooglePlayPurchases()).considered).toBe(0);

    const later = Date.now() + RECONCILE_STALE_AFTER_MS + 1000;
    fx.adapter.failFetch("unauthorized", 10);
    const failing = await reconcileGooglePlayPurchases({ nowMs: later });
    expect(failing).toMatchObject({ considered: 2, processed: 0, failed: 1 }); // stopped after the first rejection

    fx.adapter.configured = false;
    expect(await reconcileGooglePlayPurchases({ nowMs: later })).toMatchObject({ skipped: "not_configured" });
  });

  it("the member's tier ends at the paid expiry even before reconciliation runs", async () => {
    await fx.claim(fx.memberA.id, T1);
    fx.db.saveSubscription({ ...sub()!, currentPeriodEnd: new Date(Date.now() - 3_600_000).toISOString() });
    expect(await tier()).toBe("free");
  });
});

describe("tenant isolation and audit", () => {
  it("a notification changes only the token owner's row, never another gym's member", async () => {
    await fx.claim(fx.memberA.id, T1);
    await fx.claim(fx.memberB.id, T2);
    const bBefore = sub(fx.memberB.id);
    fx.adapter.setSnapshot(T1, { state: "SUBSCRIPTION_STATE_EXPIRED", expiryTimeMillis: Date.now() - 1000 });
    await fx.rtdn(fx.subscriptionEvent(T1, 13));
    expect(sub(fx.memberA.id)?.status).toBe("canceled");
    expect(sub(fx.memberB.id)).toEqual(bBefore);
  });

  it("the audit log never contains a raw purchase token, a binding value or a provider message", async () => {
    await fx.claim(fx.memberA.id, T1);
    await fx.verify(fx.memberB.id, { purchaseToken: T1 });
    fx.adapter.failFetch("server_error");
    await fx.rtdn(fx.subscriptionEvent(T1, 2));
    const log = JSON.stringify(fx.db.findIapEvents());
    expect(log).not.toContain(T1);
    expect(log).not.toContain(fx.bindingFor(fx.memberA.id));
    expect(log).toContain(fx.db.hashPurchaseToken(T1));
  });

  it("records every transition in order for one purchase", async () => {
    await fx.claim(fx.memberA.id, T1);
    fx.adapter.setSnapshot(T1, { state: "SUBSCRIPTION_STATE_EXPIRED", expiryTimeMillis: Date.now() - 1000 });
    await fx.rtdn(fx.subscriptionEvent(T1, 13));
    const types = fx.db.findIapEvents({ purchaseTokenHash: fx.db.hashPurchaseToken(T1) }).map((e) => e.type);
    expect(types).toEqual(["purchase_claimed", "entitlement_granted", "acknowledgement_succeeded", "entitlement_expired"]);
  });
});

describe("registered jobs", () => {
  it("includes the reconciliation and acknowledgement-retry jobs, and they run cleanly with no purchases", async () => {
    const { ALL_JOBS } = await import("@/lib/jobs/registry");
    const names = ALL_JOBS.map((j) => j.name);
    expect(names).toEqual(expect.arrayContaining(["reconcile-google-play-purchases", "retry-google-play-acknowledgements"]));
    for (const job of ALL_JOBS.filter((j) => j.name.includes("google-play"))) {
      await expect(job.run()).resolves.toMatch(/\d+ of 0|Skipped/);
    }
  });
});
