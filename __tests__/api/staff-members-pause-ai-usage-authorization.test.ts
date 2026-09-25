// Authorization and gym scope for two staff member routes whose existing coverage
// (staff-members-gym-scope.test.ts) is a single cross-gym case and a single
// control from one actor — TESTS ONLY (characterizes existing behaviour; no route
// change):
//   * POST /api/staff/members/[userId]/pause   (members.billing, mutates the subscription)
//   * GET  /api/staff/members/[userId]/ai-usage (members.view, reads AI usage logs)
// For both: the target must be in the acting staff member's gym BEFORE anything
// is read or written; a cross-gym target reads exactly like a missing one; wrong
// role, no session, archived and deleted actors are refused; operators get no
// cross-gym reach.
//
// Real signed sessions; the real can(), sameGym() and verifyRequestSession are NOT
// mocked — only the datastore, the tier wall and the billing provider. All
// fixtures are synthetic. Tenant A = primary gym (gymId: null convention),
// Tenant B / Tenant C = two separate non-primary gyms.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findSubscriptionByUserId: vi.fn(),
  saveSubscription: vi.fn(),
  findAiUsageLogsByUserId: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

const { mockStaffCanViewMemberData } = vi.hoisted(() => ({ mockStaffCanViewMemberData: vi.fn() }));
vi.mock("@/lib/member-tier-wall", () => ({ staffCanViewMemberData: mockStaffCanViewMemberData }));

const billing = vi.hoisted(() => ({ pauseProviderSubscription: vi.fn(), resumeProviderSubscription: vi.fn() }));
vi.mock("@/lib/billing", () => billing);

type U = { id: string; email: string; role: string; gymId: string | null; archivedAt: string | null };
const user = (id: string, role: string, gymId: string | null, archivedAt: string | null = null): U => ({
  id,
  email: `${id}@x.test`,
  role,
  gymId,
  archivedAt,
});

const A_ADMIN = user("admin-a", "admin", null);
const A_COACH = user("coach-a", "coach", null);
const A_MEMBER = user("member-a", "member", null);
const A_MEMBER_PLAIN = user("member-a-plain", "member", null); // a non-staff caller
const B_ADMIN = user("admin-b", "admin", "gym-b");
const B_COACH = user("coach-b", "coach", "gym-b");
const B_MEMBER = user("member-b", "member", "gym-b");
const C_MEMBER = user("member-c", "member", "gym-c");
const OPERATOR = user("operator", "platform_operator", null);
const ARCHIVED_ADMIN = user("admin-archived", "admin", null, "2026-09-01T00:00:00.000Z");

let world: U[];
const cookie = (id: string) => `session=${signSession({ userId: id }, MEMBER_SESSION_LIFETIME_MS)}`;
const headers = (as?: string) => ({ "Content-Type": "application/json", ...(as ? { Cookie: cookie(as) } : {}) });

async function pause(targetId: string, body: unknown, as?: string) {
  const { POST } = await import("@/app/api/staff/members/[userId]/pause/route");
  return POST(
    new NextRequest(`http://localhost/api/staff/members/${targetId}/pause`, { method: "POST", headers: headers(as), body: JSON.stringify(body) }),
    { params: Promise.resolve({ userId: targetId }) }
  );
}
const doPause = (targetId: string, as?: string) => pause(targetId, { action: "pause", duration: "2w" }, as);

async function aiUsage(targetId: string, as?: string) {
  const { GET } = await import("@/app/api/staff/members/[userId]/ai-usage/route");
  return GET(new NextRequest(`http://localhost/api/staff/members/${targetId}/ai-usage`, { method: "GET", headers: headers(as) }), {
    params: Promise.resolve({ userId: targetId }),
  });
}

const activeSubscription = () => ({ userId: A_MEMBER.id, packageId: "pkg", status: "active", provider: "none", providerSubscriptionId: null });

beforeEach(() => {
  vi.clearAllMocks();
  world = [A_ADMIN, A_COACH, A_MEMBER, A_MEMBER_PLAIN, B_ADMIN, B_COACH, B_MEMBER, C_MEMBER, OPERATOR, ARCHIVED_ADMIN];
  h.findUserById.mockImplementation((id: string) => world.find((u) => u.id === id));
  h.findSubscriptionByUserId.mockImplementation(() => activeSubscription());
  h.findAiUsageLogsByUserId.mockReturnValue([]);
  mockStaffCanViewMemberData.mockReturnValue(true);
});

const nothingChanged = () => {
  expect(h.findSubscriptionByUserId).not.toHaveBeenCalled();
  expect(h.saveSubscription).not.toHaveBeenCalled();
  expect(billing.pauseProviderSubscription).not.toHaveBeenCalled();
  expect(billing.resumeProviderSubscription).not.toHaveBeenCalled();
};

describe("POST /members/[userId]/pause — same-gym authorized controls", () => {
  it("pauses a same-gym member's membership", async () => {
    const res = await doPause(A_MEMBER.id, A_ADMIN.id);

    expect(res.status).toBe(200);
    expect(h.saveSubscription).toHaveBeenCalledTimes(1);
    expect(h.saveSubscription).toHaveBeenCalledWith(expect.objectContaining({ status: "paused", statusBeforePause: "active" }));
  });

  it("resumes a paused same-gym membership", async () => {
    h.findSubscriptionByUserId.mockReturnValue({ ...activeSubscription(), status: "paused", statusBeforePause: "active", pausedUntil: "2030-01-01T00:00:00.000Z" });

    const res = await pause(A_MEMBER.id, { action: "resume" }, A_ADMIN.id);

    expect(res.status).toBe(200);
    expect(h.saveSubscription).toHaveBeenCalledWith(expect.objectContaining({ status: "active", pausedUntil: null }));
  });

  it("works inside a second tenant (Tenant B admin, Tenant B member)", async () => {
    h.findSubscriptionByUserId.mockReturnValue({ ...activeSubscription(), userId: B_MEMBER.id });

    const res = await doPause(B_MEMBER.id, B_ADMIN.id);

    expect(res.status).toBe(200);
    expect(h.saveSubscription).toHaveBeenCalledTimes(1);
  });

  it("a platform operator may act within its own gym", async () => {
    expect((await doPause(A_MEMBER.id, OPERATOR.id)).status).toBe(200);
  });
});

describe("POST /members/[userId]/pause — cross-gym targets", () => {
  it.each([
    ["Tenant A admin -> Tenant B member", A_ADMIN.id, B_MEMBER.id],
    ["Tenant B admin -> Tenant A member (reverse direction)", B_ADMIN.id, A_MEMBER.id],
    ["Tenant B admin -> Tenant C member (two non-primary tenants)", B_ADMIN.id, C_MEMBER.id],
    ["platform operator -> Tenant B member (no cross-gym reach)", OPERATOR.id, B_MEMBER.id],
  ])("%s: 404, and the subscription is never read, saved or sent to the provider", async (_label, actor, target) => {
    const res = await doPause(target, actor);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, message: "Member not found." });
    nothingChanged();
  });

  it("a cross-gym target, a missing target and a cross-gym staff account are indistinguishable", async () => {
    const crossGym = await doPause(B_MEMBER.id, A_ADMIN.id);
    const missing = await doPause("no-such-member", A_ADMIN.id);
    const crossGymStaff = await doPause(B_COACH.id, A_ADMIN.id);

    expect(missing.status).toBe(crossGym.status);
    expect(crossGymStaff.status).toBe(crossGym.status);
    const body = await crossGym.json();
    expect(await missing.json()).toEqual(body);
    expect(await crossGymStaff.json()).toEqual(body);
    nothingChanged();
  });

  it("ignores a client-supplied gym or tenant identifier in the body", async () => {
    const res = await pause(B_MEMBER.id, { action: "pause", duration: "2w", gymId: null, tenantId: "gym-b" }, A_ADMIN.id);

    expect(res.status).toBe(404);
    nothingChanged();
  });
});

describe("POST /members/[userId]/pause — wrong role, no session, archived and deleted actors", () => {
  it.each([
    ["a coach (below members.billing)", A_COACH.id],
    ["a plain member", A_MEMBER_PLAIN.id],
  ])("%s -> 403 before any target is looked at", async (_label, actor) => {
    const res = await doPause(A_MEMBER.id, actor);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, message: "Only staff can manage memberships." });
    nothingChanged();
  });

  it("an unauthorized cross-gym request is 403, not 404 (capability is checked first)", async () => {
    expect((await doPause(B_MEMBER.id, A_COACH.id)).status).toBe(403);
    nothingChanged();
  });

  it("no session -> 401", async () => {
    const res = await doPause(A_MEMBER.id);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, message: "You must be signed in to manage memberships." });
    nothingChanged();
  });

  it("an ARCHIVED actor's still-valid session is refused exactly like no session", async () => {
    const archived = await doPause(A_MEMBER.id, ARCHIVED_ADMIN.id);
    const none = await doPause(A_MEMBER.id);

    expect(archived.status).toBe(401);
    expect(await archived.json()).toEqual(await none.json());
    nothingChanged();
  });

  it("a DELETED actor's token -> 401", async () => {
    expect((await doPause(A_MEMBER.id, "no-such-actor")).status).toBe(401);
    nothingChanged();
  });

  it("a restored actor works again with the same session", async () => {
    expect((await doPause(A_MEMBER.id, ARCHIVED_ADMIN.id)).status).toBe(401);

    ARCHIVED_ADMIN.archivedAt = null;
    try {
      expect((await doPause(A_MEMBER.id, ARCHIVED_ADMIN.id)).status).toBe(200);
    } finally {
      ARCHIVED_ADMIN.archivedAt = "2026-09-01T00:00:00.000Z";
    }
  });
});

describe("GET /members/[userId]/ai-usage — same-gym authorized controls", () => {
  it("returns a same-gym member's usage summary and reads only that member's logs", async () => {
    const res = await aiUsage(A_MEMBER.id, A_ADMIN.id);

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(h.findAiUsageLogsByUserId).toHaveBeenCalledTimes(1);
    expect(h.findAiUsageLogsByUserId).toHaveBeenCalledWith(A_MEMBER.id);
  });

  it("a coach (members.view) may read within its own gym", async () => {
    expect((await aiUsage(A_MEMBER.id, A_COACH.id)).status).toBe(200);
  });

  it("works inside a second tenant", async () => {
    expect((await aiUsage(B_MEMBER.id, B_ADMIN.id)).status).toBe(200);
    expect(h.findAiUsageLogsByUserId).toHaveBeenCalledWith(B_MEMBER.id);
  });

  it("a platform operator may read within its own gym", async () => {
    expect((await aiUsage(A_MEMBER.id, OPERATOR.id)).status).toBe(200);
  });

  it("a same-gym member who has not reached the Membership tier is walled (existing behaviour); logs are not read", async () => {
    mockStaffCanViewMemberData.mockReturnValue(false);

    const res = await aiUsage(A_MEMBER.id, A_ADMIN.id);

    expect(res.status).toBe(403);
    expect(h.findAiUsageLogsByUserId).not.toHaveBeenCalled();
  });
});

describe("GET /members/[userId]/ai-usage — cross-gym targets", () => {
  const untouched = () => {
    expect(h.findAiUsageLogsByUserId).not.toHaveBeenCalled();
    expect(mockStaffCanViewMemberData).not.toHaveBeenCalled(); // gym scope runs before the tier wall
  };

  it.each([
    ["Tenant A admin -> Tenant B member", A_ADMIN.id, B_MEMBER.id],
    ["Tenant B admin -> Tenant A member (reverse direction)", B_ADMIN.id, A_MEMBER.id],
    ["Tenant B admin -> Tenant C member (two non-primary tenants)", B_ADMIN.id, C_MEMBER.id],
    ["platform operator -> Tenant B member (no cross-gym reach)", OPERATOR.id, B_MEMBER.id],
    ["Tenant A coach -> Tenant B member", A_COACH.id, B_MEMBER.id],
  ])("%s: 404, no logs read and the tier wall is not consulted", async (_label, actor, target) => {
    const res = await aiUsage(target, actor);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, message: "Member not found." });
    untouched();
  });

  it("a cross-gym target, a missing target and a cross-gym staff account are indistinguishable", async () => {
    const crossGym = await aiUsage(B_MEMBER.id, A_ADMIN.id);
    const missing = await aiUsage("no-such-member", A_ADMIN.id);
    const crossGymStaff = await aiUsage(B_COACH.id, A_ADMIN.id);

    expect(missing.status).toBe(crossGym.status);
    expect(crossGymStaff.status).toBe(crossGym.status);
    const body = await crossGym.json();
    expect(await missing.json()).toEqual(body);
    expect(await crossGymStaff.json()).toEqual(body);
    untouched();
  });
});

describe("GET /members/[userId]/ai-usage — wrong role, no session, archived and deleted actors", () => {
  const untouched = () => expect(h.findAiUsageLogsByUserId).not.toHaveBeenCalled();

  it("a plain member (no members.view) -> 403, before any target is looked at", async () => {
    const res = await aiUsage(A_MEMBER.id, A_MEMBER_PLAIN.id);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, message: "You don't have access to member details." });
    untouched();
  });

  it("an unauthorized cross-gym request is 403, not 404", async () => {
    expect((await aiUsage(B_MEMBER.id, A_MEMBER_PLAIN.id)).status).toBe(403);
    untouched();
  });

  it("no session -> 401", async () => {
    const res = await aiUsage(A_MEMBER.id);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, message: "You must be signed in." });
    untouched();
  });

  it("an ARCHIVED actor's still-valid session is refused exactly like no session", async () => {
    const archived = await aiUsage(A_MEMBER.id, ARCHIVED_ADMIN.id);
    const none = await aiUsage(A_MEMBER.id);

    expect(archived.status).toBe(401);
    expect(await archived.json()).toEqual(await none.json());
    untouched();
  });

  it("a DELETED actor's token -> 401", async () => {
    expect((await aiUsage(A_MEMBER.id, "no-such-actor")).status).toBe(401);
    untouched();
  });

  it("a restored actor works again with the same session", async () => {
    expect((await aiUsage(A_MEMBER.id, ARCHIVED_ADMIN.id)).status).toBe(401);

    ARCHIVED_ADMIN.archivedAt = null;
    try {
      expect((await aiUsage(A_MEMBER.id, ARCHIVED_ADMIN.id)).status).toBe(200);
    } finally {
      ARCHIVED_ADMIN.archivedAt = "2026-09-01T00:00:00.000Z";
    }
  });
});
