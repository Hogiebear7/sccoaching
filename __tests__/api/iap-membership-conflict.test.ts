// Membership / App Subscription conflict enforcement at every synchronous entry point, driven
// through the REAL route handlers against a REAL datastore file (see helpers/iap-fixture.ts).
//
// Owner defaults D1 and D2: an active gym Membership cannot be given an App Subscription, nothing
// converts or cancels automatically, no overlap, history and audit preserved. Interpretations I1-I3
// are in docs/iap-multitenant-implementation-plan-2026-10.md.
//
// Only the outbound billing provider is mocked (web checkout would otherwise call Stripe). Fake ids
// and fake tokens only. Nothing here touches a network.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixture, GYM_B, type IapFixture } from "../helpers/iap-fixture";

const billing = vi.hoisted(() => ({
  createCatalogCheckout: vi.fn(),
  cancelProviderSubscription: vi.fn(),
}));
vi.mock("@/lib/billing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing")>();
  return {
    ...actual,
    activeBillingProvider: () => "stripe",
    createCatalogCheckout: billing.createCatalogCheckout,
    cancelProviderSubscription: billing.cancelProviderSubscription,
  };
});

let fx: IapFixture;
const PAST = "2026-01-15T00:00:00.000Z";

const post = (url: string, userId: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: fx.cookie(userId) },
    body: JSON.stringify(body),
  });

const tierRoute = async (memberId: string, actor: string, tier: string) => {
  const { POST } = await import("@/app/api/staff/members/[userId]/tier/route");
  return POST(post(`/api/staff/members/${memberId}/tier`, actor, { tier }), { params: Promise.resolve({ userId: memberId }) });
};

const sub = () => fx.db.findSubscriptionByUserId(fx.memberA.id);
const events = () => fx.db.findIapEvents({ type: "staff_write_rejected" });

beforeEach(async () => {
  vi.clearAllMocks();
  billing.createCatalogCheckout.mockResolvedValue({ sessionId: "cs_fake", checkoutUrl: "https://checkout.example.test/fake", error: null });
  billing.cancelProviderSubscription.mockResolvedValue({ ok: true });
  fx = await createFixture();
});
afterEach(() => fx.cleanup());

describe("staff tier route: POST /api/staff/members/[userId]/tier", () => {
  it.each(["active", "past_due", "paused"] as const)("rejects an App Subscription grant over a %s Membership, with a stable code, changing nothing", async (status) => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status });
    const before = sub();

    const res = await tierRoute(fx.memberA.id, fx.adminA.id, "app_subscription");

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, code: "membership_active" });
    expect(JSON.stringify(body)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(sub()).toEqual(before);
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ userId: fx.memberA.id, actor: "staff", detail: { code: "membership_active", tier: "app_subscription" } });
  });

  it.each([
    ["canceled", { status: "canceled" as const }],
    ["pending", { status: "pending" as const }],
    ["inactive", { status: "inactive" as const }],
    ["lapsed (active, period ended)", { status: "active" as const, currentPeriodEnd: PAST }],
  ])("allows an App Subscription grant once the Membership is %s", async (_label, over) => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, ...over });
    const res = await tierRoute(fx.memberA.id, fx.adminA.id, "app_subscription");
    expect(res.status).toBe(200);
    expect(sub()?.packageId).toBe(fx.ids.appPackage);
    expect(events()).toHaveLength(0);
  });

  it("allows an App Subscription grant when the member has no subscription row at all", async () => {
    expect((await tierRoute(fx.memberA.id, fx.adminA.id, "app_subscription")).status).toBe(200);
    expect(sub()?.packageId).toBe(fx.ids.appPackage);
  });

  it.each(["active", "past_due", "paused"] as const)("rejects a Membership grant over a %s manual App Subscription", async (status) => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.appPackage, status });
    const before = sub();
    const res = await tierRoute(fx.memberA.id, fx.adminA.id, "membership");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "app_subscription_active" });
    expect(sub()).toEqual(before);
  });

  it("lets staff end a manual App Subscription first, then grant the Membership (two explicit steps)", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.appPackage, status: "active" });
    expect((await tierRoute(fx.memberA.id, fx.adminA.id, "membership")).status).toBe(409);
    expect((await tierRoute(fx.memberA.id, fx.adminA.id, "free")).status).toBe(200);
    expect((await tierRoute(fx.memberA.id, fx.adminA.id, "membership")).status).toBe(200);
    expect(sub()?.packageId).toBe(fx.ids.membershipPackage);
  });

  it.each(["free", "membership", "app_subscription"])("rejects a staff %s write over a live Google Play subscription and keeps it intact", async (tier) => {
    fx.setSubscription(fx.memberA.id, {
      packageId: fx.ids.appPackage,
      status: "active",
      provider: "google_play",
      providerSubscriptionId: "fake-play-token-1",
      currentPeriodEnd: "2099-01-01T00:00:00.000Z",
    });
    const before = sub();
    const res = await tierRoute(fx.memberA.id, fx.adminA.id, tier);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "play_billing_active" });
    expect(sub()).toEqual(before);
    expect(billing.cancelProviderSubscription).not.toHaveBeenCalled();
  });

  it("does not leak a conflict across tenants: a gym B admin gets the ordinary 404 for a gym A member", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "active" });
    const before = sub();
    const res = await tierRoute(fx.memberA.id, fx.adminB.id, "app_subscription");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, message: "Member not found." });
    expect(sub()).toEqual(before);
    expect(events()).toHaveLength(0);
  });
});

describe("bulk tier route: POST /api/staff/members/bulk-tier", () => {
  it("skips members that would conflict, reports a code per member, and still applies the rest", async () => {
    const extra = fx.db.createUserWithRole("member-c@example.test", "x", "member", null);
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "active" });
    const { POST } = await import("@/app/api/staff/members/bulk-tier/route");
    const res = await POST(post("/api/staff/members/bulk-tier", fx.adminA.id, { userIds: [fx.memberA.id, extra.id, fx.memberB.id], tier: "app_subscription" }));
    const { data } = await res.json();
    const byId = Object.fromEntries((data.results as { userId: string; ok: boolean; code?: string }[]).map((r) => [r.userId, r]));
    expect(byId[fx.memberA.id]).toMatchObject({ ok: false, code: "membership_active" });
    expect(byId[extra.id]).toMatchObject({ ok: true });
    expect(byId[fx.memberB.id]).toMatchObject({ ok: false, message: "Member not found." });
    expect(byId[fx.memberB.id].code).toBeUndefined();
    expect(sub()?.packageId).toBe(fx.ids.membershipPackage);
    expect(fx.db.findSubscriptionByUserId(extra.id)?.packageId).toBe(fx.ids.appPackage);
  });
});

describe("admin activation: POST /api/admin/membership/activate", () => {
  const activate = async (actor: string, userId: string, packageId: string) => {
    const { POST } = await import("@/app/api/admin/membership/activate/route");
    return POST(post("/api/admin/membership/activate", actor, { userId, packageId }));
  };

  it("rejects activating a Membership over a live App Subscription, and an App Subscription over a live Membership", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.appPackage, status: "active" });
    let before = sub();
    let res = await activate(fx.adminA.id, fx.memberA.id, fx.ids.membershipPackage);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "app_subscription_active" });
    expect(sub()).toEqual(before);

    // The real App Subscription package is hidden, which this route already answers with 404. A
    // visible app-only package is what lets the conflict rule itself be exercised here.
    fx.db.saveMembershipPackage({ ...fx.db.findMembershipPackageById(fx.ids.appPackage)!, id: "pkg-app-visible", slug: "pkg-app-visible", visible: true });
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "past_due" });
    before = sub();
    res = await activate(fx.adminA.id, fx.memberA.id, "pkg-app-visible");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "membership_active" });
    expect(sub()).toEqual(before);
  });

  it("rejects overwriting a live Google Play subscription", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.appPackage, status: "active", provider: "google_play", providerSubscriptionId: "fake-play-token-2" });
    const before = sub();
    const res = await activate(fx.adminA.id, fx.memberA.id, fx.ids.membershipPackage);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "play_billing_active" });
    expect(sub()).toEqual(before);
  });

  it("still activates over a canceled row and over nothing, and refreshes a same-kind Membership", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.appPackage, status: "canceled" });
    expect((await activate(fx.adminA.id, fx.memberA.id, fx.ids.membershipPackage)).status).toBe(200);
    expect((await activate(fx.adminA.id, fx.memberA.id, fx.ids.membershipPackage)).status).toBe(200);
  });

  it("keeps the cross-gym denial ahead of any conflict answer", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "active" });
    const res = await activate(fx.adminB.id, fx.memberA.id, fx.ids.appPackage);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, message: "Member not found." });
  });
});

describe("staff subscription override: POST /api/staff/members/[userId]/subscription", () => {
  const override = async (actor: string, userId: string, body: unknown) => {
    const { POST } = await import("@/app/api/staff/members/[userId]/subscription/route");
    return POST(post(`/api/staff/members/${userId}/subscription`, actor, body), { params: Promise.resolve({ userId }) });
  };

  it("rejects an entitling Membership write over a live App Subscription", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.appPackage, status: "active" });
    const before = sub();
    const res = await override(fx.adminA.id, fx.memberA.id, { status: "active", packageId: fx.ids.membershipPackage });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "app_subscription_active" });
    expect(sub()).toEqual(before);
  });

  it("allows ending a manual App Subscription (a non-entitling status), but never ending a live Play one", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.appPackage, status: "active" });
    expect((await override(fx.adminA.id, fx.memberA.id, { status: "canceled" })).status).toBe(200);

    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.appPackage, status: "active", provider: "google_play", providerSubscriptionId: "fake-play-token-3" });
    const before = sub();
    const res = await override(fx.adminA.id, fx.memberA.id, { status: "canceled" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "play_billing_active" });
    expect(sub()).toEqual(before);
  });
});

describe("web checkout: POST /api/membership/checkout", () => {
  const checkout = async (userId: string, billingOptionId: string) => {
    const { POST } = await import("@/app/api/membership/checkout/route");
    return POST(post("/api/membership/checkout", userId, { billingOptionId }));
  };

  it.each(["past_due", "paused"] as const)("refuses to start a Membership checkout over a %s App Subscription, creating no pending row and no provider checkout", async (status) => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.appPackage, status });
    const before = sub();
    const res = await checkout(fx.memberA.id, fx.ids.membershipOption);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, code: "app_subscription_active" });
    expect(body.message).toMatch(/^You already have/);
    expect(sub()).toEqual(before);
    expect(billing.createCatalogCheckout).not.toHaveBeenCalled();
  });

  it("refuses over a live Google Play subscription in a grace state, with the Play-specific code", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.appPackage, status: "past_due", provider: "google_play", providerSubscriptionId: "fake-play-token-4" });
    const before = sub();
    const res = await checkout(fx.memberA.id, fx.ids.membershipOption);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "play_billing_active" });
    expect(sub()).toEqual(before);
    expect(billing.createCatalogCheckout).not.toHaveBeenCalled();
  });

  it("an ACTIVE App Subscription is still answered by the existing cross-scope guard, unchanged", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.appPackage, status: "active" });
    const res = await checkout(fx.memberA.id, fx.ids.membershipOption);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, message: "This option is not available." });
  });

  it("proceeds normally when the member has nothing live, or only an ended App Subscription", async () => {
    expect((await checkout(fx.memberA.id, fx.ids.membershipOption)).status).toBe(200);
    expect(billing.createCatalogCheckout).toHaveBeenCalledTimes(1);

    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.appPackage, status: "canceled" });
    expect((await checkout(fx.memberA.id, fx.ids.membershipOption)).status).toBe(200);
  });
});

describe("invite redemption (lib/invites.ts)", () => {
  it("leaves the invite pending and answers neutrally when the grant would conflict", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "active" });
    const { invite, token } = fx.db.createInvite({ email: "member-a@example.test", tier: "app_subscription", invitedByStaffId: fx.adminA.id });
    const { redeemInviteForUser } = await import("@/lib/invites");
    const before = sub();

    const result = await redeemInviteForUser(token, { id: fx.memberA.id, email: "member-a@example.test" });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/active subscription/);
    expect(result.message).not.toMatch(/membership_active|This member/);
    expect(fx.db.findInviteByToken(token)?.status).toBe("pending");
    expect(fx.db.findInviteByToken(token)?.id).toBe(invite.id);
    expect(sub()).toEqual(before);
  });
});

describe("history and audit are preserved", () => {
  it("a refused write never touches Google Play purchase history or earlier audit events", async () => {
    fx.db.claimGooglePlayPurchase(
      {
        purchaseToken: "fake-play-token-5",
        productId: "app_subscription",
        basePlanId: "monthly",
        orderId: "GPA.fake",
        linkedPurchaseToken: null,
        status: "canceled",
        acknowledged: true,
        autoRenewing: false,
        startTimeMillis: 1,
        expiryTimeMillis: 2,
        obfuscatedExternalAccountId: "binding",
        acknowledgementState: "acknowledged",
      },
      fx.memberA.id
    );
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "active" });
    const purchasesBefore = fx.db.findGooglePlayPurchasesByUserId(fx.memberA.id);
    const eventsBefore = fx.db.findIapEvents();

    await tierRoute(fx.memberA.id, fx.adminA.id, "app_subscription");

    expect(fx.db.findGooglePlayPurchasesByUserId(fx.memberA.id)).toEqual(purchasesBefore);
    expect(fx.db.findIapEvents().slice(0, eventsBefore.length)).toEqual(eventsBefore);
    expect(fx.db.findIapEvents().length).toBe(eventsBefore.length + 1);
  });
});

describe("tier resolution ends a Google Play row at its paid expiry", () => {
  it("returns Free once an active Play row is past its expiry, and keeps the tier inside the period", async () => {
    const { resolveMemberTier, GOOGLE_PLAY_EXPIRY_TOLERANCE_MS } = await import("@/lib/membership-entitlement");
    const base = { packageId: fx.ids.appPackage, status: "active" as const, provider: "google_play" as const };
    fx.setSubscription(fx.memberA.id, { ...base, currentPeriodEnd: "2099-01-01T00:00:00.000Z" });
    expect(resolveMemberTier(sub())).toBe("app_subscription");

    fx.setSubscription(fx.memberA.id, { ...base, currentPeriodEnd: new Date(Date.now() - 60_000).toISOString() });
    expect(resolveMemberTier(sub())).toBe("app_subscription"); // inside the small ordering tolerance

    fx.setSubscription(fx.memberA.id, { ...base, currentPeriodEnd: new Date(Date.now() - GOOGLE_PLAY_EXPIRY_TOLERANCE_MS - 60_000).toISOString() });
    expect(resolveMemberTier(sub())).toBe("free");
  });

  it("does not change how a manual or past_due row resolves", async () => {
    const { resolveMemberTier } = await import("@/lib/membership-entitlement");
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.appPackage, status: "active", provider: "none", currentPeriodEnd: PAST });
    expect(resolveMemberTier(sub())).toBe("app_subscription");
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.appPackage, status: "past_due", provider: "google_play", currentPeriodEnd: PAST });
    expect(resolveMemberTier(sub())).toBe("app_subscription");
  });
});

describe("tenant isolation of the entitlement data", () => {
  it("gym B's staff cannot read or change a gym A member's subscription through the conflict paths", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "active" });
    const before = sub();
    for (const tier of ["free", "membership", "app_subscription"]) {
      expect((await tierRoute(fx.memberA.id, fx.adminB.id, tier)).status).toBe(404);
    }
    expect(sub()).toEqual(before);
    expect(GYM_B).toBe("gym-b");
  });
});
