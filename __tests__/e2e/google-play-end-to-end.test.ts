// End-to-end journeys for the Google Play App Subscription, run through the REAL route handlers, the REAL service, the
// REAL jobs and a REAL temporary datastore file, with only the Google adapter faked (helpers/iap-play-fixture.ts).
//
// This is the local stand-in for a staging environment: it proves the pieces compose, in the order a member, a gym
// admin and Google would actually exercise them. It does NOT prove anything about Google itself (see
// docs/google-play-server-contract-2026-10.md section 9). Fake tokens only. No network. No real purchase.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { createPlayFixture, type PlayFixture } from "../helpers/iap-play-fixture";

let fx: PlayFixture;
const T1 = "e2e-fake-token-1";
const T2 = "e2e-fake-token-2";
const DAY = 86_400_000;

const sub = (userId = fx.memberA.id) => fx.db.findSubscriptionByUserId(userId);
const tier = async (userId = fx.memberA.id) => (await import("@/lib/membership-entitlement")).resolveMemberTierForUser(userId);
const types = () => fx.db.findIapEvents().map((e) => e.type);

async function staffTier(memberId: string, actorId: string, tierName: string) {
  const { POST } = await import("@/app/api/staff/members/[userId]/tier/route");
  return POST(
    new NextRequest(`http://localhost/api/staff/members/${memberId}/tier`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: fx.cookie(actorId) },
      body: JSON.stringify({ tier: tierName }),
    }),
    { params: Promise.resolve({ userId: memberId }) }
  );
}

beforeEach(async () => {
  fx = await createPlayFixture();
});
afterEach(() => fx.cleanup());

describe("journey 1: buy, renew, cancel, expire, rebuy, refund", () => {
  it("follows the whole life of a subscription and keeps every record", async () => {
    // Free member opens the paywall: the server hands over their own binding.
    expect(await tier()).toBe("free");
    const ctx = await (await fx.context(fx.memberA.id)).json();
    expect(ctx.data.obfuscatedAccountId).toBe(fx.bindingFor(fx.memberA.id));

    // The client launches Google Play with that binding, then hands the token to the server.
    const claim = await fx.claim(fx.memberA.id, T1, { orderId: "GPA.1", expiryTimeMillis: Date.now() + 30 * DAY });
    expect(claim.status).toBe(200);
    expect(await tier()).toBe("app_subscription");
    expect(fx.adapter.acknowledged.has(T1)).toBe(true);

    // Google renews: a notification, a fresh order, a longer period, one revenue booking per order.
    const renewedUntil = Date.now() + 60 * DAY;
    fx.adapter.setSnapshot(T1, { orderId: "GPA.2", expiryTimeMillis: renewedUntil });
    await fx.rtdn(fx.subscriptionEvent(T1, 2));
    expect(sub()?.currentPeriodEnd).toBe(new Date(renewedUntil).toISOString());
    expect(fx.db.findAllRevenueEvents().map((e) => e.providerRef).sort()).toEqual(["GPA.1", "GPA.2"]);

    // The member cancels in Google Play: access continues to the paid expiry.
    fx.adapter.setSnapshot(T1, { state: "SUBSCRIPTION_STATE_CANCELED", autoRenewing: false });
    await fx.rtdn(fx.subscriptionEvent(T1, 3));
    expect(await tier()).toBe("app_subscription");

    // The paid period ends and the "expired" notification is LOST. Reconciliation notices.
    fx.adapter.setSnapshot(T1, { state: "SUBSCRIPTION_STATE_EXPIRED", expiryTimeMillis: renewedUntil });
    const { reconcileGooglePlayPurchases } = await import("@/lib/iap/service");
    const summary = await reconcileGooglePlayPurchases({ nowMs: renewedUntil + DAY });
    expect(summary.processed).toBe(1);
    expect(await tier()).toBe("free");

    // They subscribe again later with a brand-new token.
    expect((await fx.claim(fx.memberA.id, T2, { orderId: "GPA.3" })).status).toBe(200);
    expect(sub()?.providerSubscriptionId).toBe(T2);
    expect(await tier()).toBe("app_subscription");

    // Google refunds the new purchase: access ends at once and stays ended.
    await fx.rtdn(fx.voidedEvent(T2, "GPA.3"));
    expect(await tier()).toBe("free");
    await fx.rtdn(fx.subscriptionEvent(T2, 2));
    expect(await tier()).toBe("free");

    // Nothing was thrown away.
    expect(fx.db.findGooglePlayPurchasesByUserId(fx.memberA.id)).toHaveLength(2);
    expect(types()).toEqual(
      expect.arrayContaining(["purchase_claimed", "entitlement_granted", "acknowledgement_succeeded", "reconciliation_run", "entitlement_expired", "entitlement_revoked"])
    );
    expect(JSON.stringify(fx.db.findIapEvents())).not.toContain(T1);
  });
});

describe("journey 2: Membership and App Subscription never overlap, in either direction", () => {
  it("blocks each side while the other is live, and lets the second in only after the first has ended", async () => {
    // A live Google Play subscription: staff cannot replace it with a Membership.
    await fx.claim(fx.memberA.id, T1);
    expect((await (await staffTier(fx.memberA.id, fx.adminA.id, "membership")).json()).code).toBe("play_billing_active");
    expect((await staffTier(fx.memberA.id, fx.adminA.id, "free")).status).toBe(409);
    expect(await tier()).toBe("app_subscription");

    // It ends in Google Play. Now staff can grant the Membership.
    fx.adapter.setSnapshot(T1, { state: "SUBSCRIPTION_STATE_EXPIRED", expiryTimeMillis: Date.now() - 1000 });
    await fx.rtdn(fx.subscriptionEvent(T1, 13));
    expect((await staffTier(fx.memberA.id, fx.adminA.id, "membership")).status).toBe(200);
    expect(await tier()).toBe("membership");

    // With a live Membership the member cannot even start a purchase, and a token that reaches the server is refused.
    expect((await fx.context(fx.memberA.id)).status).toBe(409);
    const refused = await fx.claim(fx.memberA.id, T2);
    expect((await refused.json()).code).toBe("membership_active");
    expect(fx.db.findGooglePlayPurchaseByToken(T2)).toBeUndefined();
    expect(fx.adapter.acknowledged.has(T2)).toBe(false);
    expect(await tier()).toBe("membership");

    // A late notification for the old token cannot knock the Membership off.
    fx.adapter.setSnapshot(T1, { state: "SUBSCRIPTION_STATE_ACTIVE", expiryTimeMillis: Date.now() + 30 * DAY });
    await fx.rtdn(fx.subscriptionEvent(T1, 2));
    expect(await tier()).toBe("membership");

    // Once the Membership ends the member may subscribe.
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "canceled" });
    expect((await fx.context(fx.memberA.id)).status).toBe(200);
    expect((await fx.claim(fx.memberA.id, T2)).status).toBe(200);
    expect(await tier()).toBe("app_subscription");
  });
});

describe("journey 3: two gyms, one platform-wide product", () => {
  it("keeps each member's subscription, notifications and admin actions inside their own tenant", async () => {
    await fx.claim(fx.memberA.id, T1);
    await fx.claim(fx.memberB.id, T2);
    expect(await tier(fx.memberA.id)).toBe("app_subscription");
    expect(await tier(fx.memberB.id)).toBe("app_subscription");

    // Gym B's admin can neither see nor change gym A's member, and the answer is the ordinary 404.
    const before = sub(fx.memberA.id);
    for (const t of ["free", "membership", "app_subscription"]) {
      const res = await staffTier(fx.memberA.id, fx.adminB.id, t);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ success: false, message: "Member not found." });
    }
    expect(sub(fx.memberA.id)).toEqual(before);

    // A's token expires: only A changes.
    const bBefore = sub(fx.memberB.id);
    fx.adapter.setSnapshot(T1, { state: "SUBSCRIPTION_STATE_EXPIRED", expiryTimeMillis: Date.now() - 1000 });
    await fx.rtdn(fx.subscriptionEvent(T1, 13));
    expect(await tier(fx.memberA.id)).toBe("free");
    expect(sub(fx.memberB.id)).toEqual(bBefore);

    // B cannot claim A's token even with a perfectly valid binding of their own.
    fx.adapter.setSnapshot(T1, { state: "SUBSCRIPTION_STATE_ACTIVE", accountBinding: fx.bindingFor(fx.memberB.id), expiryTimeMillis: Date.now() + 30 * DAY });
    expect((await fx.verify(fx.memberB.id, { purchaseToken: T1 })).status).toBe(409);
    expect(fx.db.findGooglePlayPurchaseByToken(T1)?.userId).toBe(fx.memberA.id);
  });
});

describe("journey 4: the kill switch", () => {
  it("stops new purchases but never stops access being withdrawn, and resumes cleanly", async () => {
    await fx.claim(fx.memberA.id, T1);

    process.env.GOOGLE_PLAY_IAP_ENABLED = "false";
    expect((await fx.context(fx.memberB.id)).status).toBe(503);
    expect((await fx.claim(fx.memberB.id, T2)).status).toBe(503);
    expect(fx.db.findGooglePlayPurchaseByToken(T2)).toBeUndefined();

    // A refund while the switch is off still ends access.
    await fx.rtdn(fx.voidedEvent(T1, null));
    expect(await tier()).toBe("free");

    process.env.GOOGLE_PLAY_IAP_ENABLED = "true";
    expect((await fx.claim(fx.memberB.id, T2)).status).toBe(200);
  });
});

describe("journey 5: a flaky provider and noisy delivery", () => {
  it("retries through timeouts without double-granting or double-booking revenue", async () => {
    fx.adapter.setSnapshot(T1, { accountBinding: fx.bindingFor(fx.memberA.id), orderId: "GPA.flaky" });
    fx.adapter.failFetch("timeout", 2);

    expect((await fx.verify(fx.memberA.id, { purchaseToken: T1 })).status).toBe(502);
    expect((await fx.verify(fx.memberA.id, { purchaseToken: T1 })).status).toBe(502);
    expect(fx.db.findGooglePlayPurchaseByToken(T1)).toBeUndefined();
    expect(await tier()).toBe("free");

    const [a, b] = await Promise.all([fx.verify(fx.memberA.id, { purchaseToken: T1 }), fx.verify(fx.memberA.id, { purchaseToken: T1 })]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(fx.db.findGooglePlayPurchasesByUserId(fx.memberA.id)).toHaveLength(1);
    expect(fx.db.findAllRevenueEvents().filter((e) => e.providerRef === "GPA.flaky")).toHaveLength(1);

    // The same notification delivered five times is processed once.
    const calls = fx.adapter.fetchCalls.length;
    for (let i = 0; i < 5; i++) await fx.rtdn(fx.subscriptionEvent(T1, 2), { messageId: "same-message" });
    expect(fx.adapter.fetchCalls.length).toBe(calls + 1);
  });
});

describe("journey 6: a stolen token", () => {
  it("cannot be claimed by the thief, and does not poison the real purchaser's later claim", async () => {
    // The thief has the raw token but their account's binding does not match what Google echoes (the victim's).
    fx.adapter.setSnapshot(T1, { accountBinding: fx.bindingFor(fx.memberA.id) });
    const stolen = await fx.verify(fx.memberB.id, { purchaseToken: T1 });
    expect(stolen.status).toBe(409);
    expect((await stolen.json()).code).toBe("binding_required");
    expect(fx.db.findGooglePlayPurchaseByToken(T1)).toBeUndefined();
    expect(await tier(fx.memberB.id)).toBe("free");

    // The real purchaser still gets in, because the failed attempt bound nothing.
    expect((await fx.verify(fx.memberA.id, { purchaseToken: T1 })).status).toBe(200);
    expect(fx.db.findGooglePlayPurchaseByToken(T1)?.userId).toBe(fx.memberA.id);
    expect(types()).toContain("claim_rejected_binding");
  });
});
