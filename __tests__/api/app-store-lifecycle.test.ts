// The App Store digital-plan lifecycle, end to end through the REAL route handlers, the REAL service, REAL signature and
// certificate-chain verification (against a generated test root) and a REAL datastore file. Only "read this subscription's
// state from Apple" is faked (helpers/app-store-fixture.ts). No network, no Apple account, no real transaction.
//
// Covers: purchase and verified activation; the account binding and ownership rules (a purchase can never be granted to an
// unrelated account); restore; renewal; cancel-with-access-to-the-paid-date; expiry; refund and revocation; billing retry and
// grace; duplicate and out-of-order notifications; forged notifications; environment (sandbox) policy; cross-store rules;
// reconciliation; account deletion; audit; kill switch.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppStoreFixture, fakeTransaction, signJws, type AppStoreFixture, APPLE_PRODUCT_ID, BUNDLE_ID } from "../helpers/app-store-fixture";

let fx: AppStoreFixture;
const O1 = "fake-otx-1";
const O2 = "fake-otx-2";
const DAY = 86_400_000;

const ent = (userId = fx.memberA.id) => fx.db.findDigitalEntitlement(userId, "app_store");
const purchase = (orig = O1) => fx.db.findAppStorePurchaseByOriginalTransactionId(orig);
const eventTypes = () => fx.db.findIapEvents().map((e) => e.type);
const access = async (userId = fx.memberA.id) => (await import("@/lib/membership-entitlement")).resolveMemberAccessForUser(userId);
const digital = async (userId = fx.memberA.id) => (await access(userId)).digital;

beforeEach(async () => {
  fx = await createAppStoreFixture();
});
afterEach(() => fx.cleanup());

describe("purchase context (the account binding the app must set)", () => {
  it("returns the session user's own token and nobody else's, ignoring any client-supplied id", async () => {
    const res = await fx.context(fx.memberA.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ appAccountToken: fx.tokenFor(fx.memberA.id), environment: "test" });
    expect(body.data.appAccountToken).not.toBe(fx.tokenFor(fx.memberB.id));
    expect(body.data.appAccountToken).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); // a UUID, as StoreKit requires
    expect(JSON.stringify(body)).not.toContain(fx.memberA.id); // one-way: no raw user id
  });

  it("requires a session", async () => {
    expect((await fx.context(undefined)).status).toBe(401);
  });

  it("is refused when the App Store is not configured, and while the kill switch is off", async () => {
    fx.adapter.configured = false;
    expect((await fx.context(fx.memberA.id)).status).toBe(503);
    fx.adapter.configured = true;

    fx.cleanup();
    fx = await createAppStoreFixture({ enabled: false });
    const res = await fx.context(fx.memberA.id);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("iap_disabled");
  });

  it("is available to a member with a gym Membership (a separate product)", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "active" });
    expect((await fx.context(fx.memberA.id)).status).toBe(200);
  });

  it("is refused while a paid subscription is live, so no second purchase starts", async () => {
    await fx.claim(fx.memberA.id, O1);
    const res = await fx.context(fx.memberA.id);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("subscription_already_active");
  });
});

describe("the catalog carries store product ids and NO price", () => {
  it("lists the mapped product ids per period, and never states an amount", async () => {
    const res = await fx.catalog(fx.memberA.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.plans).toEqual([
      expect.objectContaining({ billingOptionId: fx.ids.appOption, appStoreProductId: APPLE_PRODUCT_ID, googlePlayProductId: "app_subscription", googlePlayBasePlanId: "monthly", intervalUnit: "month", intervalCount: 1 }),
    ]);
    expect(JSON.stringify(body)).not.toMatch(/amount|price|currency|cents/i);
  });

  it("requires a session", async () => {
    expect((await fx.catalog(undefined)).status).toBe(401);
  });
});

describe("purchase and verified activation", () => {
  it("activates only after Apple's live state is read, and records everything", async () => {
    expect(await digital()).toBe(false);
    const res = await fx.claim(fx.memberA.id, O1, { tx: { transactionId: "tx-1" } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      message: "Purchase verified.",
      data: {
        access: { digital: true, gymMembership: false },
        plan: { source: "app_store", status: "active", currentPeriodEnd: expect.any(String), autoRenewing: true, trial: false, environment: "production" },
        status: "active",
        acknowledged: true,
      },
    });
    expect(fx.adapter.fetchCalls).toEqual([O1]);
    expect(purchase()).toMatchObject({ userId: fx.memberA.id, environment: "production", status: "active", autoRenewing: true, latestTransactionId: "tx-1", appAccountToken: fx.tokenFor(fx.memberA.id) });
    expect(ent()).toMatchObject({ source: "app_store", status: "active", storeRefHash: fx.db.hashPurchaseToken(O1), billingOptionId: fx.ids.appOption, environment: "production" });
    expect(fx.db.findSubscriptionByUserId(fx.memberA.id)).toBeUndefined(); // the gym Membership row is never written
    expect(eventTypes()).toEqual(expect.arrayContaining(["purchase_claimed", "entitlement_granted"]));
  });

  it("books one revenue event per Apple transaction, for production purchases only", async () => {
    await fx.claim(fx.memberA.id, O1, { tx: { transactionId: "tx-rev-1" } });
    expect(fx.db.findAllRevenueEvents().map((e) => [e.provider, e.providerRef])).toEqual([["app_store", "apple:tx-rev-1"]]);
    await fx.verify(fx.memberA.id, { signedTransaction: fx.signedTransaction(fx.memberA.id, O1) }); // replay
    expect(fx.db.findAllRevenueEvents()).toHaveLength(1);
  });

  it("a claim is idempotent for the same account", async () => {
    await fx.claim(fx.memberA.id, O1);
    const before = ent();
    const again = await fx.verify(fx.memberA.id, { signedTransaction: fx.signedTransaction(fx.memberA.id, O1) });
    expect(again.status).toBe(200);
    expect(ent()?.storeRefHash).toBe(before?.storeRefHash);
    expect(fx.db.findAppStorePurchasesByUserId(fx.memberA.id)).toHaveLength(1);
  });

  it("two simultaneous claims of the same purchase leave one purchase row and one entitlement", async () => {
    fx.adapter.setLive(O1, { tx: { appAccountToken: fx.tokenFor(fx.memberA.id) } });
    const signed = fx.signedTransaction(fx.memberA.id, O1);
    const [a, b] = await Promise.all([fx.verify(fx.memberA.id, { signedTransaction: signed }), fx.verify(fx.memberA.id, { signedTransaction: signed })]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(fx.db.findAppStorePurchasesByUserId(fx.memberA.id)).toHaveLength(1);
    expect(fx.db.findDigitalEntitlementsByUserId(fx.memberA.id)).toHaveLength(1);
  });

  it("a gym Membership neither blocks the purchase nor is changed by it", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "active" });
    const before = fx.db.findSubscriptionByUserId(fx.memberA.id);
    expect((await fx.claim(fx.memberA.id, O1)).status).toBe(200);
    expect(fx.db.findSubscriptionByUserId(fx.memberA.id)).toEqual(before);
    expect(await access()).toEqual({ digital: true, gymMembership: true });
  });

  it.each(["timeout", "network", "server_error", "rate_limited", "unauthorized"] as const)("an Apple %s grants nothing and answers a retryable 502", async (code) => {
    fx.adapter.setLive(O1, { tx: { appAccountToken: fx.tokenFor(fx.memberA.id) } });
    fx.adapter.failFetch(code);
    const res = await fx.verify(fx.memberA.id, { signedTransaction: fx.signedTransaction(fx.memberA.id, O1) });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ success: false, code: "provider_unavailable", message: "The App Store couldn't be reached. Try again shortly." });
    expect(purchase()).toBeUndefined();
    expect(ent()).toBeUndefined();
    expect(await digital()).toBe(false);
  });

  it("Apple not recognising the subscription is a 400 and grants nothing, with no provider text", async () => {
    const res = await fx.verify(fx.memberA.id, { signedTransaction: fx.signedTransaction(fx.memberA.id, "never-seen") });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, code: "provider_rejected", message: "This purchase could not be verified." });
    expect(purchase("never-seen")).toBeUndefined();
  });

  it("a state Apple reports that this server does not recognise binds nothing and can simply be tried again", async () => {
    const res = await fx.claim(fx.memberA.id, O1, { status: 99 });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("purchase_pending");
    expect(purchase()).toBeUndefined();
    expect(ent()).toBeUndefined();
    fx.adapter.setLive(O1, { status: 1 });
    expect((await fx.verify(fx.memberA.id, { signedTransaction: fx.signedTransaction(fx.memberA.id, O1) })).status).toBe(200);
  });

  it("a subscription Apple already revoked is recorded as revoked and grants no access", async () => {
    const res = await fx.claim(fx.memberA.id, O1, { status: 5, tx: { revocationDate: Date.now() - 1000, revocationReason: 1 } });
    expect(res.status).toBe(200);
    expect(purchase()?.status).toBe("revoked");
    expect(await digital()).toBe(false);
  });

  it("an expired subscription is recorded but grants no access", async () => {
    const res = await fx.claim(fx.memberA.id, O1, { status: 2, tx: { expiresDate: Date.now() - DAY } });
    expect(res.status).toBe(200);
    expect(await digital()).toBe(false);
    expect(ent()?.status).toBe("expired");
  });

  it("a response never contains the transaction id or any Apple text", async () => {
    const res = await fx.claim(fx.memberA.id, O1, { tx: { transactionId: "tx-secret-ref" } });
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(O1);
    expect(text).not.toContain("tx-secret-ref");
  });
});

describe("the account binding and ownership: a purchase can never be granted to an unrelated account", () => {
  it("rejects a purchase made without the account token", async () => {
    fx.adapter.setLive(O1, {});
    const res = await fx.verify(fx.memberA.id, { signedTransaction: signJws(fakeTransaction({ originalTransactionId: O1 })) });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("binding_required");
    expect(purchase()).toBeUndefined();
    expect(ent()).toBeUndefined();
    expect(eventTypes()).toContain("claim_rejected_binding");
  });

  it("rejects a purchase carrying SOMEONE ELSE'S token (a stolen or replayed transaction), and binds nothing", async () => {
    fx.adapter.setLive(O1, { tx: { appAccountToken: fx.tokenFor(fx.memberA.id) } });
    const res = await fx.verify(fx.memberB.id, { signedTransaction: fx.signedTransaction(fx.memberA.id, O1) });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("binding_required");
    expect(purchase()).toBeUndefined();
    expect(await digital(fx.memberB.id)).toBe(false);
    // The real purchaser is unharmed: the failed attempt bound nothing.
    expect((await fx.verify(fx.memberA.id, { signedTransaction: fx.signedTransaction(fx.memberA.id, O1) })).status).toBe(200);
    expect(purchase()?.userId).toBe(fx.memberA.id);
  });

  it("rejects a transaction whose signed token matches but Apple's live record names a different account token", async () => {
    fx.adapter.setLive(O1, { tx: { appAccountToken: fx.tokenFor(fx.memberB.id) } });
    const res = await fx.verify(fx.memberA.id, { signedTransaction: fx.signedTransaction(fx.memberA.id, O1) });
    expect(res.status).toBe(409);
    expect(purchase()).toBeUndefined();
  });

  it("accepts the token in either letter case", async () => {
    fx.adapter.setLive(O1, { tx: { appAccountToken: fx.tokenFor(fx.memberA.id).toUpperCase() } });
    const res = await fx.verify(fx.memberA.id, { signedTransaction: fx.signedTransaction(fx.memberA.id, O1, { appAccountToken: fx.tokenFor(fx.memberA.id).toUpperCase() }) });
    expect(res.status).toBe(200);
  });

  it("a purchase already owned by one account is never granted to another, even with a valid token of their own presented elsewhere", async () => {
    await fx.claim(fx.memberA.id, O1);
    const calls = fx.adapter.fetchCalls.length;
    // B presents A's genuine signed transaction (Restore Purchases while signed in as B on a shared Apple ID).
    const res = await fx.verify(fx.memberB.id, { signedTransaction: fx.signedTransaction(fx.memberA.id, O1) });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ success: false, code: "owned_by_other", message: "This purchase is already linked to another account. Sign in to the account you bought it with." });
    expect(fx.adapter.fetchCalls.length).toBe(calls); // refused before Apple is asked
    expect(purchase()?.userId).toBe(fx.memberA.id);
    expect(await digital(fx.memberB.id)).toBe(false);
    expect(eventTypes()).toContain("claim_rejected_owner");
  });

  it("restore: the owner can re-present the purchase without any token", async () => {
    await fx.claim(fx.memberA.id, O1);
    fx.adapter.setLive(O1, { tx: { appAccountToken: undefined } });
    const res = await fx.verify(fx.memberA.id, { signedTransaction: fx.signedTransaction(null, O1) });
    expect(res.status).toBe(200);
  });

  it("restore after the owner deleted nothing and re-installed: a lapsed subscription restores as ended, not as access", async () => {
    await fx.claim(fx.memberA.id, O1);
    fx.adapter.setLive(O1, { status: 2, tx: { expiresDate: Date.now() - DAY } });
    const res = await fx.verify(fx.memberA.id, { signedTransaction: fx.signedTransaction(fx.memberA.id, O1) });
    expect(res.status).toBe(200);
    expect(await digital()).toBe(false);
  });

  it("the account is always the signed session user: a client-supplied userId or gymId is ignored", async () => {
    fx.adapter.setLive(O1, { tx: { appAccountToken: fx.tokenFor(fx.memberB.id) } });
    const res = await fx.verify(fx.memberB.id, { signedTransaction: fx.signedTransaction(fx.memberB.id, O1), userId: fx.memberA.id, gymId: "gym-x" });
    expect(res.status).toBe(200);
    expect(purchase()?.userId).toBe(fx.memberB.id);
    expect(await digital(fx.memberA.id)).toBe(false);
  });

  it("requires a session", async () => {
    expect((await fx.verify(undefined, { signedTransaction: "x" })).status).toBe(401);
  });
});

describe("a forged or unverifiable transaction grants nothing and never reaches Apple", () => {
  const expectRefused = (res: Response, status = 400) => expect(res.status).toBe(status);

  it("a transaction signed through a chain that does not lead to Apple's root", async () => {
    const res = await fx.verify(fx.memberA.id, { signedTransaction: fx.signedTransaction(fx.memberA.id, O1, {}, "rogue") });
    expectRefused(res);
    expect((await res.json()).code).toBe("provider_rejected");
    expect(fx.adapter.fetchCalls).toEqual([]);
    expect(purchase()).toBeUndefined();
  });

  it("a genuine transaction altered after signing", async () => {
    const [h, , s] = fx.signedTransaction(fx.memberA.id, O1).split(".");
    const forgedPayload = Buffer.from(JSON.stringify(fakeTransaction({ originalTransactionId: O1, appAccountToken: fx.tokenFor(fx.memberA.id), productId: "other" }) as unknown as Record<string, unknown>)).toString("base64url");
    expectRefused(await fx.verify(fx.memberA.id, { signedTransaction: `${h}.${forgedPayload}.${s}` }));
    expect(fx.adapter.fetchCalls).toEqual([]);
  });

  it.each([undefined, null, 42, {}, "", "not-a-jws", "a.b.c"])("rejects a missing or malformed signedTransaction %#", async (value) => {
    const res = await fx.verify(fx.memberA.id, { signedTransaction: value });
    expect(res.status).toBe(400);
    expect(fx.adapter.fetchCalls).toEqual([]);
  });

  it("rejects an invalid JSON body", async () => {
    const res = await fx.verify(fx.memberA.id, undefined, "{nope");
    expect(res.status).toBe(400);
  });

  it("rejects a transaction for another app", async () => {
    const res = await fx.verify(fx.memberA.id, { signedTransaction: fx.signedTransaction(fx.memberA.id, O1, { bundleId: "com.someone.else" }) });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("product_unknown");
    expect(fx.adapter.fetchCalls).toEqual([]);
  });

  it("rejects a product that is not a known digital plan product", async () => {
    fx.adapter.setLive(O1, { tx: { appAccountToken: fx.tokenFor(fx.memberA.id), productId: "some_other_product" } });
    const res = await fx.verify(fx.memberA.id, { signedTransaction: fx.signedTransaction(fx.memberA.id, O1, { productId: "some_other_product" }) });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("This purchase doesn't match a known digital plan product.");
    expect(purchase()).toBeUndefined();
  });

  it("rejects something that is not an auto-renewable subscription, and a family-shared entitlement", async () => {
    for (const over of [{ type: "Consumable" }, { inAppOwnershipType: "FAMILY_SHARED" }]) {
      fx.adapter.setLive(O1, { tx: { appAccountToken: fx.tokenFor(fx.memberA.id) } });
      const res = await fx.verify(fx.memberA.id, { signedTransaction: fx.signedTransaction(fx.memberA.id, O1, over) });
      expect(res.status).toBe(400);
    }
    expect(purchase()).toBeUndefined();
  });

  it("rejects when Apple's live record is for a different subscription than the one presented", async () => {
    fx.adapter.setLive(O1, { tx: { appAccountToken: fx.tokenFor(fx.memberA.id), bundleId: "com.someone.else" } });
    const res = await fx.verify(fx.memberA.id, { signedTransaction: fx.signedTransaction(fx.memberA.id, O1) });
    expect(res.status).toBe(400);
    expect(purchase()).toBeUndefined();
  });

  it("an unconfigured provider is a 503", async () => {
    fx.adapter.configured = false;
    expect((await fx.verify(fx.memberA.id, { signedTransaction: fx.signedTransaction(fx.memberA.id, O1) })).status).toBe(503);
  });
});

describe("environment policy: sandbox is explicit, never inferred", () => {
  it("a sandbox transaction is refused by default, and audited", async () => {
    fx.adapter.setLive(O1, { environment: "sandbox", tx: { appAccountToken: fx.tokenFor(fx.memberA.id), environment: "Sandbox" } });
    const res = await fx.verify(fx.memberA.id, { signedTransaction: fx.signedTransaction(fx.memberA.id, O1, { environment: "Sandbox" }) });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("environment_not_accepted");
    expect(purchase()).toBeUndefined();
    expect(eventTypes()).toContain("claim_rejected_environment");
    expect(fx.adapter.fetchCalls).toEqual([]);
  });

  it.each(["Xcode", "LocalTesting", "Staging", undefined])("a %s transaction is never accepted, even when sandbox is", async (environment) => {
    fx.cleanup();
    fx = await createAppStoreFixture({ acceptSandbox: true });
    const res = await fx.verify(fx.memberA.id, { signedTransaction: fx.signedTransaction(fx.memberA.id, O1, { environment }) });
    expect(res.status).toBe(409);
    expect(purchase()).toBeUndefined();
  });

  it("with sandbox accepted, a sandbox purchase works, is read from Apple's SANDBOX host, is labelled, and is never revenue", async () => {
    fx.cleanup();
    fx = await createAppStoreFixture({ acceptSandbox: true });
    const res = await fx.claim(fx.memberA.id, O1, { environment: "sandbox", tx: { environment: "Sandbox" }, signedTx: { environment: "Sandbox" } });
    expect(res.status).toBe(200);
    expect(purchase()?.environment).toBe("sandbox");
    expect(ent()?.environment).toBe("sandbox");
    expect((await res.json()).data.plan.environment).toBe("sandbox");
    expect(fx.db.findAllRevenueEvents()).toEqual([]);
  });

  it("a PRODUCTION transaction cannot be satisfied by Apple's sandbox state, and vice versa", async () => {
    fx.cleanup();
    fx = await createAppStoreFixture({ acceptSandbox: true });
    fx.adapter.setLive(O1, { environment: "sandbox", tx: { appAccountToken: fx.tokenFor(fx.memberA.id) } });
    const res = await fx.verify(fx.memberA.id, { signedTransaction: fx.signedTransaction(fx.memberA.id, O1, { environment: "Production" }) });
    expect(res.status).toBe(400);
    expect(purchase()).toBeUndefined();
  });
});

describe("states: grace, billing retry, cancellation, expiry, refund", () => {
  beforeEach(async () => {
    await fx.claim(fx.memberA.id, O1, { tx: { transactionId: "tx-1" } });
  });

  it("a billing grace period keeps access", async () => {
    const graceEnd = Date.now() + 5 * DAY;
    fx.adapter.setLive(O1, { status: 4, renewal: { originalTransactionId: O1, autoRenewStatus: 1, isInBillingRetryPeriod: true, gracePeriodExpiresDate: graceEnd }, tx: { expiresDate: Date.now() - DAY } });
    await fx.notify("DID_FAIL_TO_RENEW", O1, { subtype: "GRACE_PERIOD" });
    expect(ent()?.status).toBe("in_grace_period");
    // Access is bounded by the grace end Apple reported, not left open-ended.
    expect(ent()?.currentPeriodEnd).toBe(new Date(graceEnd).toISOString());
    expect(await digital()).toBe(true);
  });

  it("billing retry WITHOUT a grace period removes access", async () => {
    fx.adapter.setLive(O1, { status: 3, tx: { expiresDate: Date.now() - DAY } });
    await fx.notify("DID_FAIL_TO_RENEW", O1);
    expect(ent()?.status).toBe("on_hold");
    expect(await digital()).toBe(false);
    expect(eventTypes()).toContain("entitlement_expired");
  });

  it("a grace period that outlives the safety cap stops granting access even if its end notification is lost", async () => {
    fx.adapter.setLive(O1, { status: 4, renewal: { originalTransactionId: O1, autoRenewStatus: 1 }, tx: { expiresDate: Date.now() - 40 * DAY } });
    await fx.notify("DID_FAIL_TO_RENEW", O1);
    expect(ent()?.status).toBe("in_grace_period");
    expect(await digital()).toBe(false);
  });

  it("turning auto-renew off keeps access to the paid expiry (cancellation)", async () => {
    const expiry = Date.now() + 10 * DAY;
    fx.adapter.setLive(O1, { renewal: { originalTransactionId: O1, autoRenewStatus: 0 }, tx: { expiresDate: expiry } });
    await fx.notify("DID_CHANGE_RENEWAL_STATUS", O1, { subtype: "AUTO_RENEW_DISABLED" });
    expect(ent()).toMatchObject({ status: "canceled", autoRenewing: false, currentPeriodEnd: new Date(expiry).toISOString() });
    expect(await digital()).toBe(true);
  });

  it("access ends at the paid expiry even if no notification ever arrives", async () => {
    fx.adapter.setLive(O1, { renewal: { originalTransactionId: O1, autoRenewStatus: 0 }, tx: { expiresDate: Date.now() + 10 * DAY } });
    await fx.notify("DID_CHANGE_RENEWAL_STATUS", O1);
    fx.db.saveDigitalEntitlement({ ...ent()!, currentPeriodEnd: new Date(Date.now() - 3_600_000).toISOString() });
    expect(await digital()).toBe(false);
  });

  it("expiry ends access", async () => {
    fx.adapter.setLive(O1, { status: 2, tx: { expiresDate: Date.now() - 1000 } });
    await fx.notify("EXPIRED", O1, { subtype: "VOLUNTARY" });
    expect(ent()?.status).toBe("expired");
    expect(purchase()?.status).toBe("expired");
    expect(await digital()).toBe(false);
  });

  it("a renewal extends the period and books one revenue event per transaction", async () => {
    const expiry = Date.now() + 60 * DAY;
    fx.adapter.setLive(O1, { tx: { transactionId: "tx-2", expiresDate: expiry } });
    await fx.notify("DID_RENEW", O1);
    await fx.notify("DID_RENEW", O1);
    expect(ent()?.currentPeriodEnd).toBe(new Date(expiry).toISOString());
    expect(purchase()?.latestTransactionId).toBe("tx-2");
    expect(fx.db.findAllRevenueEvents().map((e) => e.providerRef).sort()).toEqual(["apple:tx-1", "apple:tx-2"]);
  });

  it("a refund of the CURRENT transaction ends access at once and stays ended", async () => {
    fx.adapter.setLive(O1, { status: 5, tx: { revocationDate: Date.now(), revocationReason: 1 } });
    await fx.notify("REFUND", O1, { tx: { transactionId: "tx-1", revocationDate: Date.now() } });
    expect(ent()?.status).toBe("revoked");
    expect(purchase()).toMatchObject({ status: "revoked", revocationReason: "refunded", revokedAt: expect.any(String) });
    expect(await digital()).toBe(false);
    expect(eventTypes()).toContain("entitlement_revoked");

    // No later state, notification or re-verify can re-entitle it.
    fx.adapter.setLive(O1, { status: 1, tx: { revocationDate: undefined, expiresDate: Date.now() + 30 * DAY } });
    await fx.notify("DID_RENEW", O1);
    await fx.verify(fx.memberA.id, { signedTransaction: fx.signedTransaction(fx.memberA.id, O1) });
    expect(await digital()).toBe(false);
    expect(ent()?.status).toBe("revoked");
  });

  it("a revocation carried only by Apple's SIGNED notification transaction is honoured for the current transaction", async () => {
    // Apple's status endpoint lags, still saying "active"; the signed notification transaction carries the revocation.
    await fx.notify("REVOKE", O1, { tx: { transactionId: "tx-1", revocationDate: Date.now() } });
    expect(ent()?.status).toBe("revoked");
    expect(purchase()?.revocationReason).toBe("revoked");
    expect(await digital()).toBe(false);
  });

  it("a refund of an EARLIER transaction leaves the current period alone", async () => {
    fx.adapter.setLive(O1, { tx: { transactionId: "tx-current", expiresDate: Date.now() + 20 * DAY } });
    await fx.notify("REFUND", O1, { tx: { transactionId: "tx-an-earlier-period", revocationDate: Date.now() } });
    expect(purchase()?.revokedAt ?? null).toBeNull();
    expect(await digital()).toBe(true);
    expect(eventTypes()).toContain("notification_stale");
  });

  it("an ambiguous Apple status records nothing destructive", async () => {
    const before = ent();
    fx.adapter.setLive(O1, { status: 99 });
    await fx.notify("SUBSCRIBED", O1);
    expect(ent()).toEqual(before);
  });

  it("revocation preserves history: the purchase row, its events and the revenue booking remain", async () => {
    const revenue = fx.db.findAllRevenueEvents().length;
    await fx.notify("REVOKE", O1, { tx: { transactionId: "tx-1", revocationDate: Date.now() } });
    expect(purchase()).toBeDefined();
    expect(fx.db.findAllRevenueEvents()).toHaveLength(revenue);
  });
});

describe("notifications: the type is a hint, the live state decides", () => {
  beforeEach(async () => {
    await fx.claim(fx.memberA.id, O1, { tx: { transactionId: "tx-1" } });
  });

  it("an EXPIRED notification while Apple still reports the subscription active changes nothing", async () => {
    const before = ent();
    await fx.notify("EXPIRED", O1);
    expect(ent()?.status).toBe(before?.status);
    expect(await digital()).toBe(true);
  });

  it("an ACTIVE-sounding notification while Apple reports expiry ends access", async () => {
    fx.adapter.setLive(O1, { status: 2, tx: { expiresDate: Date.now() - 1000 } });
    await fx.notify("DID_RENEW", O1);
    expect(await digital()).toBe(false);
  });

  it("processes a duplicate or replayed notification once", async () => {
    const calls = fx.adapter.fetchCalls.length;
    const first = await fx.notify("DID_RENEW", O1, { uuid: "dup-1" });
    const replay = await fx.notify("DID_RENEW", O1, { uuid: "dup-1" });
    expect(first.status).toBe(200);
    expect((await replay.json()).message).toMatch(/Duplicate/);
    expect(fx.adapter.fetchCalls.length).toBe(calls + 1);
  });

  it("drops a slow, older answer that arrives after a newer one (out of order)", async () => {
    const gate = fx.adapter.gateNextFetch();
    const slow = fx.notify("DID_RENEW", O1, { uuid: "slow" });
    while (fx.adapter.fetchCalls.length < 2) await new Promise((r) => setTimeout(r, 2));
    // Apple's state then changes (expired), and a later notification applies first.
    fx.adapter.setLive(O1, { status: 2, tx: { expiresDate: Date.now() - 1000 } });
    await new Promise((r) => setTimeout(r, 5));
    await fx.notify("EXPIRED", O1, { uuid: "fast" });
    expect(ent()?.status).toBe("expired");

    gate.release(); // the slow call now returns the OLD "active" answer
    await slow;
    expect(ent()?.status).toBe("expired");
    expect(await digital()).toBe(false);
    expect(eventTypes()).toContain("notification_stale");
  });

  it("retries a delivery whose provider call failed, using the same id, and then completes it", async () => {
    fx.adapter.setLive(O1, { renewal: { originalTransactionId: O1, autoRenewStatus: 0 } });
    fx.adapter.failFetch("timeout");
    const first = await fx.notify("DID_CHANGE_RENEWAL_STATUS", O1, { uuid: "retry-1" });
    expect(first.status).toBe(502);
    expect(fx.db.findIapNotification("appstore:retry-1")?.processedAt).toBeNull();
    const second = await fx.notify("DID_CHANGE_RENEWAL_STATUS", O1, { uuid: "retry-1" });
    expect(second.status).toBe(200);
    expect(ent()?.status).toBe("canceled");
    expect(fx.db.findIapNotification("appstore:retry-1")).toMatchObject({ outcome: "applied", attempts: 2 });
  });

  it("gives up after the attempt cap with a 200 so Apple stops, leaving it to reconciliation", async () => {
    const { APP_STORE_MAX_NOTIFICATION_ATTEMPTS } = await import("@/lib/iap/apple-service");
    fx.adapter.failFetch("server_error", APP_STORE_MAX_NOTIFICATION_ATTEMPTS + 5);
    let last = 502;
    for (let i = 0; i < APP_STORE_MAX_NOTIFICATION_ATTEMPTS + 1; i++) last = (await fx.notify("DID_RENEW", O1, { uuid: "stuck" })).status;
    expect(last).toBe(200);
    expect(fx.db.findIapNotification("appstore:stuck")?.outcome).toBe("gave_up");
  });

  it("answers 200 and completes when Apple no longer recognises the subscription", async () => {
    fx.adapter.failFetch("not_found");
    const res = await fx.notify("DID_RENEW", O1, { uuid: "gone" });
    expect(res.status).toBe(200);
    expect(fx.db.findIapNotification("appstore:gone")?.outcome).toBe("provider_rejected");
  });

  it("acknowledges a TEST notification without touching anything", async () => {
    const before = ent();
    const res = await fx.notify("TEST", O1);
    expect((await res.json()).message).toBe("Test notification received.");
    expect(ent()).toEqual(before);
  });

  it("ignores a notification for another app, without asking Apple", async () => {
    const calls = fx.adapter.fetchCalls.length;
    const res = await fx.notify("DID_RENEW", O1, { bundleId: "com.someone.else" });
    expect(res.status).toBe(200);
    expect(fx.adapter.fetchCalls.length).toBe(calls);
  });

  it("ignores a sandbox notification when the deployment does not accept sandbox", async () => {
    const calls = fx.adapter.fetchCalls.length;
    const res = await fx.notify("DID_RENEW", O1, { environment: "Sandbox" });
    expect((await res.json()).message).toMatch(/environment/);
    expect(fx.adapter.fetchCalls.length).toBe(calls);
  });

  it("ignores a notification for a subscription not yet linked to a member (the claim reads fresh state itself)", async () => {
    const calls = fx.adapter.fetchCalls.length;
    const res = await fx.notify("SUBSCRIBED", "unlinked-otx");
    expect(res.status).toBe(200);
    expect(fx.adapter.fetchCalls.length).toBe(calls);
    expect(fx.db.findAppStorePurchaseByOriginalTransactionId("unlinked-otx")).toBeUndefined();
  });

  it("never grants access from a notification alone, whatever it says", async () => {
    await fx.notify("SUBSCRIBED", "someone-elses-otx", { subtype: "INITIAL_BUY" });
    expect(fx.db.findDigitalEntitlementsByUserId(fx.memberB.id)).toEqual([]);
  });
});

describe("forged notifications change nothing", () => {
  beforeEach(async () => {
    await fx.claim(fx.memberA.id, O1);
  });

  it("a notification signed through a rogue chain is a 401, is never deduplicated, and reads nothing", async () => {
    const before = ent();
    const calls = fx.adapter.fetchCalls.length;
    const res = await fx.notify("REFUND", O1, { chain: "rogue", uuid: "forged-1", tx: { revocationDate: Date.now() } });
    expect(res.status).toBe(401);
    expect(fx.db.findIapNotification("appstore:forged-1")).toBeUndefined();
    expect(fx.adapter.fetchCalls.length).toBe(calls);
    expect(ent()).toEqual(before);
  });

  it("an altered payload, a missing payload and an invalid body are refused", async () => {
    const good = fx.signedTransaction(null, O1).split(".");
    const tampered = `${good[0]}.${Buffer.from(JSON.stringify({ notificationType: "REFUND", notificationUUID: "x", data: {} })).toString("base64url")}.${good[2]}`;
    expect((await fx.notify("REFUND", O1, { rawSignedPayload: tampered })).status).toBe(401);
    expect((await fx.notify("REFUND", O1, { rawSignedPayload: "" })).status).toBe(400);

    const { POST } = await import("@/app/api/webhooks/app-store/route");
    const { NextRequest } = await import("next/server");
    const bad = await POST(new NextRequest("http://localhost/api/webhooks/app-store", { method: "POST", body: "{nope" }));
    expect(bad.status).toBe(400);
  });

  it("an unconfigured provider answers 503 so Apple retries", async () => {
    fx.adapter.configured = false;
    expect((await fx.notify("DID_RENEW", O1)).status).toBe(503);
  });

  it("the response never contains a transaction id or provider text", async () => {
    const res = await fx.notify("DID_RENEW", O1);
    expect(JSON.stringify(await res.json())).not.toContain(O1);
  });
});

describe("one paid subscription per account, across both stores and within one", () => {
  it("a second App Store subscription on an account with a live one is refused and binds nothing", async () => {
    await fx.claim(fx.memberA.id, O1);
    const res = await fx.claim(fx.memberA.id, O2);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("subscription_already_active");
    expect(purchase(O2)).toBeUndefined();
    expect(ent()?.storeRefHash).toBe(fx.db.hashPurchaseToken(O1));
  });

  it("a live Google Play plan refuses an App Store claim without binding it", async () => {
    const now = new Date().toISOString();
    fx.db.saveDigitalEntitlement({
      id: `google_play:${fx.memberA.id}`, userId: fx.memberA.id, source: "google_play", status: "active", productId: "p", billingOptionId: fx.ids.appOption,
      storeRefHash: "g".repeat(64), environment: null, currentPeriodEnd: new Date(Date.now() + 20 * DAY).toISOString(), autoRenewing: true, grantedByUserId: null, note: null, revokedAt: null, createdAt: now, updatedAt: now,
    });
    const res = await fx.claim(fx.memberA.id, O1);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("other_store_active");
    expect(purchase()).toBeUndefined();
    expect(fx.db.findDigitalEntitlement(fx.memberA.id, "app_store")).toBeUndefined();
    expect((await fx.context(fx.memberA.id)).status).toBe(409);
  });

  it("once the first subscription has ended, the member can subscribe again (a new original transaction takes over)", async () => {
    await fx.claim(fx.memberA.id, O1);
    fx.adapter.setLive(O1, { status: 2, tx: { expiresDate: Date.now() - 1000 } });
    await fx.notify("EXPIRED", O1);
    expect(await digital()).toBe(false);

    expect((await fx.claim(fx.memberA.id, O2)).status).toBe(200);
    expect(ent()?.storeRefHash).toBe(fx.db.hashPurchaseToken(O2));
    expect(await digital()).toBe(true);
    expect(fx.db.findAppStorePurchasesByUserId(fx.memberA.id)).toHaveLength(2); // history kept

    // A late "active" notification for the OLD subscription cannot overwrite the new one.
    fx.adapter.setLive(O1, { status: 1, tx: { expiresDate: Date.now() + 30 * DAY } });
    await fx.notify("DID_RENEW", O1);
    expect(ent()?.storeRefHash).toBe(fx.db.hashPurchaseToken(O2));
  });

  it("an expiry notification for an old subscription never cancels a newer live one", async () => {
    await fx.claim(fx.memberA.id, O1);
    fx.adapter.setLive(O1, { status: 2, tx: { expiresDate: Date.now() - 1000 } });
    await fx.notify("EXPIRED", O1);
    await fx.claim(fx.memberA.id, O2);
    await fx.notify("EXPIRED", O1);
    expect(ent()).toMatchObject({ status: "active", storeRefHash: fx.db.hashPurchaseToken(O2) });
    expect(await digital()).toBe(true);
  });

  it("tenant isolation: a notification changes only the purchase owner's entitlement", async () => {
    await fx.claim(fx.memberA.id, O1);
    await fx.claim(fx.memberB.id, O2);
    const bBefore = ent(fx.memberB.id);
    fx.adapter.setLive(O1, { status: 2, tx: { expiresDate: Date.now() - 1000 } });
    await fx.notify("EXPIRED", O1);
    expect(ent(fx.memberA.id)?.status).toBe("expired");
    expect(ent(fx.memberB.id)).toEqual(bBefore);
  });
});

describe("reconciliation: a lost notification must not leave access running past the paid expiry", () => {
  it("re-checks a purchase whose paid period has passed and ends access", async () => {
    await fx.claim(fx.memberA.id, O1, { tx: { expiresDate: Date.now() + DAY } });
    fx.adapter.setLive(O1, { status: 2 });
    const { reconcileAppStorePurchases } = await import("@/lib/iap/apple-service");
    const summary = await reconcileAppStorePurchases({ nowMs: Date.now() + 2 * DAY });
    expect(summary).toMatchObject({ considered: 1, processed: 1, failed: 0 });
    expect(ent()?.status).toBe("expired");
    expect(eventTypes()).toContain("reconciliation_run");
  });

  it("leaves fresh purchases alone, skips when unconfigured, and stops early on rejected credentials", async () => {
    await fx.claim(fx.memberA.id, O1);
    await fx.claim(fx.memberB.id, O2);
    const { reconcileAppStorePurchases, APP_STORE_RECONCILE_STALE_AFTER_MS } = await import("@/lib/iap/apple-service");
    expect((await reconcileAppStorePurchases()).considered).toBe(0);

    const later = Date.now() + APP_STORE_RECONCILE_STALE_AFTER_MS + 1000;
    fx.adapter.failFetch("unauthorized", 10);
    expect(await reconcileAppStorePurchases({ nowMs: later })).toMatchObject({ considered: 2, processed: 0, failed: 1 });

    fx.adapter.configured = false;
    expect(await reconcileAppStorePurchases({ nowMs: later })).toMatchObject({ skipped: "not_configured" });
  });

  it("never revisits a revoked or expired purchase", async () => {
    await fx.claim(fx.memberA.id, O1, { tx: { transactionId: "tx-r1" } });
    await fx.notify("REVOKE", O1, { tx: { transactionId: "tx-r1", revocationDate: Date.now() } });
    expect(purchase()?.status).toBe("revoked");
    const { reconcileAppStorePurchases } = await import("@/lib/iap/apple-service");
    const calls = fx.adapter.fetchCalls.length;
    await reconcileAppStorePurchases({ nowMs: Date.now() + 90 * DAY });
    expect(fx.adapter.fetchCalls.length).toBe(calls);
  });

  it("the job is registered and runs cleanly with nothing to do", async () => {
    const { ALL_JOBS } = await import("@/lib/jobs/registry");
    const job = ALL_JOBS.find((j) => j.name === "reconcile-app-store-purchases");
    expect(job).toBeDefined();
    await expect(job!.run()).resolves.toMatch(/\d+ of 0|Skipped/);
  });
});

describe("the kill switch gates new purchases, never lifecycle", () => {
  it("is OFF by default: claim and context answer 503 iap_disabled and contact Apple not at all", async () => {
    fx.cleanup();
    fx = await createAppStoreFixture({ enabled: false });
    const res = await fx.verify(fx.memberA.id, { signedTransaction: fx.signedTransaction(fx.memberA.id, O1) });
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("iap_disabled");
    expect(fx.adapter.fetchCalls).toEqual([]);
    expect(eventTypes()).toEqual(["claim_rejected_disabled"]);
  });

  it.each([
    ["enabled alone", { APP_STORE_IAP_ENABLED: "true", APP_STORE_IAP_ENVIRONMENT: undefined }],
    ["environment alone", { APP_STORE_IAP_ENABLED: undefined, APP_STORE_IAP_ENVIRONMENT: "staging" }],
    ["a truthy-looking value that is not exactly true", { APP_STORE_IAP_ENABLED: "1", APP_STORE_IAP_ENVIRONMENT: "staging" }],
    ["an unknown environment label", { APP_STORE_IAP_ENABLED: "true", APP_STORE_IAP_ENVIRONMENT: "prod" }],
  ])("stays off with %s", async (_label, env) => {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const { isAppStoreIapEnabled } = await import("@/lib/iap/apple-config");
    expect(isAppStoreIapEnabled()).toBe(false);
  });

  it("does NOT stop lifecycle processing: an expiry still withdraws access with the switch off", async () => {
    await fx.claim(fx.memberA.id, O1);
    delete process.env.APP_STORE_IAP_ENABLED;
    fx.adapter.setLive(O1, { status: 2, tx: { expiresDate: Date.now() - 1000 } });
    expect((await fx.notify("EXPIRED", O1)).status).toBe(200);
    expect(await digital()).toBe(false);
  });

  it("is independent of the Google Play switch", async () => {
    process.env.GOOGLE_PLAY_IAP_ENABLED = "false";
    expect((await fx.claim(fx.memberA.id, O1)).status).toBe(200);
  });
});

describe("account deletion and the audit trail", () => {
  it("hard deletion is refused while a paid subscription is running, and allowed (anonymising the purchase) once it has ended", async () => {
    await fx.claim(fx.memberA.id, O1);
    expect(() => fx.db.deleteUserAndOwnedRecords(fx.memberA.id)).toThrow();

    fx.adapter.setLive(O1, { status: 2, tx: { expiresDate: Date.now() - 1000 } });
    await fx.notify("EXPIRED", O1);
    fx.db.deleteUserAndOwnedRecords(fx.memberA.id);
    expect(purchase()?.userId).toMatch(/^deleted:/);
    expect(fx.db.findDigitalEntitlementsByUserId(fx.memberA.id)).toEqual([]);
  });

  it("a late notification for a deleted account's subscription creates no entitlement", async () => {
    await fx.claim(fx.memberA.id, O1);
    fx.adapter.setLive(O1, { status: 2, tx: { expiresDate: Date.now() - 1000 } });
    await fx.notify("EXPIRED", O1);
    fx.db.deleteUserAndOwnedRecords(fx.memberA.id);
    fx.adapter.setLive(O1, { status: 1, tx: { expiresDate: Date.now() + 30 * DAY } });
    await fx.notify("DID_RENEW", O1);
    expect(fx.db.findAllDigitalEntitlements()).toEqual([]);
  });

  it("the audit log never contains a raw transaction id, an account token or a provider message", async () => {
    await fx.claim(fx.memberA.id, O1);
    await fx.verify(fx.memberB.id, { signedTransaction: fx.signedTransaction(fx.memberA.id, O1) });
    fx.adapter.failFetch("server_error");
    await fx.notify("DID_RENEW", O1);
    const log = JSON.stringify(fx.db.findIapEvents());
    expect(log).not.toContain(O1);
    expect(log).not.toContain(fx.tokenFor(fx.memberA.id));
    expect(log).toContain(fx.db.hashPurchaseToken(O1));
  });

  it("records every transition in order for one subscription", async () => {
    await fx.claim(fx.memberA.id, O1);
    fx.adapter.setLive(O1, { status: 2, tx: { expiresDate: Date.now() - 1000 } });
    await fx.notify("EXPIRED", O1);
    const types = fx.db.findIapEvents({ purchaseTokenHash: fx.db.hashPurchaseToken(O1) }).map((e) => e.type);
    expect(types).toEqual(["purchase_claimed", "entitlement_granted", "entitlement_expired"]);
    expect(fx.db.findIapEvents().every((e) => e.provider === "app_store")).toBe(true);
  });
});

void BUNDLE_ID;
