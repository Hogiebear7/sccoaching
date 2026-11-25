// A gym paying S&C for the platform. Stripe is replaced by a recorded fake fetch, so nothing real is called. What this proves: nothing happens unless payment is configured;
// only the gym's own admin can start it and the gym comes from the account; the Stripe customer is created once and remembered; a never-billed gym gets today as its
// paid-through date (so walking away from checkout does not stay free for ever) and starting again does not move it; checkout and portal return Stripe's page.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixture, GYM_B, type IapFixture } from "../helpers/iap-fixture";

const T = "2026-01-01T00:00:00.000Z";
let fx: IapFixture;
let calls: { url: string; body: string }[];

function makeGymB() {
  fx.db.createGym({
    id: GYM_B, slug: "gym-b", name: "Gym B", tagline: null, description: null, ownerUserId: fx.adminB.id, contactEmail: "b@example.test", contactPhone: null,
    addressLine: "", latitude: null, longitude: null, status: "active", createdAt: T, updatedAt: T,
  });
}

async function post(userId: string, body: unknown) {
  const { POST } = await import("@/app/api/staff/gym/subscription/route");
  return POST(new NextRequest("http://localhost/api/staff/gym/subscription", { method: "POST", headers: { "Content-Type": "application/json", Cookie: fx.cookie(userId) }, body: JSON.stringify(body) }));
}

beforeEach(async () => {
  fx = await createFixture();
  makeGymB();
  calls = [];
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
  vi.stubEnv("TENANT_PLATFORM_PRICE_ID", "price_platform");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: String(init?.body ?? "") });
      if (url.endsWith("/customers")) return new Response(JSON.stringify({ id: "cus_test123" }), { status: 200 });
      if (url.endsWith("/checkout/sessions")) return new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/pay/test" }), { status: 200 });
      if (url.endsWith("/billing_portal/sessions")) return new Response(JSON.stringify({ url: "https://billing.stripe.com/p/session/test" }), { status: 200 });
      return new Response("{}", { status: 404 });
    })
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fx.cleanup();
});

describe("gym platform subscription", () => {
  it("says so plainly when online payment is not set up, and calls nothing", async () => {
    vi.stubEnv("TENANT_PLATFORM_PRICE_ID", "");
    const res = await post(fx.adminB.id, { action: "checkout" });
    expect(res.status).toBe(503);
    expect(calls).toHaveLength(0);
  });

  it("creates the customer once, remembers it, and returns the Stripe checkout page", async () => {
    const res = await post(fx.adminB.id, { action: "checkout" });
    expect(res.status).toBe(200);
    expect((await res.json()).data.url).toBe("https://checkout.stripe.com/c/pay/test");
    const billing = fx.db.findGymById(GYM_B)?.platformBilling;
    expect(billing?.stripeCustomerId).toBe("cus_test123");
    expect(billing?.paidThrough).toBe(new Date().toISOString().slice(0, 10));
    const checkout = calls.find((c) => c.url.endsWith("/checkout/sessions"))!;
    expect(checkout.body).toContain("customer=cus_test123");
    expect(checkout.body).toContain("price_platform");
    expect(checkout.body).toContain("mode=subscription");

    await post(fx.adminB.id, { action: "checkout" });
    expect(calls.filter((c) => c.url.endsWith("/customers"))).toHaveLength(1);
  });

  it("never moves an existing paid-through date when starting again", async () => {
    fx.db.saveGym({ ...fx.db.findGymById(GYM_B)!, platformBilling: { paidThrough: "2099-01-01" } });
    await post(fx.adminB.id, { action: "checkout" });
    expect(fx.db.findGymById(GYM_B)?.platformBilling?.paidThrough).toBe("2099-01-01");
    expect(fx.db.findGymById(GYM_B)?.platformBilling?.stripeCustomerId).toBe("cus_test123");
  });

  it("opens the billing portal for the gym's customer", async () => {
    await post(fx.adminB.id, { action: "checkout" });
    const res = await post(fx.adminB.id, { action: "portal" });
    expect((await res.json()).data.url).toBe("https://billing.stripe.com/p/session/test");
    expect(calls.find((c) => c.url.endsWith("/billing_portal/sessions"))!.body).toContain("customer=cus_test123");
  });

  it("is not available to a member or to S&C's own gym, and rejects an unknown action", async () => {
    expect((await post(fx.memberB.id, { action: "checkout" })).status).toBeGreaterThanOrEqual(400);
    expect((await post(fx.adminA.id, { action: "checkout" })).status).toBe(403);
    expect((await post(fx.adminB.id, { action: "refund" })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("lets a gym that is already locked still pay to unlock", async () => {
    vi.stubEnv("TENANT_LOCKOUT_ENABLED", "true");
    fx.db.saveGym({ ...fx.db.findGymById(GYM_B)!, platformBilling: { paidThrough: "2020-01-01" } });
    expect((await post(fx.adminB.id, { action: "checkout" })).status).toBe(200);
  });
});
