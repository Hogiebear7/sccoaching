// Route-level cross-gym denial tests for the 8 app/api/staff/members/* routes
// that already call sameGym()/sameGymAsStaff() (lib/gym-scope.ts). These
// prove each route actually WIRES the check correctly — the existing
// __tests__/lib/gym-scope.test.ts only proves sameGym() itself is correct in
// isolation, never that a real request gets denied. See
// docs/tenant-boundary-audit-2026-09.md §11 for why this slice exists.
//
// Auth uses the real signed-session mechanism (signSession + a session
// cookie) rather than mocking verifyRequestSession/authorizeStaffRequest —
// lib/gym-scope.ts's sameGym()/sameGymAsStaff() and lib/permissions.ts's
// can() are deliberately NOT mocked either, since exercising the real
// authorization logic is the entire point of this file.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findProfileByUserId: vi.fn(),
  saveProfile: vi.fn(),
  updateUserEmail: vi.fn(),
  findSubscriptionByUserId: vi.fn(),
  saveSubscription: vi.fn(),
  findMembershipPackageById: vi.fn(),
  deleteUserAndOwnedRecords: vi.fn(),
  setUserArchived: vi.fn(),
  findAiUsageLogsByUserId: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

// staffCanViewMemberData and grantMemberTier are mocked directly rather than
// satisfied through @/lib/db fixtures (subscription + package + tier
// resolution) — those helpers' own correctness is unrelated to gym-scope,
// and mocking them directly keeps each route's fixture minimal. Same for
// resolveSubscriptionEntitlement/remainingSessions (extra-sessions route).
const { mockStaffCanViewMemberData } = vi.hoisted(() => ({ mockStaffCanViewMemberData: vi.fn() }));
vi.mock("@/lib/member-tier-wall", () => ({ staffCanViewMemberData: mockStaffCanViewMemberData }));

const { mockGrantMemberTier } = vi.hoisted(() => ({ mockGrantMemberTier: vi.fn() }));
vi.mock("@/lib/tier-grant", () => ({ grantMemberTier: mockGrantMemberTier }));

const { mockResolveSubscriptionEntitlement } = vi.hoisted(() => ({ mockResolveSubscriptionEntitlement: vi.fn() }));
vi.mock("@/lib/membership-entitlement", () => ({ resolveSubscriptionEntitlement: mockResolveSubscriptionEntitlement }));

const { mockRemainingSessions } = vi.hoisted(() => ({ mockRemainingSessions: vi.fn() }));
vi.mock("@/lib/scheduling-status", () => ({ remainingSessions: mockRemainingSessions }));

// gymId: null is the established primary-gym convention (lib/gym-scope.ts,
// lib/profile-schema.ts) — every account created before multi-gym existed
// reads as null, and null-vs-null still compares equal. GYM_A represents
// "the primary gym" via that convention rather than a literal id, matching
// how every existing sameGym-gated route in production actually behaves.
const GYM_A_STAFF = { id: "staff-a", email: "staffa@x.test", role: "admin_manager" as const, gymId: null, archivedAt: null };
const GYM_A_MEMBER = { id: "member-a", email: "membera@x.test", role: "member" as const, gymId: null, archivedAt: null };
const GYM_A_MEMBER_ARCHIVED = { ...GYM_A_MEMBER, id: "member-a-archived", archivedAt: "2026-01-01T00:00:00.000Z" };
const GYM_B_MEMBER = { id: "member-b", email: "memberb@x.test", role: "member" as const, gymId: "gym-b", archivedAt: null };

const auth = signSession({ userId: GYM_A_STAFF.id }, MEMBER_SESSION_LIFETIME_MS);

function usersById(...users: { id: string }[]) {
  const map = new Map(users.map((u) => [u.id, u]));
  return (id: string) => map.get(id);
}

async function call(
  method: "POST" | "GET",
  path: string,
  { body, params, query }: { body?: unknown; params?: Record<string, string>; query?: string } = {}
) {
  const mod = await import(`@/app/api/staff/members${path}/route`);
  const url = `http://localhost/api/staff/members${path}${query ? `?${query}` : ""}`;
  const req = new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json", Cookie: `session=${auth}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const handler = mod[method];
  return params ? handler(req, { params: Promise.resolve(params) }) : handler(req);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation(usersById(GYM_A_STAFF, GYM_A_MEMBER, GYM_A_MEMBER_ARCHIVED, GYM_B_MEMBER));
  mockStaffCanViewMemberData.mockReturnValue(true);
});

describe("POST /api/staff/members/update", () => {
  const body = { userId: "", email: "a@x.test", fullName: "A", phone: "1", gender: "male", primaryGoal: "general_health" };

  it("denies a cross-gym member id", async () => {
    h.findProfileByUserId.mockReturnValue({ email: GYM_B_MEMBER.email });
    const res = await call("POST", "/update", { body: { ...body, userId: GYM_B_MEMBER.id } });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ success: false, message: "Member not found." });
    expect(h.saveProfile).not.toHaveBeenCalled();
  });

  it("passes gym-scope for a same-gym member id (control)", async () => {
    // This control verifies that the request passes gym-scope authorization;
    // full business validation is intentionally outside this test's scope.
    h.findProfileByUserId.mockReturnValue({ email: GYM_A_MEMBER.email });
    const res = await call("POST", "/update", { body: { ...body, userId: GYM_A_MEMBER.id, email: GYM_A_MEMBER.email } });
    const data = await res.json();
    expect(data.message).not.toBe("Member not found.");
    expect(res.status).not.toBe(404);
  });
});

describe("POST /api/staff/members/[userId]/tier", () => {
  it("denies a cross-gym member id", async () => {
    const res = await call("POST", "/[userId]/tier", { params: { userId: GYM_B_MEMBER.id }, body: { tier: "membership" } });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ success: false, message: "Member not found." });
    expect(mockGrantMemberTier).not.toHaveBeenCalled();
  });

  it("reaches grantMemberTier for a same-gym member id (control)", async () => {
    mockGrantMemberTier.mockResolvedValue({ ok: true, message: "Tier updated.", tier: "membership" });
    const res = await call("POST", "/[userId]/tier", { params: { userId: GYM_A_MEMBER.id }, body: { tier: "membership" } });
    expect(res.status).not.toBe(404);
    expect(mockGrantMemberTier).toHaveBeenCalledWith(GYM_A_MEMBER.id, "membership", expect.anything());
  });
});

describe("POST /api/staff/members/[userId]/subscription", () => {
  const body = { status: "active", packageId: "pkg-1" };

  it("denies a cross-gym member id", async () => {
    const res = await call("POST", "/[userId]/subscription", { params: { userId: GYM_B_MEMBER.id }, body });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ success: false, message: "Member not found." });
    expect(h.saveSubscription).not.toHaveBeenCalled();
  });

  it("reaches saveSubscription for a same-gym member id (control)", async () => {
    // This control verifies that the request passes gym-scope authorization;
    // full business validation is intentionally outside this test's scope.
    h.findMembershipPackageById.mockReturnValue({ id: "pkg-1" });
    h.findSubscriptionByUserId.mockReturnValue(undefined);
    const res = await call("POST", "/[userId]/subscription", { params: { userId: GYM_A_MEMBER.id }, body });
    expect(res.status).not.toBe(404);
    expect(h.saveSubscription).toHaveBeenCalled();
  });
});

describe("POST /api/staff/members/[userId]/pause", () => {
  it("denies a cross-gym member id", async () => {
    const res = await call("POST", "/[userId]/pause", { params: { userId: GYM_B_MEMBER.id }, body: { action: "pause", duration: "1m" } });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ success: false, message: "Member not found." });
    expect(h.saveSubscription).not.toHaveBeenCalled();
  });

  it("reaches saveSubscription for a same-gym member id (control)", async () => {
    // This control verifies that the request passes gym-scope authorization;
    // full business validation is intentionally outside this test's scope.
    h.findSubscriptionByUserId.mockReturnValue({ userId: GYM_A_MEMBER.id, status: "active", provider: "none" });
    const res = await call("POST", "/[userId]/pause", { params: { userId: GYM_A_MEMBER.id }, body: { action: "pause", duration: "1m" } });
    expect(res.status).not.toBe(404);
    expect(h.saveSubscription).toHaveBeenCalled();
  });
});

describe("POST /api/staff/members/[userId]/extra-sessions", () => {
  it("denies a cross-gym member id", async () => {
    const res = await call("POST", "/[userId]/extra-sessions", { params: { userId: GYM_B_MEMBER.id }, body: { amount: 1 } });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ success: false, message: "Member not found." });
    expect(h.saveSubscription).not.toHaveBeenCalled();
  });

  it("reaches saveSubscription for a same-gym member id (control)", async () => {
    // This control verifies that the request passes gym-scope authorization;
    // full business validation is intentionally outside this test's scope.
    h.findSubscriptionByUserId.mockReturnValue({ userId: GYM_A_MEMBER.id, extraSessionGrants: [] });
    mockResolveSubscriptionEntitlement.mockReturnValue({ monthlySessionAllowance: 10 });
    mockRemainingSessions.mockReturnValue(9);
    const res = await call("POST", "/[userId]/extra-sessions", { params: { userId: GYM_A_MEMBER.id }, body: { amount: 1 } });
    expect(res.status).not.toBe(404);
    expect(h.saveSubscription).toHaveBeenCalled();
  });
});

describe("POST /api/staff/members/[userId]/delete", () => {
  it("denies a cross-gym member id", async () => {
    const res = await call("POST", "/[userId]/delete", { params: { userId: GYM_B_MEMBER.id } });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ success: false, message: "Member not found." });
    expect(h.deleteUserAndOwnedRecords).not.toHaveBeenCalled();
  });

  it("deletes a same-gym archived member id (control)", async () => {
    h.deleteUserAndOwnedRecords.mockReturnValue({});
    const res = await call("POST", "/[userId]/delete", { params: { userId: GYM_A_MEMBER_ARCHIVED.id } });
    expect(res.status).toBe(200);
    expect(h.deleteUserAndOwnedRecords).toHaveBeenCalledWith(GYM_A_MEMBER_ARCHIVED.id);
  });
});

describe("POST /api/staff/members/[userId]/archive", () => {
  it("denies a cross-gym member id", async () => {
    const res = await call("POST", "/[userId]/archive", { params: { userId: GYM_B_MEMBER.id }, body: { archived: true } });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ success: false, message: "Member not found." });
    expect(h.setUserArchived).not.toHaveBeenCalled();
  });

  it("archives a same-gym member id (control)", async () => {
    const res = await call("POST", "/[userId]/archive", { params: { userId: GYM_A_MEMBER.id }, body: { archived: true } });
    expect(res.status).toBe(200);
    expect(h.setUserArchived).toHaveBeenCalledWith(GYM_A_MEMBER.id, true);
  });
});

describe("GET /api/staff/members/[userId]/ai-usage", () => {
  it("denies a cross-gym member id", async () => {
    const res = await call("GET", "/[userId]/ai-usage", { params: { userId: GYM_B_MEMBER.id } });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ success: false, message: "Member not found." });
    expect(h.findAiUsageLogsByUserId).not.toHaveBeenCalled();
  });

  it("returns usage for a same-gym member id (control)", async () => {
    h.findAiUsageLogsByUserId.mockReturnValue([]);
    const res = await call("GET", "/[userId]/ai-usage", { params: { userId: GYM_A_MEMBER.id } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.totalCalls).toBe(0);
  });
});
