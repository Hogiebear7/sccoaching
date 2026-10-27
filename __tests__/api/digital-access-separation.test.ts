// Owner decision D1 (2026-10-15): the App-only digital plan is a SEPARATE subscription from a gym Membership. This file drives
// the REAL route handlers against a REAL datastore file (helpers/iap-fixture.ts) and proves, at every entry point:
//
//   - a gym Membership grants none of the digital features, and digital access grants no gym Membership;
//   - staff can grant and withdraw only a COMPLIMENTARY digital entitlement, never create, change or end a paid store one;
//   - nothing can write the app-only package into a Membership row (staff activation, staff override, web checkout);
//   - the access answer follows paid-through time, grace, hold, revocation and an optional grant end date.
//
// Only the outbound billing provider is mocked (web checkout would otherwise call Stripe). Fake ids and fake tokens only.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixture, type IapFixture } from "../helpers/iap-fixture";

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
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

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

const sub = (userId = fx.memberA.id) => fx.db.findSubscriptionByUserId(userId);
const grant = (userId = fx.memberA.id) => fx.db.findDigitalEntitlement(userId, "staff_grant");
const access = async (userId = fx.memberA.id) => (await import("@/lib/membership-entitlement")).resolveMemberAccessForUser(userId);

/** A paid store entitlement row, as the verified claim path would have left it. */
function paidRow(source: "google_play" | "app_store", over: Partial<import("@/lib/db").DigitalEntitlementRecord> = {}, userId = fx.memberA.id) {
  const now = new Date().toISOString();
  fx.db.saveDigitalEntitlement({
    id: `${source}:${userId}`,
    userId,
    source,
    status: "active",
    productId: "p",
    billingOptionId: fx.ids.appOption,
    storeRefHash: "h".repeat(64),
    environment: source === "app_store" ? "production" : null,
    currentPeriodEnd: iso(Date.now() + 20 * DAY),
    autoRenewing: true,
    grantedByUserId: null,
    note: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  billing.createCatalogCheckout.mockResolvedValue({ sessionId: "cs_fake", checkoutUrl: "https://checkout.example.test/fake", error: null });
  billing.cancelProviderSubscription.mockResolvedValue({ ok: true });
  fx = await createFixture();
});
afterEach(() => fx.cleanup());

describe("the two access flags are independent", () => {
  it("a gym Membership alone: gym yes, digital NO", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "active" });
    expect(await access()).toEqual({ digital: false, gymMembership: true });
  });

  it("a paid store plan alone: digital yes, gym NO", async () => {
    paidRow("app_store");
    expect(await access()).toEqual({ digital: true, gymMembership: false });
  });

  it("neither: both no", async () => {
    expect(await access()).toEqual({ digital: false, gymMembership: false });
  });

  it("both can be held at once, and ending one leaves the other", async () => {
    paidRow("google_play");
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "active" });
    expect(await access()).toEqual({ digital: true, gymMembership: true });
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "canceled" });
    expect(await access()).toEqual({ digital: true, gymMembership: false });
  });
});

describe("digital access follows the paid period, not just the stored status", () => {
  it.each([
    ["active inside the period", { status: "active" as const, currentPeriodEnd: iso(Date.now() + DAY) }, true],
    ["active a few minutes past the end (event-ordering tolerance)", { status: "active" as const, currentPeriodEnd: iso(Date.now() - 60_000) }, true],
    ["active well past the end (a lost notification must not extend access)", { status: "active" as const, currentPeriodEnd: iso(Date.now() - 3_600_000) }, false],
    ["canceled but still inside the paid period", { status: "canceled" as const, autoRenewing: false, currentPeriodEnd: iso(Date.now() + 5 * DAY) }, true],
    ["canceled and past the end", { status: "canceled" as const, autoRenewing: false, currentPeriodEnd: iso(Date.now() - DAY) }, false],
    ["in a store grace period", { status: "in_grace_period" as const, currentPeriodEnd: iso(Date.now() - 2 * DAY) }, true],
    ["in a grace period that has run past the safety cap", { status: "in_grace_period" as const, currentPeriodEnd: iso(Date.now() - 40 * DAY) }, false],
    ["on hold (payment failed, no grace)", { status: "on_hold" as const, currentPeriodEnd: iso(Date.now() + DAY) }, false],
    ["paused", { status: "paused" as const, currentPeriodEnd: iso(Date.now() + DAY) }, false],
    ["expired", { status: "expired" as const, currentPeriodEnd: iso(Date.now() - DAY) }, false],
    ["revoked (refund) even inside the paid period", { status: "revoked" as const, revokedAt: iso(Date.now()), currentPeriodEnd: iso(Date.now() + 20 * DAY) }, false],
    ["no paid-through time recorded", { status: "active" as const, currentPeriodEnd: null }, false],
  ])("%s", async (_label, over, expected) => {
    paidRow("app_store", over);
    expect((await access()).digital).toBe(expected);
  });

  it("a staff grant runs until withdrawn, or until its end date", async () => {
    const { grantStaffDigitalEntitlement } = await import("@/lib/digital-entitlement");
    grantStaffDigitalEntitlement({ userId: fx.memberA.id, grantedByUserId: fx.adminA.id });
    expect((await access()).digital).toBe(true);
    grantStaffDigitalEntitlement({ userId: fx.memberA.id, grantedByUserId: fx.adminA.id, endsAt: iso(Date.now() - DAY) });
    expect((await access()).digital).toBe(false);
  });
});

describe("staff tier route: complimentary digital access and gym Membership are separate actions", () => {
  it("granting complimentary digital access leaves a live Membership row exactly as it is", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "active" });
    const before = sub();
    const res = await tierRoute(fx.memberA.id, fx.adminA.id, "app_subscription");
    expect(res.status).toBe(200);
    expect(sub()).toEqual(before);
    expect(grant()).toMatchObject({ source: "staff_grant", status: "active", grantedByUserId: fx.adminA.id, storeRefHash: null });
    expect(await access()).toEqual({ digital: true, gymMembership: true });
  });

  it("granting a gym Membership grants NO digital access", async () => {
    const res = await tierRoute(fx.memberA.id, fx.adminA.id, "membership");
    expect(res.status).toBe(200);
    expect(await access()).toEqual({ digital: false, gymMembership: true });
    expect(fx.db.findDigitalEntitlementsByUserId(fx.memberA.id)).toEqual([]);
  });

  it("ending the gym Membership (free) leaves a complimentary grant", async () => {
    await tierRoute(fx.memberA.id, fx.adminA.id, "membership");
    await tierRoute(fx.memberA.id, fx.adminA.id, "app_subscription");
    expect((await tierRoute(fx.memberA.id, fx.adminA.id, "free")).status).toBe(200);
    expect(await access()).toEqual({ digital: true, gymMembership: false });
  });

  it("withdrawing the complimentary grant leaves the Membership", async () => {
    await tierRoute(fx.memberA.id, fx.adminA.id, "membership");
    await tierRoute(fx.memberA.id, fx.adminA.id, "app_subscription");
    expect((await tierRoute(fx.memberA.id, fx.adminA.id, "digital_revoke")).status).toBe(200);
    expect(grant()?.status).toBe("revoked");
    expect(await access()).toEqual({ digital: false, gymMembership: true });
  });

  it("withdrawing a grant NEVER ends a paid store subscription: only the store can", async () => {
    paidRow("google_play");
    const before = fx.db.findDigitalEntitlement(fx.memberA.id, "google_play");
    const res = await tierRoute(fx.memberA.id, fx.adminA.id, "digital_revoke");
    expect(res.status).toBe(200);
    expect(fx.db.findDigitalEntitlement(fx.memberA.id, "google_play")).toEqual(before);
    expect((await access()).digital).toBe(true);
  });

  it("a complimentary grant is a separate row: it does not replace or hide a paid one", async () => {
    paidRow("app_store");
    await tierRoute(fx.memberA.id, fx.adminA.id, "app_subscription");
    expect(fx.db.findDigitalEntitlementsByUserId(fx.memberA.id).map((e) => e.source).sort()).toEqual(["app_store", "staff_grant"]);
  });

  it("rejects an unknown action, and the cross-gym denial is the ordinary 404", async () => {
    expect((await tierRoute(fx.memberA.id, fx.adminA.id, "platinum")).status).toBe(400);
    const res = await tierRoute(fx.memberA.id, fx.adminB.id, "app_subscription");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, message: "Member not found." });
    expect(grant()).toBeUndefined();
  });

  it("records the grant and the withdrawal in the audit log without any personal data", async () => {
    await tierRoute(fx.memberA.id, fx.adminA.id, "app_subscription");
    await tierRoute(fx.memberA.id, fx.adminA.id, "digital_revoke");
    const events = fx.db.findIapEvents({ type: "staff_grant_changed" });
    expect(events.map((e) => e.detail)).toEqual([{ action: "grant" }, { action: "revoke" }]);
    expect(JSON.stringify(events)).not.toContain("member-a@example.test");
  });
});

describe("legacy complimentary App Subscription rows (before the digital entitlement store existed)", () => {
  it("still grant digital access, and are not read as a gym Membership", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.appPackage, status: "active", provider: "none" });
    expect(await access()).toEqual({ digital: true, gymMembership: false });
  });

  it("a lapsed legacy row grants nothing", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.appPackage, status: "active", provider: "none", currentPeriodEnd: iso(Date.now() - DAY) });
    expect((await access()).digital).toBe(false);
  });

  it("a legacy row billed through Google Play is NOT honoured: in-app purchases were never live, so it cannot be a real paid plan", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.appPackage, status: "active", provider: "google_play", providerSubscriptionId: "fake" });
    expect((await access()).digital).toBe(false);
  });

  it("granting a gym Membership carries the legacy comp into a staff grant first, so digital access is not silently lost", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.appPackage, status: "active", provider: "none" });
    expect((await tierRoute(fx.memberA.id, fx.adminA.id, "membership")).status).toBe(200);
    expect(sub()?.packageId).toBe(fx.ids.membershipPackage);
    expect(grant()).toMatchObject({ status: "active", note: expect.stringMatching(/legacy/i) });
    expect(await access()).toEqual({ digital: true, gymMembership: true });
  });

  it("withdrawing complimentary access ends a legacy row too", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.appPackage, status: "active", provider: "none" });
    expect((await tierRoute(fx.memberA.id, fx.adminA.id, "digital_revoke")).status).toBe(200);
    expect((await access()).digital).toBe(false);
  });

  it("the lapsed-membership job never treats a legacy digital row as a gym Membership", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.appPackage, status: "active", provider: "none", currentPeriodEnd: iso(Date.now() - 10 * DAY) });
    const before = sub();
    const { dropLapsedManualMembershipsJob } = await import("@/lib/jobs/drop-lapsed-manual-memberships");
    await dropLapsedManualMembershipsJob.run();
    expect(sub()).toEqual(before);
  });
});

describe("bulk tier route", () => {
  it("applies each member independently and reports a result per member", async () => {
    const extra = fx.db.createUserWithRole("member-c@example.test", "x", "member", null);
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "active" });
    const { POST } = await import("@/app/api/staff/members/bulk-tier/route");
    const res = await POST(post("/api/staff/members/bulk-tier", fx.adminA.id, { userIds: [fx.memberA.id, extra.id, fx.memberB.id], tier: "app_subscription" }));
    const { data } = await res.json();
    const byId = Object.fromEntries((data.results as { userId: string; ok: boolean; message: string }[]).map((r) => [r.userId, r]));
    expect(byId[fx.memberA.id]).toMatchObject({ ok: true });
    expect(byId[extra.id]).toMatchObject({ ok: true });
    expect(byId[fx.memberB.id]).toMatchObject({ ok: false, message: "Member not found." });
    expect(sub()?.packageId).toBe(fx.ids.membershipPackage);
    expect(grant()?.status).toBe("active");
    expect(grant(extra.id)?.status).toBe("active");
    expect(grant(fx.memberB.id)).toBeUndefined();
  });

  it("can withdraw a batch of complimentary grants", async () => {
    await tierRoute(fx.memberA.id, fx.adminA.id, "app_subscription");
    const { POST } = await import("@/app/api/staff/members/bulk-tier/route");
    const res = await POST(post("/api/staff/members/bulk-tier", fx.adminA.id, { userIds: [fx.memberA.id], tier: "digital_revoke" }));
    expect(res.status).toBe(200);
    expect(grant()?.status).toBe("revoked");
  });
});

describe("the app-only package can never be written into a gym Membership row", () => {
  it("admin activation refuses it with a stable code and changes nothing", async () => {
    // The real package is hidden (a 404 already); a visible copy lets the rule itself be exercised.
    fx.db.saveMembershipPackage({ ...fx.db.findMembershipPackageById(fx.ids.appPackage)!, id: "pkg-app-visible", slug: "pkg-app-visible", visible: true });
    const { POST } = await import("@/app/api/admin/membership/activate/route");
    const before = sub();
    const res = await POST(post("/api/admin/membership/activate", fx.adminA.id, { userId: fx.memberA.id, packageId: "pkg-app-visible" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "app_plan_not_assignable" });
    expect(sub()).toEqual(before);
  });

  it("admin activation of a real gym Membership is unaffected by a live digital plan", async () => {
    paidRow("app_store");
    const { POST } = await import("@/app/api/admin/membership/activate/route");
    expect((await POST(post("/api/admin/membership/activate", fx.adminA.id, { userId: fx.memberA.id, packageId: fx.ids.membershipPackage }))).status).toBe(200);
    expect(await access()).toEqual({ digital: true, gymMembership: true });
  });

  it("the staff subscription override refuses the app-only package", async () => {
    const { POST } = await import("@/app/api/staff/members/[userId]/subscription/route");
    const res = await POST(post(`/api/staff/members/${fx.memberA.id}/subscription`, fx.adminA.id, { status: "active", packageId: fx.ids.appPackage }), { params: Promise.resolve({ userId: fx.memberA.id }) });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "app_plan_not_assignable" });
    expect(sub()).toBeUndefined();
  });

  it("web checkout refuses the app-only option even if it were visible, with no pending row and no provider checkout", async () => {
    fx.db.saveMembershipPackage({ ...fx.db.findMembershipPackageById(fx.ids.appPackage)!, visible: true });
    fx.db.saveMembershipBillingOption({ ...fx.db.findMembershipBillingOptionById(fx.ids.appOption)!, visible: true });
    const { POST } = await import("@/app/api/membership/checkout/route");
    const res = await POST(post("/api/membership/checkout", fx.memberA.id, { billingOptionId: fx.ids.appOption }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, code: "app_plan_not_assignable" });
    expect(body.message).toMatch(/Google Play or App Store/);
    expect(sub()).toBeUndefined();
    expect(billing.createCatalogCheckout).not.toHaveBeenCalled();
  });

  it("web checkout for a gym Membership proceeds normally, including over a live digital plan", async () => {
    paidRow("google_play");
    const { POST } = await import("@/app/api/membership/checkout/route");
    expect((await POST(post("/api/membership/checkout", fx.memberA.id, { billingOptionId: fx.ids.membershipOption }))).status).toBe(200);
    expect(billing.createCatalogCheckout).toHaveBeenCalledTimes(1);
  });
});

describe("invite redemption", () => {
  it("an app_subscription invite grants complimentary digital access and nothing else", async () => {
    const { token } = fx.db.createInvite({ email: "member-a@example.test", tier: "app_subscription", invitedByStaffId: fx.adminA.id });
    const { redeemInviteForUser } = await import("@/lib/invites");
    const result = await redeemInviteForUser(token, { id: fx.memberA.id, email: "member-a@example.test" });
    expect(result.ok).toBe(true);
    expect(await access()).toEqual({ digital: true, gymMembership: false });
    expect(sub()).toBeUndefined();
  });

  it("a membership invite grants the gym Membership and NO digital access", async () => {
    const { token } = fx.db.createInvite({ email: "member-a@example.test", tier: "membership", invitedByStaffId: fx.adminA.id });
    const { redeemInviteForUser } = await import("@/lib/invites");
    expect((await redeemInviteForUser(token, { id: fx.memberA.id, email: "member-a@example.test" })).ok).toBe(true);
    expect(await access()).toEqual({ digital: false, gymMembership: true });
  });
});

describe("account data", () => {
  it("hard-deleting an account removes its entitlement rows but keeps the purchase records anonymised", async () => {
    paidRow("app_store");
    fx.db.claimAppStorePurchase(
      {
        originalTransactionId: "otx-1",
        latestTransactionId: "tx-1",
        productId: "p",
        environment: "production",
        appAccountToken: null,
        status: "expired",
        autoRenewing: false,
        purchaseDateMillis: 1,
        expiresDateMillis: 2,
      },
      fx.memberA.id
    );
    fx.db.saveDigitalEntitlement({ ...fx.db.findDigitalEntitlement(fx.memberA.id, "app_store")!, status: "expired", currentPeriodEnd: iso(Date.now() - DAY) });
    const summary = fx.db.deleteUserAndOwnedRecords(fx.memberA.id);
    expect(summary).toMatchObject({ appStorePurchasesAnonymised: 1, digitalEntitlements: 1 });
    expect(fx.db.findAppStorePurchaseByOriginalTransactionId("otx-1")?.userId).toMatch(/^deleted:/);
    expect(fx.db.findDigitalEntitlementsByUserId(fx.memberA.id)).toEqual([]);
  });

  it("is refused while a paid App Store subscription is still running", async () => {
    fx.db.claimAppStorePurchase(
      {
        originalTransactionId: "otx-2",
        latestTransactionId: "tx-2",
        productId: "p",
        environment: "production",
        appAccountToken: null,
        status: "active",
        autoRenewing: true,
        purchaseDateMillis: 1,
        expiresDateMillis: Date.now() + DAY,
      },
      fx.memberA.id
    );
    expect(() => fx.db.deleteUserAndOwnedRecords(fx.memberA.id)).toThrow();
  });
});
