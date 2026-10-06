// Request-boundary helpers (lib/tenant-request.ts). Auth uses the real signed-session mechanism;
// only the datastore lookup is mocked.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({ findUserById: vi.fn() }));
vi.mock("@/lib/db", () => ({ findUserById: h.findUserById }));

import { buildTenantContext } from "@/lib/tenant-context";
import { loadTenantUser, resolveStaffTenantRequest, resolveTenantRequest, tenantNotFoundResponse } from "@/lib/tenant-request";

type U = { id: string; email: string; role: string; gymId: string | null; archivedAt?: string };
const u = (id: string, role: string, gymId: string | null, extra: Partial<U> = {}): U => ({ id, email: `${id}@x.test`, role, gymId, ...extra });

const COACH_A = u("coach-a", "coach", null);
const COACH_B = u("coach-b", "coach", "gym-b");
const MEMBER_A = u("member-a", "member", null);
const MEMBER_B = u("member-b", "member", "gym-b");
const ARCHIVED = u("old", "coach", null, { archivedAt: "2026-01-01T00:00:00.000Z" });
const OPERATOR = u("op", "platform_operator", null);
const ALL = [COACH_A, COACH_B, MEMBER_A, MEMBER_B, ARCHIVED, OPERATOR];

const req = (user?: U, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost/api/x?gymId=gym-b", {
    headers: { ...(user ? { Cookie: `session=${signSession({ userId: user.id }, MEMBER_SESSION_LIFETIME_MS)}` } : {}), ...headers },
  });

beforeEach(() => {
  h.findUserById.mockReset();
  h.findUserById.mockImplementation((id: string) => ALL.find((x) => x.id === id));
});

describe("resolveTenantRequest", () => {
  it("builds the context from the account, ignoring any client-supplied gym selector in query or headers", () => {
    const res = resolveTenantRequest(req(COACH_A, { "x-gym-id": "gym-b", "x-tenant-id": "gym-b" }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.ctx.gymId).toBeNull();
      expect(res.ctx.userId).toBe("coach-a");
    }
  });

  it("answers 401 for no session, an archived account, and a deleted account identically", async () => {
    const none = resolveTenantRequest(req());
    const archived = resolveTenantRequest(req(ARCHIVED));
    h.findUserById.mockReturnValue(undefined);
    const deleted = resolveTenantRequest(req(COACH_A));
    for (const r of [none, archived, deleted]) {
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.response.status).toBe(401);
        expect(await r.response.json()).toEqual({ success: false, message: "You must be signed in." });
      }
    }
  });

  it("accepts a Bearer token as the mobile transport and resolves the same tenant", () => {
    const token = signSession({ userId: COACH_B.id }, MEMBER_SESSION_LIFETIME_MS);
    const res = resolveTenantRequest(new NextRequest("http://localhost/api/x", { headers: { Authorization: `Bearer ${token}` } }));
    expect(res.ok && res.ctx.gymId).toBe("gym-b");
  });
});

describe("resolveStaffTenantRequest", () => {
  it("returns a context for staff holding the capability", () => {
    const res = resolveStaffTenantRequest(req(COACH_B), "classes.manage");
    expect(res.ok && res.ctx.gymId).toBe("gym-b");
  });

  it("denies a member and a missing capability with the standard 403, and no session with 401", () => {
    const member = resolveStaffTenantRequest(req(MEMBER_A), "classes.manage");
    const noCap = resolveStaffTenantRequest(req(COACH_A), "catalog.manage");
    const noSession = resolveStaffTenantRequest(req(), "classes.manage");
    expect(!member.ok && member.response.status).toBe(403);
    expect(!noCap.ok && noCap.response.status).toBe(403);
    expect(!noSession.ok && noSession.response.status).toBe(401);
  });

  it("gives an operator no cross-gym reach: the context is still their own gym", () => {
    const res = resolveStaffTenantRequest(req(OPERATOR, { "x-gym-id": "gym-b" }), "classes.manage");
    expect(res.ok && res.ctx.gymId).toBeNull();
    expect(res.ok && res.ctx.isPlatformOperator).toBe(true);
  });
});

describe("loadTenantUser: a missing target and a cross-tenant target are indistinguishable", () => {
  const ctxA = buildTenantContext(COACH_A);

  it("returns same-tenant users", () => {
    expect(loadTenantUser(ctxA, "member-a")).toBe(MEMBER_A);
  });

  it("returns undefined for a guessed id in another tenant, exactly like a missing id", () => {
    expect(loadTenantUser(ctxA, "member-b")).toBeUndefined();
    expect(loadTenantUser(ctxA, "no-such-user")).toBeUndefined();
  });

  it("is symmetric: gym B cannot load a primary-gym user", () => {
    expect(loadTenantUser(buildTenantContext(COACH_B), "member-a")).toBeUndefined();
    expect(loadTenantUser(buildTenantContext(COACH_B), "member-b")).toBe(MEMBER_B);
  });

  it("does not let an operator load another gym's user", () => {
    expect(loadTenantUser(buildTenantContext(OPERATOR), "member-b")).toBeUndefined();
  });

  it.each([undefined, null, "", "   ", 42 as unknown as string])("rejects a malformed id (%j) without a datastore lookup", (id) => {
    h.findUserById.mockClear();
    expect(loadTenantUser(ctxA, id)).toBeUndefined();
    expect(h.findUserById).not.toHaveBeenCalled();
  });

  it("uses one non-disclosing 404 body", async () => {
    const res = tenantNotFoundResponse("Member not found.");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, message: "Member not found." });
  });
});
