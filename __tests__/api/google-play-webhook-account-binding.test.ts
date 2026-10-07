// Confirms the RTDN webhook (app/api/webhooks/google-play/route.ts) never needs, reads, or trusts a client-supplied
// account binding: it only ever re-checks an ALREADY-linked purchase token against Google and updates the
// persisted record, so obfuscatedExternalAccountId (set once, at first-claim time, by the verify route) survives
// every later renewal, cancellation or refund update untouched.
//
// Ported from a mocked-datastore version to the REAL route handlers, a REAL datastore file and a fake provider
// adapter (helpers/iap-play-fixture.ts). Every original case is kept. Synthetic data only.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPlayFixture, type PlayFixture } from "../helpers/iap-play-fixture";

let fx: PlayFixture;
const TOKEN = "play-token-webhook-1";

beforeEach(async () => {
  fx = await createPlayFixture();
});
afterEach(() => fx.cleanup());

describe("RTDN webhook — revenue event ownership", () => {
  it("stamps a new revenue event with platform scope on an active renewal", async () => {
    await fx.claim(fx.memberA.id, TOKEN, { orderId: "GPA.first" });
    fx.adapter.setSnapshot(TOKEN, { orderId: "GPA.renewal-1", expiryTimeMillis: Date.now() + 30 * 86_400_000 });

    const res = await fx.rtdn(fx.subscriptionEvent(TOKEN, 2));

    expect(res.status).toBe(200);
    expect(fx.db.findAllRevenueEvents()).toContainEqual(
      expect.objectContaining({ userId: fx.memberA.id, providerRef: "GPA.renewal-1", ownerGym: { scope: "platform" } })
    );
  });
});

describe("RTDN webhook — obfuscatedExternalAccountId preserved, never client-trusted", () => {
  it("11/12. a cancellation/revocation notification preserves the originally-recorded binding and updates entitlement only for the persisted owner", async () => {
    await fx.claim(fx.memberA.id, TOKEN);
    const binding = fx.bindingFor(fx.memberA.id);
    // Google now reports the subscription expired, and no longer echoes any binding.
    fx.adapter.setSnapshot(TOKEN, { state: "SUBSCRIPTION_STATE_EXPIRED", expiryTimeMillis: Date.now() - 1000, accountBinding: null });

    const res = await fx.rtdn(fx.subscriptionEvent(TOKEN, 3));

    expect(res.status).toBe(200);
    expect(fx.db.findGooglePlayPurchaseByToken(TOKEN)).toMatchObject({ obfuscatedExternalAccountId: binding, userId: fx.memberA.id, status: "expired" });
    // The notification carries no account identity, so the change lands on the PERSISTED owner and nobody else.
    expect(fx.db.findSubscriptionByUserId(fx.memberA.id)).toMatchObject({ status: "canceled", provider: "google_play" });
    expect(fx.db.findSubscriptionByUserId(fx.memberB.id)).toBeUndefined();
  });

  it("12. a notification for a token with no persisted owner is ignored, not used to bind a new account", async () => {
    fx.adapter.setSnapshot("unlinked-token", { accountBinding: fx.bindingFor(fx.memberB.id) });

    const res = await fx.rtdn(fx.subscriptionEvent("unlinked-token", 3));

    expect(res.status).toBe(200);
    expect(fx.db.findGooglePlayPurchaseByToken("unlinked-token")).toBeUndefined();
    expect(fx.db.findSubscriptionByUserId(fx.memberB.id)).toBeUndefined();
    expect(fx.adapter.fetchCalls).toEqual([]);
  });
});
