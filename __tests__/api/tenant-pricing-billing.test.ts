// Size-based pricing through the real payment webhook, with Stripe faked: the first payment sets the band from the member count; a renewal moves the subscription to the band
// the previous period's HIGHEST count calls for (so trimming members at month end does not lower it); nothing happens unless TENANT_PRICES is set; the daily job records the peak.
import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixture, GYM_B, type IapFixture } from "../helpers/iap-fixture";

const T = "2026-01-01T00:00:00.000Z";
const SECRET = "whsec_test_pricing";
const ids = (p: string) => ({ b50: `${p}50`, b100: `${p}100`, b149: `${p}149`, b150: `${p}150` });
const PRICES = JSON.stringify({ month: ids("price_m"), year: ids("price_y") });
const DAY = 86_400;
let fx: IapFixture;
let calls: { method: string; url: string; body: string }[];

function gymB(billing?: Record<string, unknown>, pending?: string) {
  fx.db.createGym({
    id: GYM_B, slug: "gym-b", name: "Gym B", tagline: null, description: null, ownerUserId: fx.adminB.id, contactEmail: "b@example.test", contactPhone: null,
    addressLine: "", latitude: null, longitude: null, status: "active", createdAt: T, updatedAt: T,
    ...(billing ? { platformBilling: billing } : {}),
    ...(pending ? { pendingStripeCustomerId: pending } : {}),
  });
}

async function paid(id: string, customer: string, periodDays: number) {
  const { POST } = await import("@/app/api/webhooks/tenant-billing/route");
  const now = Math.floor(Date.now() / 1000);
  const raw = JSON.stringify({ id: `evt_${id}`, type: "invoice.paid", data: { object: { id: `in_${id}`, customer, lines: { data: [{ period: { start: now, end: now + periodDays * DAY } }] } } } });
  const sig = createHmac("sha256", SECRET).update(`${now}.${raw}`).digest("hex");
  return POST(new NextRequest("http://localhost/api/webhooks/tenant-billing", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": `t=${now},v1=${sig}` }, body: raw }));
}

beforeEach(async () => {
  fx = await createFixture();
  calls = [];
  vi.stubEnv("TENANT_BILLING_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ method: init?.method ?? "GET", url, body: String(init?.body ?? "") });
      if (url.includes("/subscriptions?")) return new Response(JSON.stringify({ data: [{ id: "sub_1", items: { data: [{ id: "si_1" }] } }] }), { status: 200 });
      if (url.includes("/subscriptions/sub_1")) return new Response(JSON.stringify({ id: "sub_1" }), { status: 200 });
      return new Response("{}", { status: 404 });
    })
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fx.cleanup();
});

describe("size-based pricing", () => {
  it("does nothing about bands unless TENANT_PRICES is set", async () => {
    gymB(undefined, "cus_PRICE0001");
    await paid("1", "cus_PRICE0001", 30);
    expect(fx.db.findGymById(GYM_B)?.platformBilling?.band).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("the first payment sets the band from the member count and starts the period's peak", async () => {
    vi.stubEnv("TENANT_PRICES", PRICES);
    gymB(undefined, "cus_PRICE0001");
    await paid("2", "cus_PRICE0001", 30);
    const billing = fx.db.findGymById(GYM_B)?.platformBilling;
    expect(billing?.band).toBe("b50"); // the fixture gym has one member
    expect(billing?.interval).toBe("month");
    expect(billing?.memberHighWater?.peak).toBe(1);
    expect(calls).toHaveLength(0); // nothing to move on a first payment
  });

  it("a yearly first payment is recorded as yearly", async () => {
    vi.stubEnv("TENANT_PRICES", PRICES);
    gymB(undefined, "cus_PRICE0001");
    await paid("3", "cus_PRICE0001", 365);
    expect(fx.db.findGymById(GYM_B)?.platformBilling?.interval).toBe("year");
  });

  it("a renewal moves the subscription to the band the period's highest count calls for, even though the live count is lower", async () => {
    vi.stubEnv("TENANT_PRICES", PRICES);
    gymB({ paidThrough: "2026-12-01", stripeCustomerId: "cus_PRICE0001", band: "b50", interval: "month", memberHighWater: { peak: 60, since: "2026-11-01" } });
    await paid("4", "cus_PRICE0001", 30);
    const change = calls.find((c) => c.method === "POST" && c.url.includes("/subscriptions/sub_1"))!;
    expect(change.body).toContain("price_m100");
    expect(change.body).toContain("proration_behavior=none");
    const billing = fx.db.findGymById(GYM_B)?.platformBilling;
    expect(billing?.band).toBe("b100");
    expect(billing?.memberHighWater).toEqual({ peak: 1, since: new Date().toISOString().slice(0, 10) }); // a new period starts from the members it has now
  });

  it("a renewal where the whole period stayed small leaves the band alone and makes no Stripe change", async () => {
    vi.stubEnv("TENANT_PRICES", PRICES);
    gymB({ paidThrough: "2026-12-01", stripeCustomerId: "cus_PRICE0001", band: "b50", interval: "month", memberHighWater: { peak: 30, since: "2026-11-01" } });
    await paid("5", "cus_PRICE0001", 30);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect(fx.db.findGymById(GYM_B)?.platformBilling?.band).toBe("b50");
  });

  it("the daily job records the highest count and never lowers it", async () => {
    gymB({ paidThrough: "2099-01-01", stripeCustomerId: "cus_PRICE0001", memberHighWater: { peak: 5, since: "2026-11-01" } });
    const { tenantMemberHighWaterJob } = await import("@/lib/jobs/tenant-member-high-water");
    await tenantMemberHighWaterJob.run();
    expect(fx.db.findGymById(GYM_B)?.platformBilling?.memberHighWater?.peak).toBe(5); // 1 member now, the peak of 5 stays
    fx.db.saveGym({ ...fx.db.findGymById(GYM_B)!, platformBilling: { paidThrough: "2099-01-01", stripeCustomerId: "cus_PRICE0001", memberHighWater: { peak: 0, since: "2026-11-01" } } });
    await tenantMemberHighWaterJob.run();
    expect(fx.db.findGymById(GYM_B)?.platformBilling?.memberHighWater?.peak).toBe(1); // it goes up to today's count
  });
});
