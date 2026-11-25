// The rest of the tenant lockout system, against the real routes and the isolated datastore: the operator's list and billing route (payment link and Stripe customer),
// S&C's own Stripe webhook that marks a tenant paid, what the app's session check reports, and that a locked gym is sent no push or routine email.
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixture, GYM_B, type IapFixture } from "../helpers/iap-fixture";

const T = "2026-01-01T00:00:00.000Z";
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const SECRET = "whsec_tenant_test_secret";
let fx: IapFixture;
let operatorId: string;

function gymB(over: Record<string, unknown> = {}) {
  fx.db.createGym({
    id: GYM_B, slug: "gym-b", name: "Gym B", tagline: null, description: null, ownerUserId: fx.adminB.id, contactEmail: "b@example.test", contactPhone: null,
    addressLine: "", latitude: null, longitude: null, status: "active", createdAt: T, updatedAt: T, ...over,
  });
}
const locked = (extra: Record<string, unknown> = {}) => ({ platformBilling: { paidThrough: day(-100), graceDays: 5, ...extra } });

async function post(route: string, userId: string, body: unknown, params: Record<string, string> = {}) {
  const mod = (await import(`@/app/api/${route}/route`)) as { POST: (r: NextRequest, c: { params: Promise<Record<string, string>> }) => Promise<Response> };
  return mod.POST(new NextRequest(`http://localhost/api/${route}`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: fx.cookie(userId) }, body: JSON.stringify(body) }), { params: Promise.resolve(params) });
}
async function get(route: string, userId: string) {
  const mod = (await import(`@/app/api/${route}/route`)) as { GET: (r: NextRequest) => Promise<Response> };
  return mod.GET(new NextRequest(`http://localhost/api/${route}`, { headers: { Cookie: fx.cookie(userId) } }));
}
async function webhook(event: unknown, opts: { secret?: string | null; signWith?: string; tamper?: boolean } = {}) {
  const mod = await import("@/app/api/webhooks/tenant-billing/route");
  const raw = JSON.stringify(event);
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", opts.signWith ?? SECRET).update(`${ts}.${raw}`).digest("hex");
  return mod.POST(
    new NextRequest("http://localhost/api/webhooks/tenant-billing", {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": `t=${ts},v1=${sig}` },
      body: opts.tamper ? raw.replace("invoice.paid", "invoice.paiD") : raw,
    })
  );
}
const invoice = (id: string, customer: string, periodEndDay: number, extra: Record<string, unknown> = {}) => ({
  id: `evt_${id}`,
  type: "invoice.paid",
  data: { object: { id: `in_${id}`, customer, lines: { data: [{ period: { start: 1, end: Math.floor((Date.now() + periodEndDay * 86_400_000) / 1000) } }] }, ...extra } },
});

beforeEach(async () => {
  fx = await createFixture();
  operatorId = fx.db.createUserWithRole("operator@example.test", "x", "platform_operator", null).id;
  vi.stubEnv("TENANT_BILLING_WEBHOOK_SECRET", SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fx.cleanup();
});

describe("the operator's list and billing route", () => {
  it("lists every gym with its state, only for a platform operator", async () => {
    gymB(locked({ payUrl: "https://pay.example.test/b" }));
    const res = await get("staff/gyms/billing", operatorId);
    expect(res.status).toBe(200);
    const body = await res.json();
    const b = body.data.find((g: { id: string }) => g.id === GYM_B);
    expect(b).toMatchObject({ billed: true, state: "locked", hasPayUrl: true, hasStripeCustomer: false });
    expect(JSON.stringify(body)).not.toContain("pay.example.test"); // the link itself is never listed
    expect((await get("staff/gyms/billing", fx.adminB.id)).status).toBe(403);
    expect((await get("staff/gyms/billing", fx.adminA.id)).status).toBe(403);
  });

  it("records a payment link and a Stripe customer, validates them, and keeps them when only the date changes", async () => {
    gymB();
    expect((await post("staff/gyms/[gymId]/billing", operatorId, { paidThrough: day(10), payUrl: "https://pay.example.test/b", stripeCustomerId: "cus_ABC123xyz" }, { gymId: GYM_B })).status).toBe(200);
    expect(fx.db.findGymById(GYM_B)?.platformBilling).toEqual({ paidThrough: day(10), payUrl: "https://pay.example.test/b", stripeCustomerId: "cus_ABC123xyz" });
    expect((await post("staff/gyms/[gymId]/billing", operatorId, { paidThrough: day(40) }, { gymId: GYM_B })).status).toBe(200);
    expect(fx.db.findGymById(GYM_B)?.platformBilling).toEqual({ paidThrough: day(40), payUrl: "https://pay.example.test/b", stripeCustomerId: "cus_ABC123xyz" });
    for (const bad of [{ payUrl: "http://insecure.test" }, { payUrl: "javascript:alert(1)" }, { stripeCustomerId: "not-a-customer" }]) {
      expect((await post("staff/gyms/[gymId]/billing", operatorId, { paidThrough: day(40), ...bad }, { gymId: GYM_B })).status).toBe(400);
    }
    expect((await post("staff/gyms/[gymId]/billing", operatorId, { paidThrough: day(40), payUrl: null }, { gymId: GYM_B })).status).toBe(200);
    expect(fx.db.findGymById(GYM_B)?.platformBilling?.payUrl).toBeUndefined();
  });
});

describe("S&C's own Stripe tells us a tenant has paid", () => {
  beforeEach(() => gymB(locked({ stripeCustomerId: "cus_GYMB0001" })));

  it("refuses everything without the secret, or with a wrong or tampered signature", async () => {
    vi.stubEnv("TENANT_BILLING_WEBHOOK_SECRET", "");
    expect((await webhook(invoice("1", "cus_GYMB0001", 30))).status).toBe(401);
    vi.stubEnv("TENANT_BILLING_WEBHOOK_SECRET", SECRET);
    expect((await webhook(invoice("1", "cus_GYMB0001", 30), { signWith: "whsec_wrong" })).status).toBe(401);
    expect((await webhook(invoice("1", "cus_GYMB0001", 30), { tamper: true })).status).toBe(401);
    expect(fx.db.findGymById(GYM_B)?.platformBilling?.paidThrough).toBe(day(-100));
  });

  it("an invoice.paid moves the gym's paid-through date to the end of the paid period and lifts the lockout at once", async () => {
    vi.stubEnv("TENANT_LOCKOUT_ENABLED", "true");
    const { resolveTenantRequest } = await import("@/lib/tenant-request");
    const asMember = () => resolveTenantRequest(new NextRequest("http://localhost/api/x", { headers: { Cookie: fx.cookie(fx.memberB.id) } }));
    expect(asMember().ok).toBe(false);
    const res = await webhook(invoice("2", "cus_GYMB0001", 30));
    expect(res.status).toBe(200);
    expect(fx.db.findGymById(GYM_B)?.platformBilling?.paidThrough).toBe(day(30));
    expect(asMember().ok).toBe(true);
  });

  it("applies each event once, never moves the date backwards, and ignores other events and unknown customers", async () => {
    await webhook(invoice("3", "cus_GYMB0001", 60));
    expect(fx.db.findGymById(GYM_B)?.platformBilling?.paidThrough).toBe(day(60));
    // The same event again, and an older invoice arriving late: nothing changes.
    expect((await webhook(invoice("3", "cus_GYMB0001", 90))).status).toBe(200);
    expect(fx.db.findGymById(GYM_B)?.platformBilling?.paidThrough).toBe(day(60));
    expect((await webhook(invoice("4", "cus_GYMB0001", 5))).status).toBe(200);
    expect(fx.db.findGymById(GYM_B)?.platformBilling?.paidThrough).toBe(day(60));
    // Another event type, an unknown customer, a missing customer.
    expect((await webhook({ id: "evt_5", type: "customer.created", data: { object: { id: "cus_x" } } })).status).toBe(200);
    expect((await webhook(invoice("6", "cus_NOBODY99", 200))).status).toBe(200);
    expect((await webhook({ id: "evt_7", type: "invoice.paid", data: { object: { id: "in_7", lines: { data: [] } } } })).status).toBe(200);
    expect(fx.db.findGymById(GYM_B)?.platformBilling?.paidThrough).toBe(day(60));
  });

  it("a gym cannot be named from inside the event: a customer id in the metadata or a gym id in the body does nothing", async () => {
    fx.db.saveGym({ ...fx.db.findGymById(GYM_B)!, platformBilling: { paidThrough: day(-100), graceDays: 5 } }); // no customer id stored any more
    const res = await webhook(invoice("8", "cus_GYMB0001", 90, { metadata: { gymId: GYM_B, sc_gym_id: GYM_B }, subscription_details: { metadata: { gymId: GYM_B } } }));
    expect(res.status).toBe(200);
    expect(fx.db.findGymById(GYM_B)?.platformBilling?.paidThrough).toBe(day(-100));
  });
});

describe("what the app is told, and what a locked gym is sent", () => {
  it("the session check reports the gym's state: grace for staff with the link, locked for a member without it, active while the lockout is off", async () => {
    gymB({ platformBilling: { paidThrough: day(-3), graceDays: 10, payUrl: "https://pay.example.test/b" } });
    const callMe = async (userId: string) => (await (await get("mobile/auth/me", userId)).json()).tenant;
    expect(await callMe(fx.adminB.id)).toEqual({ state: "active", graceEndsOn: null, graceDaysLeft: null, payUrl: null }); // switch off
    vi.stubEnv("TENANT_LOCKOUT_ENABLED", "true");
    const staff = await callMe(fx.adminB.id);
    expect(staff).toMatchObject({ state: "grace", payUrl: "https://pay.example.test/b" });
    expect(staff.graceDaysLeft).toBeGreaterThan(0);
    expect(await callMe(fx.memberB.id)).toMatchObject({ state: "grace", payUrl: null }); // members never get the gym's pay link
    fx.db.saveGym({ ...fx.db.findGymById(GYM_B)!, platformBilling: { paidThrough: day(-100), graceDays: 5, payUrl: "https://pay.example.test/b" } });
    expect(await callMe(fx.memberB.id)).toMatchObject({ state: "locked", payUrl: null });
    expect(await callMe(fx.adminA.id)).toMatchObject({ state: "active" }); // the primary gym
    expect(await callMe(operatorId)).toMatchObject({ state: "active" });
  });

  it("a locked gym's people are sent no routine email and no push, but account-security email still goes; other gyms are untouched", async () => {
    gymB(locked());
    vi.stubEnv("TENANT_LOCKOUT_ENABLED", "true");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { sendEmail } = await import("@/lib/email");
    const memberB = fx.db.findUserById(fx.memberB.id)!;
    const memberA = fx.db.findUserById(fx.memberA.id)!;
    await sendEmail({ to: memberB.email, subject: "Class reminder", html: "", text: "" });
    await sendEmail({ to: memberB.email, subject: "Reset your password", html: "", text: "", essential: true });
    await sendEmail({ to: memberA.email, subject: "Class reminder", html: "", text: "" });
    const lines = log.mock.calls.map((c) => c.map((x) => String(x)).join(" "));
    expect(lines.some((l) => l.includes("gym is locked") && l.includes("Class reminder") && l.includes(memberB.email))).toBe(true);
    expect(lines.some((l) => l.includes("Reset your password") && l.includes("skipped"))).toBe(false);
    expect(lines.some((l) => l.includes("Class reminder") && l.includes(memberA.email) && l.includes("skipped"))).toBe(false);

    const { sendPush } = await import("@/lib/push");
    await sendPush(fx.memberB.id, { title: "Hello", body: "x", linkHref: "/" });
    expect(log.mock.calls.some((c) => String(c[0]).includes("skipped, the account's gym is locked"))).toBe(true);
  });

  it("nothing is held back while the lockout switch is off", async () => {
    gymB(locked());
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { sendEmail } = await import("@/lib/email");
    await sendEmail({ to: fx.db.findUserById(fx.memberB.id)!.email, subject: "Class reminder", html: "", text: "" });
    expect(log.mock.calls.some((c) => String(c[0]).includes("gym is locked"))).toBe(false);
  });
});
