// Purchase-token ownership for POST /api/mobile/billing/google-play/verify.
// A token already recorded against a DIFFERENT account must be rejected before anything is saved, overwritten,
// acknowledged, granted or booked as revenue; the recorded owner and their entitlement stay untouched. The same
// owner re-verifying the same token stays idempotent. The identity used is always the signed session user, never
// a client-supplied user or gym id.
//
// Ported from a mocked-datastore version to the REAL route handler with a REAL datastore file and a fake provider
// adapter (helpers/iap-play-fixture.ts). Every original case is kept. Deliberate changes, all tightenings:
//  - an invalid token now answers a SANITIZED message with a stable code, instead of passing the provider's own
//    message through (a caller must never be able to read provider text back);
//  - failure bodies carry a stable `code`; the success body also reports `acknowledged`.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPlayFixture, type PlayFixture } from "../helpers/iap-play-fixture";

let fx: PlayFixture;
const TOKEN = "play-token-123";

const revenue = () => fx.db.findAllRevenueEvents();

beforeEach(async () => {
  fx = await createPlayFixture();
});
afterEach(() => fx.cleanup());

describe("POST /api/mobile/billing/google-play/verify — token ownership", () => {
  it("accepts a new token: saves it for the session user, grants the tier, records revenue", async () => {
    const res = await fx.claim(fx.memberA.id, TOKEN, { orderId: "GPA.1", acknowledged: false });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      message: "Purchase verified.",
      data: { tier: "app_subscription", status: "active", acknowledged: true },
    });
    expect(fx.db.findGooglePlayPurchaseByToken(TOKEN)).toMatchObject({ userId: fx.memberA.id, purchaseToken: TOKEN });
    expect(fx.db.findSubscriptionByUserId(fx.memberA.id)).toMatchObject({ provider: "google_play", providerSubscriptionId: TOKEN });
    expect(revenue()).toEqual([expect.objectContaining({ userId: fx.memberA.id, providerRef: "GPA.1", ownerGym: { scope: "platform" } })]);
  });

  it("always stamps the revenue event platform scope, regardless of the session user's own gym", async () => {
    await fx.claim(fx.memberB.id, TOKEN, { orderId: "GPA.gymb" });
    expect(revenue()).toEqual([expect.objectContaining({ userId: fx.memberB.id, ownerGym: { scope: "platform" } })]);
  });

  it("stays idempotent for the same owner: same id/createdAt kept, entitlement refreshed for the same user", async () => {
    await fx.claim(fx.memberA.id, TOKEN, { orderId: "GPA.1" });
    const first = fx.db.findGooglePlayPurchaseByToken(TOKEN)!;

    const res = await fx.verify(fx.memberA.id, { purchaseToken: TOKEN });

    expect(res.status).toBe(200);
    expect(fx.db.findGooglePlayPurchaseByToken(TOKEN)).toMatchObject({ id: first.id, userId: fx.memberA.id, createdAt: first.createdAt });
    expect(fx.db.findGooglePlayPurchasesByUserId(fx.memberA.id)).toHaveLength(1);
    expect(revenue()).toHaveLength(1); // this order is already booked
  });

  it("rejects a different user replaying a recorded token, before the provider call, writing nothing", async () => {
    await fx.claim(fx.memberA.id, TOKEN);
    const calls = fx.adapter.fetchCalls.length;
    const subBefore = fx.db.findSubscriptionByUserId(fx.memberA.id);
    const revenueBefore = revenue().length;

    const res = await fx.verify(fx.memberB.id, { purchaseToken: TOKEN });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ success: false, code: "owned_by_other", message: "This purchase is already linked to another account." });
    expect(fx.adapter.fetchCalls.length).toBe(calls);
    expect(fx.adapter.ackCalls.filter((t) => t === TOKEN)).toHaveLength(1); // only the rightful claim's acknowledgement
    expect(fx.db.findSubscriptionByUserId(fx.memberB.id)).toBeUndefined();
    expect(fx.db.findSubscriptionByUserId(fx.memberA.id)).toEqual(subBefore);
    expect(revenue()).toHaveLength(revenueBefore);
  });

  it("leaves the existing owner and entitlement untouched after a rejected claim, and the rightful owner's retry still works", async () => {
    await fx.claim(fx.memberA.id, TOKEN);

    const denied = await fx.verify(fx.memberB.id, { purchaseToken: TOKEN });
    expect(denied.status).toBe(409);
    expect(fx.db.findGooglePlayPurchaseByToken(TOKEN)?.userId).toBe(fx.memberA.id);
    expect(fx.db.findSubscriptionByUserId(fx.memberB.id)).toBeUndefined();

    const retry = await fx.verify(fx.memberA.id, { purchaseToken: TOKEN });
    expect(retry.status).toBe(200);
    expect(fx.db.findGooglePlayPurchaseByToken(TOKEN)?.userId).toBe(fx.memberA.id);
  });

  it("re-checks ownership after the provider call, in case another account claims the token during verification", async () => {
    // memberB's request is held at the provider while memberA claims the token for real.
    fx.adapter.setSnapshot(TOKEN, { accountBinding: fx.bindingFor(fx.memberB.id) });
    const gate = fx.adapter.gateNextFetch();
    const pending = fx.verify(fx.memberB.id, { purchaseToken: TOKEN });
    // Wait until the request is actually inside the provider call.
    while (fx.adapter.fetchCalls.length === 0) await new Promise((resolve) => setTimeout(resolve, 2));

    fx.db.claimGooglePlayPurchase(
      {
        purchaseToken: TOKEN,
        productId: "app_subscription",
        basePlanId: "monthly",
        orderId: null,
        linkedPurchaseToken: null,
        status: "active",
        acknowledged: true,
        autoRenewing: true,
        startTimeMillis: 1,
        expiryTimeMillis: 2,
        obfuscatedExternalAccountId: fx.bindingFor(fx.memberA.id),
        acknowledgementState: "acknowledged",
      },
      fx.memberA.id
    );
    gate.release();

    const res = await pending;
    expect(res.status).toBe(409);
    expect(fx.adapter.fetchCalls).toHaveLength(1);
    expect(fx.db.findGooglePlayPurchaseByToken(TOKEN)?.userId).toBe(fx.memberA.id);
    expect(fx.db.findSubscriptionByUserId(fx.memberB.id)).toBeUndefined();
  });

  it("ignores a client-supplied userId / gymId: only the session user is ever used", async () => {
    await fx.claim(fx.memberA.id, TOKEN);

    const spoofed = await fx.verify(fx.memberB.id, { purchaseToken: TOKEN, userId: fx.memberA.id, gymId: null });
    expect(spoofed.status).toBe(409);

    fx.adapter.setSnapshot("another-token", { accountBinding: fx.bindingFor(fx.memberB.id), orderId: "GPA.other" });
    const fresh = await fx.verify(fx.memberB.id, { purchaseToken: "another-token", userId: fx.memberA.id, gymId: "gym-x" });
    expect(fresh.status).toBe(200);
    expect(fx.db.findGooglePlayPurchaseByToken("another-token")?.userId).toBe(fx.memberB.id);
    expect(fx.db.findSubscriptionByUserId(fx.memberB.id)).toMatchObject({ provider: "google_play", providerSubscriptionId: "another-token" });
  });
});

describe("POST /api/mobile/billing/google-play/verify — existing behavior unchanged", () => {
  it("rejects an unauthenticated request with 401 before anything else", async () => {
    const res = await fx.verify(undefined, { purchaseToken: TOKEN });
    expect(res.status).toBe(401);
    expect((await res.json()).message).toBe("You must be signed in to verify a purchase.");
    expect(fx.adapter.fetchCalls).toEqual([]);
    expect(fx.db.findGooglePlayPurchaseByToken(TOKEN)).toBeUndefined();
  });

  it("returns 503 when Google Play isn't configured", async () => {
    fx.adapter.configured = false;
    const res = await fx.verify(fx.memberA.id, { purchaseToken: TOKEN });
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("not_configured");
    expect(fx.db.findGooglePlayPurchaseByToken(TOKEN)).toBeUndefined();
  });

  it("preserves request validation (bad JSON, missing/blank token)", async () => {
    const badJson = await fx.verify(fx.memberA.id, undefined, "{not json");
    expect(badJson.status).toBe(400);
    expect((await badJson.json()).message).toBe("Invalid JSON body.");

    const noToken = await fx.verify(fx.memberA.id, {});
    expect(noToken.status).toBe(400);
    expect((await noToken.json()).message).toBe("A purchase token is required.");

    expect((await fx.verify(fx.memberA.id, { purchaseToken: "   " })).status).toBe(400);
    expect((await fx.verify(fx.memberA.id, { purchaseToken: 42 })).status).toBe(400);
    expect((await fx.verify(fx.memberA.id, { purchaseToken: "x".repeat(5000) })).status).toBe(400);
    expect(fx.adapter.fetchCalls).toEqual([]);
  });

  it("returns 400 with a SANITIZED message for a token the provider does not recognise, writing nothing", async () => {
    const res = await fx.verify(fx.memberA.id, { purchaseToken: "bogus" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, code: "provider_rejected", message: "This purchase could not be verified." });
    expect(fx.db.findGooglePlayPurchaseByToken("bogus")).toBeUndefined();
  });

  it("still rejects a token that doesn't match a known App Subscription product", async () => {
    fx.adapter.setSnapshot(TOKEN, { accountBinding: fx.bindingFor(fx.memberA.id), productId: "some_other_product" });
    const res = await fx.verify(fx.memberA.id, { purchaseToken: TOKEN });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("This purchase doesn't match a known App Subscription product.");
    expect(fx.db.findGooglePlayPurchaseByToken(TOKEN)).toBeUndefined();
    expect(fx.adapter.ackCalls).toEqual([]);
  });

  it("still returns 409 'still being processed' for a pending purchase, granting nothing", async () => {
    fx.adapter.setSnapshot(TOKEN, { accountBinding: fx.bindingFor(fx.memberA.id), state: "SUBSCRIPTION_STATE_PENDING" });
    const res = await fx.verify(fx.memberA.id, { purchaseToken: TOKEN });
    expect(res.status).toBe(409);
    expect((await res.json()).message).toBe("Your purchase is still being processed by Google Play. Try again shortly.");
    expect(fx.db.findSubscriptionByUserId(fx.memberA.id)).toBeUndefined();
    expect(fx.adapter.ackCalls).toEqual([]);
  });
});
