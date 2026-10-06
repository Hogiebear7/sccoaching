// A client-supplied gym selector (query parameter, header, or body field) must never change which
// tenant a request runs in. The tenant is the authenticated account's gym (lib/tenant-context.ts).
// This drives a real route handler, with the real signed-session mechanism and the real sameGym and
// can; only the datastore and the member-summary loader are mocked.
//
// Also covers the "same user in two tenants" scenario from the plan: it is NOT representable here,
// because a user has exactly one gymId. The test asserts that by checking that the only tenant a
// session can resolve to is the stored account's own gym, whatever else the request claims.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({ findUserById: vi.fn(), getStaffMembersData: vi.fn() }));
vi.mock("@/lib/db", () => ({ findUserById: h.findUserById }));
vi.mock("@/lib/staff-members-data", () => ({ getStaffMembersData: h.getStaffMembersData }));

type U = { id: string; email: string; role: string; gymId: string | null; archivedAt: string | null };
const u = (id: string, role: string, gymId: string | null): U => ({ id, email: `${id}@x.test`, role, gymId, archivedAt: null });

// Gym A is the primary gym (gymId null). Gym B is "gym-b".
const COACH_A = u("coach-a", "coach", null);
const COACH_B = u("coach-b", "coach", "gym-b");
const OPERATOR_A = u("op-a", "platform_operator", null);
const MEMBER_A = u("member-a", "member", null);
const MEMBER_B = u("member-b", "member", "gym-b");
const ALL = [COACH_A, COACH_B, OPERATOR_A, MEMBER_A, MEMBER_B];

const summary = (userId: string) => ({ userId, email: `${userId}@x.test`, fullName: userId, phone: null, joinedAt: "2026-01-01", archivedAt: null, currentPlanName: null, currentStatus: null });

const get = async (user: U | undefined, query = "", headers: Record<string, string> = {}) => {
  const { GET } = await import("@/app/api/mobile/staff/members/route");
  return GET(
    new NextRequest(`http://localhost/api/mobile/staff/members${query}`, {
      headers: { ...(user ? { Authorization: `Bearer ${signSession({ userId: user.id }, MEMBER_SESSION_LIFETIME_MS)}` } : {}), ...headers },
    })
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => ALL.find((x) => x.id === id));
  // A loader that wrongly returned every gym's members: the route's own row-level check must still hold.
  h.getStaffMembersData.mockReturnValue([summary(MEMBER_A.id), summary(MEMBER_B.id)]);
});

describe("GET /api/mobile/staff/members: tenant comes from the account, not the request", () => {
  it.each([
    ["a query gymId naming another gym", "?gymId=gym-b", {}],
    ["a query gym and tenant pair", "?gym=gym-b&tenantId=gym-b&gym_id=gym-b", {}],
    ["x-gym-id and x-tenant-id headers", "", { "x-gym-id": "gym-b", "x-tenant-id": "gym-b" }],
  ] as const)("gym A coach with %s still sees only gym A", async (_label, query, headers) => {
    const res = await get(COACH_A, query, { ...headers });
    expect(res.status).toBe(200);
    expect(((await res.json()).data as { userId: string }[]).map((m) => m.userId)).toEqual(["member-a"]);
    expect(h.getStaffMembersData).toHaveBeenCalledWith(expect.objectContaining({ id: "coach-a", gymId: null }));
  });

  it("gym B coach asking for the primary gym sees only gym B", async () => {
    const res = await get(COACH_B, "?gymId=primary", { "x-gym-id": "primary" });
    expect(((await res.json()).data as { userId: string }[]).map((m) => m.userId)).toEqual(["member-b"]);
    expect(h.getStaffMembersData).toHaveBeenCalledWith(expect.objectContaining({ id: "coach-b", gymId: "gym-b" }));
  });

  it("gives a platform operator no cross-gym reach, even when it names another gym", async () => {
    const res = await get(OPERATOR_A, "?gymId=gym-b", { "x-gym-id": "gym-b" });
    expect(res.status).toBe(200);
    expect(((await res.json()).data as { userId: string }[]).map((m) => m.userId)).toEqual(["member-a"]);
  });

  it("denies a member session and an absent session, regardless of selector", async () => {
    expect((await get(MEMBER_A, "?gymId=gym-b")).status).toBe(403);
    expect((await get(undefined, "?gymId=gym-b")).status).toBe(401);
    expect(h.getStaffMembersData).not.toHaveBeenCalled();
  });

  it("resolves one tenant per account: the same session always maps to the stored gym (no multi-tenant user)", async () => {
    const first = await get(COACH_B, "?gymId=gym-b");
    const second = await get(COACH_B, "?gymId=primary");
    expect(await first.json()).toEqual(await second.json());
  });
});
