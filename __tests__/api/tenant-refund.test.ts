// The 14-day money-back. Stripe is replaced by a recorded fake fetch. Proves: platform operator only; only inside 14 days of the first payment; refunds the latest paid
// charge once, cancels the subscription, and ends the gym's access; never for the operator's own gym; a gym with no payment on record is refused.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixture, GYM_B, type IapFixture } from "../helpers/iap-fixture";

const T = "2026-01-01T00:00:00.000Z";
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
let fx: IapFixture;
let operatorId: string;
let calls: { method: string; url: string; body: string }[];

function gymB(firstPaidAgo: number | null) {
  fx.db.createGym({
    id: GYM_B, slug: "gym-b", name: "Gym B", tagline: null, description: null, ownerUserId: fx.adminB.id, contactEmail: "b@example.test", contactPhone: null,
    addressLine: "", latitude: null, longitude: null, status: "active", createdAt: T, updatedAt: T,
    ...(firstPaidAgo === null ? {} : { platformBilling: { paidThrough: "2099-01-01", stripeCustomerId: "cus_REFUND01", firstPaidAt: daysAgo(firstPaidAgo) } }),
  });
}

async function refund(userId: string, gymId = GYM_B) {
  const { POST } = await import("@/app/api/staff/gyms/[gymId]/refund/route");
  return POST(new NextRequest(`http://localhost/api/staff/gyms/${gymId}/refund`, { method: "POST", headers: { Cookie: fx.cookie(userId) } }), { params: Promise.resolve({ gymId }) });
}

beforeEach(async () => {
  fx = await createFixture();
  operatorId = fx.db.createUserWithRole("operator@example.test", "x", "platform_operator", null).id;
  calls = [];
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ method: init?.method ?? "GET", url, body: String(init?.body ?? "") });
      if (url.includes("/charges?")) return new Response(JSON.stringify({ data: [{ id: "ch_old", paid: true, refunded: true }, { id: "ch_latest", paid: true, refunded: false, amount_refunded: 0 }] }), { status: 200 });
      if (url.endsWith("/refunds")) return new Response(JSON.stringify({ id: "re_1" }), { status: 200 });
      if (url.includes("/subscriptions?")) return new Response(JSON.stringify({ data: [{ id: "sub_1", status: "active" }, { id: "sub_0", status: "canceled" }] }), { status: 200 });
      if (url.includes("/subscriptions/")) return new Response(JSON.stringify({ id: "sub_1", status: "canceled" }), { status: 200 });
      return new Response("{}", { status: 404 });
    })
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fx.cleanup();
});

describe("the 14-day money-back", () => {
  it("refunds the latest paid charge, cancels the subscription and ends access, inside 14 days", async () => {
    gymB(3);
    const res = await refund(operatorId);
    expect(res.status).toBe(200);
    expect(calls.find((c) => c.url.endsWith("/refunds"))!.body).toContain("charge=ch_latest");
    expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/subscriptions/sub_1"))).toBe(true);
    expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/subscriptions/sub_0"))).toBe(false);
    const billing = fx.db.findGymById(GYM_B)?.platformBilling;
    expect(billing?.paidThrough).toBe(new Date(Date.now() - 86_400_000).toISOString().slice(0, 10));
    expect(billing?.graceDays).toBe(0);
  });

  it("refuses after the 14 days, and calls Stripe not at all", async () => {
    gymB(20);
    const res = await refund(operatorId);
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain("14-day money-back ended");
    expect(calls).toHaveLength(0);
  });

  it("refuses a gym with no first payment on record", async () => {
    gymB(null);
    expect((await refund(operatorId)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("is for the platform operator only, never a gym's own admin or a member", async () => {
    gymB(3);
    expect((await refund(fx.adminB.id)).status).toBeGreaterThanOrEqual(400);
    expect((await refund(fx.memberB.id)).status).toBeGreaterThanOrEqual(400);
    expect(calls).toHaveLength(0);
  });
});
