// The tenant lockout, end to end against the isolated datastore (helpers/iap-fixture.ts), the real platform-operator route and the real tenant request check.
// What this proves: nothing is locked unless TENANT_LOCKOUT_ENABLED is "true"; the primary gym, platform operators and gyms with no billing are never locked; a
// gym past its grace is refused (a plain message for members, the overdue message for its staff) with a 423 and nothing deleted; its own staff still pass on a route
// that allows it (the pay page); paying again restores everything at once; and only a platform operator, never a gym on itself, can record the date.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixture, GYM_B, type IapFixture } from "../helpers/iap-fixture";

const T = "2026-01-01T00:00:00.000Z";
let fx: IapFixture;
let operatorId: string;

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

function makeGymB(paidThrough?: string, graceDays?: number) {
  fx.db.createGym({
    id: GYM_B, slug: "gym-b", name: "Gym B", tagline: null, description: null, ownerUserId: fx.adminB.id, contactEmail: "b@example.test", contactPhone: null,
    addressLine: "", latitude: null, longitude: null, status: "active", createdAt: T, updatedAt: T,
    ...(paidThrough ? { platformBilling: { paidThrough, ...(graceDays !== undefined ? { graceDays } : {}) } } : {}),
  });
}

async function resolve(userId: string, options: { allowWhenLocked?: boolean } = {}) {
  const { resolveTenantRequest } = await import("@/lib/tenant-request");
  return resolveTenantRequest(new NextRequest("http://localhost/api/x", { headers: { Cookie: fx.cookie(userId) } }), options);
}

async function setBilling(actorId: string, gymId: string, body: unknown) {
  const mod = await import("@/app/api/staff/gyms/[gymId]/billing/route");
  return mod.POST(
    new NextRequest(`http://localhost/api/staff/gyms/${gymId}/billing`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: fx.cookie(actorId) }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ gymId }) }
  );
}

beforeEach(async () => {
  fx = await createFixture();
  operatorId = fx.db.createUserWithRole("operator@example.test", "x", "platform_operator", null).id;
});
afterEach(() => {
  vi.unstubAllEnvs();
  fx.cleanup();
});

describe("the tenant lockout", () => {
  it("does nothing unless the switch is on, even for a gym far past its grace", async () => {
    makeGymB(day(-200));
    expect((await resolve(fx.memberB.id)).ok).toBe(true);
    expect((await resolve(fx.adminB.id)).ok).toBe(true);
  });

  describe("with the switch on", () => {
    beforeEach(() => vi.stubEnv("TENANT_LOCKOUT_ENABLED", "true"));

    it("never locks the primary gym, a platform operator, or a gym with no billing", async () => {
      makeGymB(); // no billing
      expect((await resolve(fx.memberA.id)).ok).toBe(true);
      expect((await resolve(fx.adminA.id)).ok).toBe(true);
      expect((await resolve(operatorId)).ok).toBe(true);
      expect((await resolve(fx.memberB.id)).ok).toBe(true);
    });

    it("lets an active gym and a gym still in grace carry on", async () => {
      makeGymB(day(-3)); // 3 days past paid-through, default grace is longer
      expect((await resolve(fx.memberB.id)).ok).toBe(true);
      expect((await resolve(fx.adminB.id)).ok).toBe(true);
    });

    it("refuses a gym past its grace with a 423: a plain message for members, the overdue message for staff", async () => {
      makeGymB(day(-100), 5);
      const member = await resolve(fx.memberB.id);
      expect(member.ok).toBe(false);
      if (member.ok) return;
      expect(member.response.status).toBe(423);
      const mBody = await member.response.json();
      expect(mBody).toMatchObject({ success: false, code: "tenant_locked" });
      expect(mBody.message).toContain("temporarily unavailable");

      const staff = await resolve(fx.adminB.id);
      expect(staff.ok).toBe(false);
      if (staff.ok) return;
      expect(staff.response.status).toBe(423);
      expect((await staff.response.json()).message).toContain("overdue");
    });

    it("lets the locked gym's own staff through a route that allows it (the pay page), never its members", async () => {
      makeGymB(day(-100), 5);
      expect((await resolve(fx.adminB.id, { allowWhenLocked: true })).ok).toBe(true);
      expect((await resolve(fx.memberB.id, { allowWhenLocked: true })).ok).toBe(false);
    });

    it("locking one gym never touches the primary gym, and nothing is deleted", async () => {
      makeGymB(day(-100), 5);
      expect((await resolve(fx.memberA.id)).ok).toBe(true);
      expect(fx.db.findUserById(fx.memberB.id)).toBeTruthy();
      expect(fx.db.findGymById(GYM_B)).toBeTruthy();
    });

    it("paying again restores everything straight away", async () => {
      makeGymB(day(-100), 5);
      expect((await resolve(fx.memberB.id)).ok).toBe(false);
      expect((await setBilling(operatorId, GYM_B, { paidThrough: day(30) })).status).toBe(200);
      expect((await resolve(fx.memberB.id)).ok).toBe(true);
      expect((await resolve(fx.adminB.id)).ok).toBe(true);
    });
  });
});

describe("recording a gym's paid-through date", () => {
  it("a platform operator can, and the answer says where the gym stands", async () => {
    makeGymB();
    const res = await setBilling(operatorId, GYM_B, { paidThrough: day(-100), graceDays: 10 });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ state: "locked", paidThrough: day(-100) });
    expect(fx.db.findGymById(GYM_B)?.platformBilling).toEqual({ paidThrough: day(-100), graceDays: 10 });
  });

  it("keeps the gym's own grace length when only the date changes, and null takes it off billing", async () => {
    makeGymB(day(-100), 10);
    await setBilling(operatorId, GYM_B, { paidThrough: day(20) });
    expect(fx.db.findGymById(GYM_B)?.platformBilling).toEqual({ paidThrough: day(20), graceDays: 10 });
    expect((await setBilling(operatorId, GYM_B, { paidThrough: null })).status).toBe(200);
    expect(fx.db.findGymById(GYM_B)?.platformBilling).toBeUndefined();
  });

  it("refuses everyone who is not a platform operator, including the gym's own admin", async () => {
    makeGymB();
    expect((await setBilling(fx.adminB.id, GYM_B, { paidThrough: day(365) })).status).toBe(403);
    expect((await setBilling(fx.adminA.id, GYM_B, { paidThrough: day(365) })).status).toBe(403);
    expect((await setBilling(fx.memberB.id, GYM_B, { paidThrough: day(365) })).status).toBe(403);
    expect(fx.db.findGymById(GYM_B)?.platformBilling).toBeUndefined();
  });

  it("refuses bad input and an unknown gym", async () => {
    makeGymB();
    expect((await setBilling(operatorId, GYM_B, { paidThrough: "tomorrow" })).status).toBe(400);
    expect((await setBilling(operatorId, GYM_B, { paidThrough: day(5), graceDays: -1 })).status).toBe(400);
    expect((await setBilling(operatorId, GYM_B, { paidThrough: day(5), graceDays: 61 })).status).toBe(400);
    expect((await setBilling(operatorId, GYM_B, {})).status).toBe(400);
    expect((await setBilling(operatorId, "no-such-gym", { paidThrough: day(5) })).status).toBe(404);
  });
});
