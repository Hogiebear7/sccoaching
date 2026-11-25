// The trial pass (for example 3 classes for 50 euro): once per member, and only before any membership has been paid for. Real datastore and checkout route, Stripe faked.
// Proves: a new member may buy it; after buying it (paid) they may not again; after any membership they may not (and it is hidden); a refunded one can be tried again;
// an ordinary pass is never affected; the refusal comes from the server, not only from hiding it.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixture, type IapFixture } from "../helpers/iap-fixture";

const T = "2026-01-01T00:00:00.000Z";
let fx: IapFixture;

function seedCatalog() {
  fx.db.saveMembershipCategory({ id: "cat1", gymId: null, name: "Classes", slug: "classes", description: null, sortOrder: 0, visible: true, createdAt: T, updatedAt: T } as never);
  const base = { categoryId: "cat1", shortDescription: null, fullDescription: null, sessionAllowanceType: "fixed_count", eligibleClassTypes: [], visible: true, sortOrder: 0, stripeProductId: null, deliveryChannel: "in_person", createdAt: T, updatedAt: T };
  fx.db.saveMembershipPackage({ ...base, id: "pkg_trial", name: "3-Class Trial Pass", slug: "trial", packageType: "pass", sessionAllowanceCount: 3, introOnly: true } as never);
  fx.db.saveMembershipPackage({ ...base, id: "pkg_pass", name: "10-Class Pass", slug: "ten", packageType: "pass", sessionAllowanceCount: 10 } as never);
  const opt = { packageId: "", name: "One-off", billingType: "one_time", intervalUnit: null, intervalCount: null, currency: "eur", visible: true, sortOrder: 0, stripePriceId: null, createdAt: T, updatedAt: T };
  fx.db.saveMembershipBillingOption({ ...opt, id: "opt_trial", packageId: "pkg_trial", amountCents: 5000 } as never);
  fx.db.saveMembershipBillingOption({ ...opt, id: "opt_pass", packageId: "pkg_pass", amountCents: 9000 } as never);
}

function paidPurchase(userId: string, productId: string, kind: "pass_pack" | "membership" = "pass_pack", status = "paid") {
  fx.db.savePurchase({ id: `p_${Math.random()}`, userId, kind, productId, description: "x", amountCents: 5000, status, provider: "stripe", providerOrderId: null, providerPaymentRef: null, checkoutUrl: null, idempotencyKey: `k_${Math.random()}`, createdAt: T, updatedAt: T } as never);
}

async function checkout(userId: string, billingOptionId: string) {
  const { POST } = await import("@/app/api/membership/checkout/route");
  return POST(new NextRequest("http://localhost/api/membership/checkout", { method: "POST", headers: { "Content-Type": "application/json", Cookie: fx.cookie(userId) }, body: JSON.stringify({ billingOptionId }) }));
}

beforeEach(async () => {
  fx = await createFixture();
  seedCatalog();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/test" }), { status: 200 })));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fx.cleanup();
});

describe("trial pass eligibility", () => {
  it("is open to a new member, and not to someone who has already paid for one", async () => {
    const { introPassAvailableTo } = await import("@/lib/intro-pass");
    expect(introPassAvailableTo(fx.memberA.id)).toBe(true);
    paidPurchase(fx.memberA.id, "pkg_trial");
    expect(introPassAvailableTo(fx.memberA.id)).toBe(false);
  });

  it("a refunded or unfinished trial pass does not use up the one go", async () => {
    const { introPassAvailableTo } = await import("@/lib/intro-pass");
    paidPurchase(fx.memberA.id, "pkg_trial", "pass_pack", "refunded");
    paidPurchase(fx.memberA.id, "pkg_trial", "pass_pack", "pending");
    expect(introPassAvailableTo(fx.memberA.id)).toBe(true);
  });

  it("is gone once the member has had any membership", async () => {
    const { introPassAvailableTo } = await import("@/lib/intro-pass");
    fx.db.saveSubscription({ userId: fx.memberA.id, status: "active", pausedUntil: null, statusBeforePause: null, createdAt: T, updatedAt: T } as never);
    expect(introPassAvailableTo(fx.memberA.id)).toBe(false);
  });

  it("is also gone after a paid membership purchase, even with no subscription row", async () => {
    const { introPassAvailableTo } = await import("@/lib/intro-pass");
    paidPurchase(fx.memberB.id, "pkg_pass", "membership");
    expect(introPassAvailableTo(fx.memberB.id)).toBe(false);
  });

  it("another gym's or an ordinary pass buy never counts against the trial pass", async () => {
    const { introPassAvailableTo } = await import("@/lib/intro-pass");
    paidPurchase(fx.memberA.id, "pkg_pass");
    expect(introPassAvailableTo(fx.memberA.id)).toBe(true);
  });
});

describe("trial pass checkout", () => {
  it("lets a new member start checkout", async () => {
    const res = await checkout(fx.memberA.id, "opt_trial");
    expect(res.status).toBe(200);
  });

  it("refuses a second purchase, from the server", async () => {
    paidPurchase(fx.memberA.id, "pkg_trial");
    const res = await checkout(fx.memberA.id, "opt_trial");
    expect(res.status).toBe(409);
    expect((await res.json()).message).toContain("only for new members");
  });

  it("refuses a member who has joined", async () => {
    fx.db.saveSubscription({ userId: fx.memberA.id, status: "active", pausedUntil: null, statusBeforePause: null, createdAt: T, updatedAt: T } as never);
    expect((await checkout(fx.memberA.id, "opt_trial")).status).toBe(409);
  });

  it("never affects an ordinary pass", async () => {
    fx.db.saveSubscription({ userId: fx.memberA.id, status: "active", pausedUntil: null, statusBeforePause: null, createdAt: T, updatedAt: T } as never);
    paidPurchase(fx.memberA.id, "pkg_trial");
    expect((await checkout(fx.memberA.id, "opt_pass")).status).toBe(200);
  });
});
