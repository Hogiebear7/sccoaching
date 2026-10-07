// Account-binding enforcement for POST /api/mobile/billing/google-play/verify.
//
// A purchase token with NO existing owner (a "first claim") must also carry the obfuscated account binding
// Google echoes back from the client's own setObfuscatedAccountId() call, matching this session user's
// expected value (lib/providers/google-play.ts googlePlayObfuscatedAccountId). This is a SEPARATE protection
// from the ownership check: ownership stops a second account claiming an ALREADY-claimed token; binding stops
// the FIRST account to submit a token from claiming it without proof it is the actual purchaser.
//
// Ported from a mocked-datastore version to the REAL route handler, a REAL datastore file and a fake provider
// adapter (see helpers/iap-play-fixture.ts). Every original case is kept with its original assertion. The real
// googlePlayObfuscatedAccountId / googlePlayAccountBindingMatches run against SESSION_SECRET from
// vitest.config.ts. Synthetic users, tokens and provider responses only.
//
// Contract additions (not weakenings): failure bodies now also carry a stable `code`, and the success body also
// reports `acknowledged`.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPlayFixture, type PlayFixture } from "../helpers/iap-play-fixture";

let fx: PlayFixture;
const TOKEN = "play-token-binding-1";

const nothingWritten = (userId: string) => {
  expect(fx.db.findGooglePlayPurchaseByToken(TOKEN)).toBeUndefined();
  expect(fx.adapter.ackCalls).toEqual([]);
  expect(fx.db.findSubscriptionByUserId(userId)).toBeUndefined();
  expect(fx.db.findAllRevenueEvents()).toEqual([]);
};

beforeEach(async () => {
  fx = await createPlayFixture();
});
afterEach(() => fx.cleanup());

describe("POST /api/mobile/billing/google-play/verify — account binding (first claim)", () => {
  it("1. matching obfuscated account binding succeeds", async () => {
    const binding = fx.bindingFor(fx.memberA.id);
    fx.adapter.setSnapshot(TOKEN, { accountBinding: binding, acknowledged: true });

    const res = await fx.verify(fx.memberA.id, { purchaseToken: TOKEN });

    expect(res.status).toBe(200);
    expect(fx.db.findGooglePlayPurchaseByToken(TOKEN)).toMatchObject({ userId: fx.memberA.id, obfuscatedExternalAccountId: binding });
    expect(fx.db.findSubscriptionByUserId(fx.memberA.id)).toMatchObject({ provider: "google_play", providerSubscriptionId: TOKEN, status: "active", packageId: fx.ids.appPackage });
  });

  it("2. mismatched binding is rejected", async () => {
    fx.adapter.setSnapshot(TOKEN, { accountBinding: fx.bindingFor(fx.memberB.id) });

    const res = await fx.verify(fx.memberA.id, { purchaseToken: TOKEN });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ success: false, code: "binding_required", message: "This purchase could not be verified for your account." });
    nothingWritten(fx.memberA.id);
  });

  it("3. missing provider binding is rejected for a new unowned token", async () => {
    fx.adapter.setSnapshot(TOKEN, { accountBinding: null });
    const res = await fx.verify(fx.memberA.id, { purchaseToken: TOKEN });
    expect(res.status).toBe(409);
    nothingWritten(fx.memberA.id);
  });

  it("4. malformed (garbage/truncated) binding is rejected rather than throwing", async () => {
    fx.adapter.setSnapshot(TOKEN, { accountBinding: "not-a-real-hmac" });
    const res = await fx.verify(fx.memberA.id, { purchaseToken: TOKEN });
    expect(res.status).toBe(409);
    nothingWritten(fx.memberA.id);
  });

  it("5. a client-supplied conflicting binding field cannot override the server-derived expected value", async () => {
    // Google's response is the only source of the binding. A request body that smuggles one in has no effect.
    fx.adapter.setSnapshot(TOKEN, { accountBinding: fx.bindingFor(fx.memberB.id) });
    const res = await fx.verify(fx.memberA.id, { purchaseToken: TOKEN, obfuscatedExternalAccountId: fx.bindingFor(fx.memberA.id) });
    expect(res.status).toBe(409);
    nothingWritten(fx.memberA.id);
  });

  it("6. a token already owned by the same user stays idempotent without needing to resend a binding", async () => {
    await fx.claim(fx.memberA.id, TOKEN);
    fx.adapter.setSnapshot(TOKEN, { accountBinding: null }); // a "restore purchases" replay may carry none
    const res = await fx.verify(fx.memberA.id, { purchaseToken: TOKEN });
    expect(res.status).toBe(200);
    expect(fx.db.findSubscriptionByUserId(fx.memberA.id)).toMatchObject({ provider: "google_play", status: "active" });
  });

  it("7. a token owned by another user is rejected before binding is ever considered", async () => {
    await fx.claim(fx.memberA.id, TOKEN);
    const calls = fx.adapter.fetchCalls.length;
    // The rival even presents a perfectly valid binding of their own.
    fx.adapter.setSnapshot(TOKEN, { accountBinding: fx.bindingFor(fx.memberB.id) });

    const res = await fx.verify(fx.memberB.id, { purchaseToken: TOKEN });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ success: false, code: "owned_by_other", message: "This purchase is already linked to another account." });
    expect(fx.adapter.fetchCalls.length).toBe(calls); // rejected before any provider call
    expect(fx.db.findGooglePlayPurchaseByToken(TOKEN)?.userId).toBe(fx.memberA.id);
    expect(fx.db.findSubscriptionByUserId(fx.memberB.id)).toBeUndefined();
  });

  it("8. concurrent first-claim attempts for the same brand-new token cannot both create or both own it", async () => {
    fx.adapter.setSnapshot(TOKEN, { accountBinding: fx.bindingFor(fx.memberA.id) });
    // Both "requests" carry the OWNER's correct binding: two taps by the real purchaser, isolating atomicity
    // from the binding-mismatch case.
    const [first, second] = await Promise.all([fx.verify(fx.memberA.id, { purchaseToken: TOKEN }), fx.verify(fx.memberA.id, { purchaseToken: TOKEN })]);

    expect([first.status, second.status].sort()).toEqual([200, 200]);
    expect(fx.db.findGooglePlayPurchasesByUserId(fx.memberA.id)).toHaveLength(1);
    expect(fx.db.findGooglePlayPurchaseByToken(TOKEN)?.userId).toBe(fx.memberA.id);
  });

  it("8b. two DIFFERENT accounts racing for one token: exactly one wins, and it is the one with the matching binding", async () => {
    fx.adapter.setSnapshot(TOKEN, { accountBinding: fx.bindingFor(fx.memberA.id) });
    const [a, b] = await Promise.all([fx.verify(fx.memberB.id, { purchaseToken: TOKEN }), fx.verify(fx.memberA.id, { purchaseToken: TOKEN })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(fx.db.findGooglePlayPurchaseByToken(TOKEN)?.userId).toBe(fx.memberA.id);
    expect(fx.db.findSubscriptionByUserId(fx.memberB.id)).toBeUndefined();
  });

  it("9. provider verification failure creates no entitlement (binding never even considered)", async () => {
    // No snapshot configured: the fake provider answers not_found for an unknown token.
    const res = await fx.verify(fx.memberA.id, { purchaseToken: TOKEN });
    expect(res.status).toBe(400);
    nothingWritten(fx.memberA.id);
  });

  it("10. replayed verification for the same owned token does not duplicate entitlement or revenue", async () => {
    await fx.claim(fx.memberA.id, TOKEN, { orderId: "GPA.replay-1" });
    const events = () => fx.db.findAllRevenueEvents().filter((e) => e.providerRef === "GPA.replay-1");
    const before = events().length;

    const res = await fx.verify(fx.memberA.id, { purchaseToken: TOKEN });

    expect(res.status).toBe(200);
    expect(fx.db.findGooglePlayPurchasesByUserId(fx.memberA.id)).toHaveLength(1);
    expect(events().length).toBe(before);
    expect(before).toBe(1);
  });

  it("13. a legacy record with no stored binding still verifies for its existing owner (the ownership check protects it)", async () => {
    // A row from before the binding field existed: no obfuscatedExternalAccountId, no IAP fields at all.
    fx.db.saveGooglePlayPurchase({
      id: "legacy-1",
      userId: fx.memberA.id,
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
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    fx.adapter.setSnapshot(TOKEN, { accountBinding: null, acknowledged: true });

    const res = await fx.verify(fx.memberA.id, { purchaseToken: TOKEN });

    expect(res.status).toBe(200);
    expect(fx.db.findGooglePlayPurchaseByToken(TOKEN)).toMatchObject({ id: "legacy-1", userId: fx.memberA.id });
    // And another account still cannot take it over.
    expect((await fx.verify(fx.memberB.id, { purchaseToken: TOKEN })).status).toBe(409);
  });

  it("14. no raw token or binding value appears in an error response body", async () => {
    fx.adapter.setSnapshot(TOKEN, { accountBinding: null });
    const res = await fx.verify(fx.memberA.id, { purchaseToken: TOKEN });
    const text = await res.text();
    expect(res.status).toBe(409);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(fx.bindingFor(fx.memberA.id));
  });
});
