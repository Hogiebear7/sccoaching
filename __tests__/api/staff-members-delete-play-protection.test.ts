// Hard deletion must never orphan a paid Google Play subscription. REAL delete route, REAL service and jobs, REAL temporary
// datastore, fake Google adapter. Fake tokens only. No network.
//
// Policy under test (docs/member-deletion-protection-2026-10.md): refuse while a protected Play entitlement exists (active,
// past_due, paused, cancelled-but-paid-through), with the stable code active_subscription; nothing is cancelled or refunded; the
// purchase record, token ownership and audit history are untouched. Once the entitlement has ended, deletion proceeds and the
// purchase records are ANONYMISED, not deleted.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPlayFixture, type PlayFixture } from "../helpers/iap-play-fixture";

let fx: PlayFixture;
const TOKEN = "fake-play-token-del-1";
const DAY = 86_400_000;

const deleteMember = async (memberId: string, actor = fx.adminA.id) => {
  const { POST } = await import("@/app/api/staff/members/[userId]/delete/route");
  return POST(new NextRequest(`http://localhost/api/staff/members/${memberId}/delete`, { method: "POST", headers: { Cookie: fx.cookie(actor) } }), {
    params: Promise.resolve({ userId: memberId }),
  });
};

const archive = (id: string) => fx.db.setUserArchived(id, true);
const snapshot = () => ({
  user: fx.db.findUserById(fx.memberA.id),
  purchases: fx.db.findAllGooglePlayPurchases(),
  sub: fx.db.findSubscriptionByUserId(fx.memberA.id),
});

/** An archived member with a Play purchase in the given provider state. */
async function memberWithPlay(state: Parameters<typeof fx.adapter.setSnapshot>[1]) {
  await fx.claim(fx.memberA.id, TOKEN, { expiryTimeMillis: Date.now() + 30 * DAY });
  fx.adapter.setSnapshot(TOKEN, state);
  await fx.rtdn(fx.subscriptionEvent(TOKEN, 2));
  archive(fx.memberA.id);
}

beforeEach(async () => {
  fx = await createPlayFixture();
});
afterEach(() => fx.cleanup());

describe("a protected Google Play entitlement refuses hard deletion", () => {
  it.each([
    ["active", { state: "SUBSCRIPTION_STATE_ACTIVE" }, "active"],
    ["past_due (grace period)", { state: "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" }, "in_grace_period"],
    ["paused", { state: "SUBSCRIPTION_STATE_PAUSED" }, "paused"],
    ["cancelled but still inside the paid period", { state: "SUBSCRIPTION_STATE_CANCELED", autoRenewing: false, expiryTimeMillis: Date.now() + 10 * DAY }, "canceled_until_expiry"],
  ] as const)("%s: refused with active_subscription, and nothing changes", async (_label, providerState, expectedState) => {
    await memberWithPlay(providerState);
    const before = snapshot();
    const eventsBefore = fx.db.findIapEvents().length;

    const res = await deleteMember(fx.memberA.id);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({ success: false, code: "active_subscription", message: expect.stringMatching(/active Google Play subscription/) });
    // Sanitized: no token, no order id, no hash, no member id, no provider text.
    expect(JSON.stringify(body)).not.toMatch(new RegExp(`${TOKEN}|GPA\\.|${fx.memberA.id}`));
    // Nothing changed: the account, the purchase record (token binding), the subscription row.
    expect(snapshot()).toEqual(before);
    expect(fx.db.findGooglePlayPurchaseByToken(TOKEN)).toMatchObject({ userId: fx.memberA.id, purchaseToken: TOKEN });
    // Audit: one new event, with the stable code and the protected state, never the token.
    const events = fx.db.findIapEvents();
    expect(events).toHaveLength(eventsBefore + 1);
    expect(events.at(-1)).toMatchObject({ type: "staff_write_rejected", userId: fx.memberA.id, actor: "staff", detail: { code: "active_subscription", source: "member_hard_delete", state: expectedState } });
    expect(JSON.stringify(events)).not.toContain(TOKEN);
  });

  it("repeated attempts are refused identically, change nothing, and each leaves one audit event", async () => {
    await memberWithPlay({ state: "SUBSCRIPTION_STATE_ACTIVE" });
    const before = snapshot();
    const eventsBefore = fx.db.findIapEvents().length;
    for (let i = 0; i < 3; i++) expect((await deleteMember(fx.memberA.id)).status).toBe(409);
    expect(snapshot()).toEqual(before);
    expect(fx.db.findIapEvents().filter((e) => e.type === "staff_write_rejected")).toHaveLength(3);
    expect(fx.db.findIapEvents()).toHaveLength(eventsBefore + 3);
  });

  it("refuses even when only the subscription row shows a running Play entitlement (purchase record missing)", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.appPackage, status: "active", provider: "google_play", providerSubscriptionId: "orphan-ref", currentPeriodEnd: new Date(Date.now() + 5 * DAY).toISOString() });
    archive(fx.memberA.id);
    expect((await deleteMember(fx.memberA.id)).status).toBe(409);
    expect(fx.db.findUserById(fx.memberA.id)).toBeDefined();
  });

  it("does not automatically cancel, refund or contact the provider", async () => {
    await memberWithPlay({ state: "SUBSCRIPTION_STATE_ACTIVE" });
    const fetches = fx.adapter.fetchCalls.length;
    const acks = fx.adapter.ackCalls.length;
    await deleteMember(fx.memberA.id);
    expect(fx.adapter.fetchCalls.length).toBe(fetches);
    expect(fx.adapter.ackCalls.length).toBe(acks);
  });

  it("keeps the existing preconditions ahead of it: an active (unarchived) member is still refused first, and a cross-gym target is still a 404", async () => {
    await fx.claim(fx.memberA.id, TOKEN);
    const notArchived = await deleteMember(fx.memberA.id);
    expect(notArchived.status).toBe(409);
    expect((await notArchived.json()).message).toMatch(/Archive this member first/);
    archive(fx.memberA.id);
    expect((await deleteMember(fx.memberA.id, fx.adminB.id)).status).toBe(404);
  });
});

describe("an ended or absent entitlement allows deletion, and purchase history is kept", () => {
  it("absent: a member who never bought deletes as before", async () => {
    archive(fx.memberA.id);
    const res = await deleteMember(fx.memberA.id);
    expect(res.status).toBe(200);
    expect(fx.db.findUserById(fx.memberA.id)).toBeUndefined();
    expect(fx.db.findAllGooglePlayPurchases()).toEqual([]);
  });

  it.each([
    ["expired", { state: "SUBSCRIPTION_STATE_EXPIRED", expiryTimeMillis: Date.now() - DAY }],
    ["on hold (access already removed)", { state: "SUBSCRIPTION_STATE_ON_HOLD" }],
    ["cancelled and the paid period has passed", { state: "SUBSCRIPTION_STATE_CANCELED", autoRenewing: false, expiryTimeMillis: Date.now() - DAY }],
  ] as const)("%s: deletion proceeds and the purchase record is anonymised, not deleted", async (_label, providerState) => {
    await memberWithPlay(providerState);
    const eventsBefore = fx.db.findIapEvents();

    const res = await deleteMember(fx.memberA.id);

    expect(res.status).toBe(200);
    expect((await res.json()).removed).toMatchObject({ googlePlayPurchasesAnonymised: 1 });
    expect(fx.db.findUserById(fx.memberA.id)).toBeUndefined();
    expect(fx.db.findSubscriptionByUserId(fx.memberA.id)).toBeUndefined();

    const kept = fx.db.findGooglePlayPurchaseByToken(TOKEN)!;
    expect(kept).toBeDefined();
    expect(kept.userId).toMatch(/^deleted:[0-9a-f]{16}$/);
    expect(kept.userId).not.toContain(fx.memberA.id);
    expect(kept).toMatchObject({ purchaseToken: TOKEN, anonymizedAt: expect.any(String), productId: "app_subscription" });
    // Audit history is untouched.
    expect(fx.db.findIapEvents().slice(0, eventsBefore.length)).toEqual(eventsBefore);
  });

  it("a revoked (refunded) purchase does not block deletion", async () => {
    await fx.claim(fx.memberA.id, TOKEN, { orderId: "GPA.void-del" });
    await fx.rtdn(fx.voidedEvent(TOKEN, "GPA.void-del"));
    archive(fx.memberA.id);
    expect((await deleteMember(fx.memberA.id)).status).toBe(200);
  });

  it("deleted -> the token stays owned: nobody else can claim it, even with a valid binding of their own", async () => {
    await memberWithPlay({ state: "SUBSCRIPTION_STATE_EXPIRED", expiryTimeMillis: Date.now() - DAY });
    await deleteMember(fx.memberA.id);
    fx.adapter.setSnapshot(TOKEN, { state: "SUBSCRIPTION_STATE_ACTIVE", accountBinding: fx.bindingFor(fx.memberB.id), expiryTimeMillis: Date.now() + 30 * DAY });
    const res = await fx.verify(fx.memberB.id, { purchaseToken: TOKEN });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("owned_by_other");
    expect(fx.db.findSubscriptionByUserId(fx.memberB.id)).toBeUndefined();
  });

  it("a late notification for an anonymised purchase is recorded but never creates a subscription for a deleted account", async () => {
    await memberWithPlay({ state: "SUBSCRIPTION_STATE_EXPIRED", expiryTimeMillis: Date.now() - DAY });
    await deleteMember(fx.memberA.id);
    const subsBefore = JSON.stringify(fx.db.findAllSubscriptions());

    fx.adapter.setSnapshot(TOKEN, { state: "SUBSCRIPTION_STATE_ACTIVE", expiryTimeMillis: Date.now() + 30 * DAY });
    const res = await fx.rtdn(fx.subscriptionEvent(TOKEN, 2));

    expect(res.status).toBe(200);
    expect(JSON.stringify(fx.db.findAllSubscriptions())).toBe(subsBefore);
    expect(fx.db.findIapEvents().some((e) => e.type === "notification_stale" && e.detail.reason === "owner_deleted")).toBe(true);
  });

  it("reconciliation and acknowledgement retry skip anonymised purchases", async () => {
    await memberWithPlay({ state: "SUBSCRIPTION_STATE_EXPIRED", expiryTimeMillis: Date.now() - DAY });
    await deleteMember(fx.memberA.id);
    const { reconcileGooglePlayPurchases, retryGooglePlayAcknowledgements, RECONCILE_STALE_AFTER_MS } = await import("@/lib/iap/service");
    const calls = fx.adapter.fetchCalls.length;
    expect((await reconcileGooglePlayPurchases({ nowMs: Date.now() + 2 * RECONCILE_STALE_AFTER_MS })).considered).toBe(0);
    expect((await retryGooglePlayAcknowledgements({ nowMs: Date.now() + 1000 })).considered).toBe(0);
    expect(fx.adapter.fetchCalls.length).toBe(calls);
  });

  it("an entitlement that ends, then a deletion attempt: refused while live, allowed once it has ended", async () => {
    await memberWithPlay({ state: "SUBSCRIPTION_STATE_ACTIVE" });
    expect((await deleteMember(fx.memberA.id)).status).toBe(409);
    fx.adapter.setSnapshot(TOKEN, { state: "SUBSCRIPTION_STATE_EXPIRED", expiryTimeMillis: Date.now() - 1000 });
    await fx.rtdn(fx.subscriptionEvent(TOKEN, 13));
    expect((await deleteMember(fx.memberA.id)).status).toBe(200);
  });
});
