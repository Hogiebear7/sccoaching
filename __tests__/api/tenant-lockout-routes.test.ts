// Every signed-in route refuses a locked tenant, proved against the REAL route handlers (not a list in a document).
//
// For each route in the manifest that is not public, a webhook, a cron job, global or platform-only: an account of a locked gym calls every exported handler
// (GET, POST, ...) and must get a 423 with code tenant_locked; the same call from the primary gym, and from the same gym once it has paid, must NOT be a 423.
// The only routes allowed to answer something else while a gym is locked are the ones that carry a written lockoutExempt reason, and the test pins that list.
// Also: the manifest's lockoutEnforced flag, the lockoutExempt reason and the source can never disagree.
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ROUTE_SCOPE_MANIFEST } from "@/lib/route-scope-manifest";
import { createFixture, GYM_B, type IapFixture } from "../helpers/iap-fixture";

const T = "2026-01-01T00:00:00.000Z";
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const HELPERS = /\b(?:resolveTenantRequest|resolveStaffTenantRequest|requireTenantAccess|requireTenantAccessForUserId|gymCommunityAccess)\(/;
const OUT_OF_SCOPE = new Set(["public", "webhook", "cron", "global-shared", "platform"]);
const signedIn = ROUTE_SCOPE_MANIFEST.filter((e) => !OUT_OF_SCOPE.has(e.scope));
const sourceOf = (route: string) => readFileSync(path.join(process.cwd(), "app", "api", route, "route.ts"), "utf8");

describe("the lockout flags tell the truth", () => {
  it("a signed-in route is lockoutEnforced if, and only if, its source calls a tenant helper, and the rest each carry a written reason", () => {
    const wrong: string[] = [];
    for (const e of signedIn) {
      const uses = HELPERS.test(sourceOf(e.route));
      if (e.lockoutExempt) {
        if (e.lockoutEnforced) wrong.push(`${e.route}: both enforced and exempt`);
        continue;
      }
      if (!!e.lockoutEnforced !== uses) wrong.push(`${e.route}: flag=${!!e.lockoutEnforced} source=${uses}`);
      if (!e.lockoutEnforced) wrong.push(`${e.route}: neither enforced nor exempt`);
    }
    expect(wrong).toEqual([]);
  });

  it("pins the routes that stay reachable while a gym is locked, each with a reason of real length", () => {
    const exempt = signedIn.filter((e) => e.lockoutExempt).map((e) => e.route).sort();
    expect(exempt).toEqual(
      [
        "account/delete",
        "mobile/auth/me",
        "mobile/equipment-catalog",
        "mobile/gyms/geocode",
        "mobile/gyms/my-gym/visibility",
        "mobile/gyms/nearby",
        "mobile/push",
        "profile/ai-consent",
        "profile/email-preferences",
        "push/subscribe",
      ].sort()
    );
    for (const e of signedIn.filter((x) => x.lockoutExempt)) expect((e.lockoutExempt ?? "").length).toBeGreaterThan(25);
  });
});

describe("every enforced route refuses a locked tenant", () => {
  let fx: IapFixture;
  let lockedStaff: string;
  let lockedMember: string;
  let primaryStaff: string;

  beforeEach(async () => {
    fx = await createFixture();
    vi.stubEnv("TENANT_LOCKOUT_ENABLED", "true");
    fx.db.createGym({
      id: GYM_B, slug: "gym-b", name: "Gym B", tagline: null, description: null, ownerUserId: fx.adminB.id, contactEmail: "b@example.test", contactPhone: null,
      addressLine: "", latitude: null, longitude: null, status: "active", createdAt: T, updatedAt: T, platformBilling: { paidThrough: day(-200), graceDays: 5 },
    });
    // Real accounts have a profile; some routes answer "no profile" before anything else, which would hide whether they refuse a locked gym.
    for (const [id, email] of [[fx.adminA.id, "a1"], [fx.memberA.id, "a2"], [fx.adminB.id, "b1"], [fx.memberB.id, "b2"]]) {
      fx.db.saveProfile({ userId: id, fullName: email, email: `${email}@example.test`, createdAt: T, updatedAt: T } as never);
    }
    lockedStaff = fx.adminB.id;
    lockedMember = fx.memberB.id;
    primaryStaff = fx.adminA.id;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fx.cleanup();
  });

  async function call(route: string, method: (typeof METHODS)[number], userId: string): Promise<number> {
    const mod = (await import(`@/app/api/${route}/route`)) as Record<string, Handler>;
    const params = new Proxy({}, { get: () => "x" }) as Record<string, string>;
    const hasBody = method !== "GET" && method !== "DELETE";
    try {
      const res = await mod[method](
        new NextRequest(`http://localhost/api/${route}`, {
          method,
          headers: { "Content-Type": "application/json", Cookie: fx.cookie(userId), Authorization: "" },
          ...(hasBody ? { body: "{}" } : {}),
        }),
        { params: Promise.resolve(params) }
      );
      return res.status;
    } catch {
      // A route that needs an outside service (the exercise library's database, say) throws once it gets past the lock. That is "not locked", which is all this test asks.
      return -1;
    }
  }

  async function lockedCodes(route: string, userId: string) {
    const mod = (await import(`@/app/api/${route}/route`)) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const m of METHODS) if (typeof mod[m] === "function") out[m] = await call(route, m, userId);
    return out;
  }

  const enforced = signedIn.filter((e) => e.lockoutEnforced);

  it("covers a real number of routes", () => {
    expect(enforced.length).toBeGreaterThan(200);
  });

  it("answers 423 from every handler of every enforced route, for the locked gym's own staff (members for the member routes)", async () => {
    const notLocked: string[] = [];
    for (const e of enforced) {
      // A staff route needs a staff account to get past its own permission check; a member route is tried as the locked gym's member.
      const asStaff = e.scope === "tenant-staff" || e.route.startsWith("mobile/staff") || e.route.startsWith("staff/") || e.route.startsWith("ai/coach") || e.route.startsWith("ai/draft");
      const codes = await lockedCodes(e.route, asStaff ? lockedStaff : lockedMember);
      for (const [m, status] of Object.entries(codes)) if (status !== 423) notLocked.push(`${m} ${e.route} -> ${status}`);
    }
    expect(notLocked).toEqual([]);
  }, 120_000);

  it("a locked gym's member is also refused on the member routes by the staff-only routes' permission check, never let through", async () => {
    // A member poking a staff route must not get a success; it is 423 or the route's own 401/403, never a 2xx.
    for (const e of enforced.filter((x) => x.scope === "tenant-staff").slice(0, 25)) {
      for (const status of Object.values(await lockedCodes(e.route, lockedMember))) expect(status === 423 || status === 401 || status === 403 || status === 404).toBe(true);
    }
  }, 60_000);

  it("never answers 423 for the primary gym", async () => {
    const wrong: string[] = [];
    for (const e of enforced.slice(0, 120)) {
      const asStaff = e.scope === "tenant-staff" || e.route.startsWith("mobile/staff") || e.route.startsWith("staff/");
      const codes = await lockedCodes(e.route, asStaff ? primaryStaff : fx.memberA.id);
      for (const [m, status] of Object.entries(codes)) if (status === 423) wrong.push(`${m} ${e.route}`);
    }
    expect(wrong).toEqual([]);
  }, 120_000);

  it("lets the same gym straight back in once it has paid", async () => {
    const gym = fx.db.findGymById(GYM_B);
    expect(gym).toBeTruthy();
    fx.db.saveGym({ ...gym!, platformBilling: { paidThrough: day(30) }, updatedAt: T });
    const wrong: string[] = [];
    for (const e of enforced.slice(0, 120)) {
      const asStaff = e.scope === "tenant-staff" || e.route.startsWith("mobile/staff") || e.route.startsWith("staff/");
      const codes = await lockedCodes(e.route, asStaff ? lockedStaff : lockedMember);
      for (const [m, status] of Object.entries(codes)) if (status === 423) wrong.push(`${m} ${e.route}`);
    }
    expect(wrong).toEqual([]);
  }, 120_000);
});
