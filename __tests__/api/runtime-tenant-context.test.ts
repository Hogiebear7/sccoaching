// Runtime proof that production routes derive their tenant through lib/tenant-request.ts, not just that the helper
// exists. The helper is spied on (every call recorded, behaviour unchanged) while the REAL route handlers run against a REAL
// temporary datastore. The tests then assert that the helper WAS CALLED with the authenticated account's tenant, and that
// its answer is ENFORCED: a client-supplied gym selector changes nothing, a cross-tenant target is indistinguishable from a
// missing one, and a platform operator gets no cross-gym reach.
//
// Fake ids, fake tokens, fake provider. No network.
import { readFileSync } from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { ROUTE_SCOPE_MANIFEST } from "@/lib/route-scope-manifest";
import type { TenantContext } from "@/lib/tenant-context";

import { createPlayFixture, type PlayFixture } from "../helpers/iap-play-fixture";

let fx: PlayFixture;
let resolveSpy: MockInstance<(request: NextRequest, options?: { unauthenticatedMessage?: string }) => unknown>;
let loadSpy: MockInstance<(ctx: TenantContext, target: string | null | undefined) => { id: string } | undefined>;

// What the routes asked the helper, read from the spies. The original implementations still ran.
const resolved = () => resolveSpy.mock.calls.map(([req, options]) => ({ url: new URL(req.url).pathname, options }));
const loaded = () =>
  loadSpy.mock.calls.map(([ctx, target], i) => ({ ctxGymId: ctx.gymId, ctxUserId: ctx.userId, target, result: loadSpy.mock.results[i]?.value?.id ?? null }));

const operator = () => fx.db.createUserWithRole("operator@example.test", "x", "platform_operator", null);

const post = (url: string, userId: string | undefined, body: unknown, extraHeaders: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(userId ? { Cookie: fx.cookie(userId) } : {}), ...extraHeaders },
    body: JSON.stringify(body),
  });

// The body always carries a gym selector. It must never matter.
const tierRoute = async (memberId: string, actor: string | undefined, tier: string, headers: Record<string, string> = {}, query = "") => {
  const { POST } = await import("@/app/api/staff/members/[userId]/tier/route");
  return POST(post(`/api/staff/members/${memberId}/tier${query}`, actor, { tier, gymId: "gym-b", tenantId: "gym-b" }, headers), {
    params: Promise.resolve({ userId: memberId }),
  });
};

beforeEach(async () => {
  fx = await createPlayFixture();
  // Install the spies on the module instance the routes will import (the fixture reset the module registry).
  const tr = await import("@/lib/tenant-request");
  resolveSpy = vi.spyOn(tr, "resolveTenantRequest") as typeof resolveSpy;
  loadSpy = vi.spyOn(tr, "loadTenantUser") as typeof loadSpy;
});
afterEach(() => {
  vi.restoreAllMocks();
  fx.cleanup();
});

describe("the helper is actually called by the converted routes", () => {
  it("staff tier route: resolves the tenant from the session, then loads the target through the tenant", async () => {
    const res = await tierRoute(fx.memberA.id, fx.adminA.id, "app_subscription");
    expect(res.status).toBe(200);
    expect(resolved().map((c) => c.url)).toEqual([`/api/staff/members/${fx.memberA.id}/tier`]);
    expect(loaded()).toEqual([{ ctxGymId: null, ctxUserId: fx.adminA.id, target: fx.memberA.id, result: fx.memberA.id }]);
  });

  it("bulk tier route: every target goes through the tenant", async () => {
    const { POST } = await import("@/app/api/staff/members/bulk-tier/route");
    await POST(post("/api/staff/members/bulk-tier", fx.adminA.id, { userIds: [fx.memberA.id, fx.memberB.id], tier: "app_subscription" }));
    expect(resolved()).toHaveLength(1);
    expect(loaded().map((c) => [c.target, c.result])).toEqual([
      [fx.memberA.id, fx.memberA.id],
      [fx.memberB.id, null],
    ]);
  });

  it("subscription override and admin activation load their target through the tenant", async () => {
    const sub = await import("@/app/api/staff/members/[userId]/subscription/route");
    await sub.POST(post(`/api/staff/members/${fx.memberA.id}/subscription`, fx.adminA.id, { status: "inactive", packageId: fx.ids.membershipPackage }), {
      params: Promise.resolve({ userId: fx.memberA.id }),
    });
    const act = await import("@/app/api/admin/membership/activate/route");
    await act.POST(post("/api/admin/membership/activate", fx.adminA.id, { userId: fx.memberA.id, packageId: fx.ids.membershipPackage }));
    expect(resolved().map((c) => c.url)).toEqual([`/api/staff/members/${fx.memberA.id}/subscription`, "/api/admin/membership/activate"]);
    expect(loaded().map((c) => c.target)).toEqual([fx.memberA.id, fx.memberA.id]);
    expect(loaded().every((c) => c.ctxGymId === null && c.ctxUserId === fx.adminA.id)).toBe(true);
  });

  it("web checkout resolves the member's tenant through the helper", async () => {
    const { POST } = await import("@/app/api/membership/checkout/route");
    await POST(post("/api/membership/checkout", fx.memberA.id, { billingOptionId: "nonexistent" }));
    expect(resolved().map((c) => c.url)).toEqual(["/api/membership/checkout"]);
  });

  it("Google Play purchase-context and verify resolve the account through the helper", async () => {
    await fx.context(fx.memberA.id);
    await fx.verify(fx.memberA.id, { purchaseToken: "fake-token-rt-1" });
    expect(resolved().map((c) => c.url)).toEqual(["/api/mobile/billing/google-play/purchase-context", "/api/mobile/billing/google-play/verify"]);
    // The routes keep their own 401 wording, so adopting the helper changed nothing a client sees.
    expect(resolved()[1].options).toEqual({ unauthenticatedMessage: "You must be signed in to verify a purchase." });
  });
});

describe("the helper's answer is enforced", () => {
  it.each([
    ["a query gymId", "?gymId=gym-b", {}],
    ["a body gymId and tenantId (always sent by this test)", "", {}],
    ["x-gym-id and x-tenant-id headers", "", { "x-gym-id": "gym-b", "x-tenant-id": "gym-b" }],
  ] as const)("a client-supplied selector (%s) never changes the tenant", async (_label, query, headers) => {
    const res = await tierRoute(fx.memberB.id, fx.adminA.id, "app_subscription", { ...headers }, query);
    expect(res.status).toBe(404);
    expect(loaded().at(-1)).toMatchObject({ ctxGymId: null, target: fx.memberB.id, result: null });
    expect(fx.db.findSubscriptionByUserId(fx.memberB.id)).toBeUndefined();
  });

  it("a cross-tenant target and a missing target give the identical answer", async () => {
    const cross = await tierRoute(fx.memberB.id, fx.adminA.id, "free");
    const missing = await tierRoute("no-such-member", fx.adminA.id, "free");
    expect(cross.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await cross.json()).toEqual(await missing.json());
  });

  it("symmetric: gym B's admin cannot reach gym A's member, and can reach their own", async () => {
    expect((await tierRoute(fx.memberA.id, fx.adminB.id, "free")).status).toBe(404);
    expect(loaded().at(-1)).toMatchObject({ ctxGymId: "gym-b", result: null });
    expect((await tierRoute(fx.memberB.id, fx.adminB.id, "app_subscription")).status).toBe(200);
  });

  it("a platform operator gets no cross-gym reach through the helper", async () => {
    const op = operator();
    const res = await tierRoute(fx.memberB.id, op.id, "app_subscription", { "x-gym-id": "gym-b" });
    // The operator role may lack members.grantTier here; either way no cross-gym write happened.
    expect([403, 404]).toContain(res.status);
    expect(fx.db.findSubscriptionByUserId(fx.memberB.id)).toBeUndefined();
    if (loaded().length > 0) expect(loaded().at(-1)).toMatchObject({ ctxGymId: null, result: null });
  });

  it("an unauthenticated or archived caller gets the route's own 401 wording and the target is never loaded", async () => {
    const anon = await tierRoute(fx.memberA.id, undefined, "free");
    expect(anon.status).toBe(401);
    expect(await anon.json()).toEqual({ success: false, message: "You must be signed in to manage memberships." });
    expect(loaded()).toEqual([]);

    // An archived account reads exactly like no session: same 401, and the target is still never loaded.
    fx.db.setUserArchived(fx.adminA.id, true);
    const archived = await tierRoute(fx.memberA.id, fx.adminA.id, "free");
    expect(archived.status).toBe(401);
    expect(await archived.json()).toEqual({ success: false, message: "You must be signed in to manage memberships." });
    expect(loaded()).toEqual([]);
  });

  it("the new Play routes answer 401 with their own wording when the session is missing, and never read a client user id", async () => {
    expect((await fx.context(undefined)).status).toBe(401);
    const ver = await fx.verify(undefined, { purchaseToken: "t", userId: fx.memberA.id, gymId: "gym-b" });
    expect(ver.status).toBe(401);
    expect((await ver.json()).message).toBe("You must be signed in to verify a purchase.");
  });
});

describe("the adoption document tells the truth too", () => {
  it("lists every flagged route in its converted table, and no other route", () => {
    const doc = readFileSync(path.join(process.cwd(), "docs", "runtime-tenant-context-adoption-2026-10.md"), "utf8").replace(/\r/g, "");
    const table = /<!-- converted:start -->([\s\S]*?)<!-- converted:end -->/.exec(doc)?.[1] ?? "";
    const listed = [...table.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]).sort();
    const flagged = ROUTE_SCOPE_MANIFEST.filter((e) => e.runtimeTenantContext).map((e) => e.route).sort();
    expect(listed).toEqual(flagged);
    expect(doc).toContain(`Seven routes derive their tenant`);
    expect(flagged).toHaveLength(7);
  });
});

describe("the manifest tells the truth about which routes use the runtime context", () => {
  it("flags exactly the converted routes", () => {
    const flagged = ROUTE_SCOPE_MANIFEST.filter((e) => e.runtimeTenantContext).map((e) => e.route);
    expect(flagged.sort()).toEqual(
      [
        "admin/membership/activate",
        "membership/checkout",
        "mobile/billing/google-play/purchase-context",
        "mobile/billing/google-play/verify",
        "staff/members/[userId]/subscription",
        "staff/members/[userId]/tier",
        "staff/members/bulk-tier",
      ].sort()
    );
  });
});
