// Authorization and gym scope for POST /api/staff/members/bulk-tier — TESTS ONLY
// (characterizes existing behaviour; no route change). The route takes a list of
// client-supplied member ids and grants each a tier. For EVERY id it must load
// the target and confirm it is in the acting staff member's gym BEFORE
// grantMemberTier runs; a cross-gym or missing id becomes a per-item
// "Member not found." result and is never granted.
//
// Real signed sessions; the real can(), sameGym()/sameGymAsStaff() and
// verifyRequestSession are NOT mocked — only the datastore and grantMemberTier.
// All fixtures are synthetic. Tenant A = primary gym (gymId: null convention),
// Tenant B / Tenant C = two separate non-primary gyms.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({ findUserById: vi.fn() }));
vi.mock("@/lib/db", () => h);

const { mockGrantMemberTier } = vi.hoisted(() => ({ mockGrantMemberTier: vi.fn() }));
vi.mock("@/lib/tier-grant", () => ({ grantMemberTier: mockGrantMemberTier }));

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
const A_MEMBER_1 = user("member-a1", "member", null);
const A_MEMBER_2 = user("member-a2", "member", null);
const A_MEMBER_PLAIN = user("member-a-plain", "member", null); // acts as a non-staff caller
const B_ADMIN = user("admin-b", "admin", "gym-b");
const B_MEMBER = user("member-b1", "member", "gym-b");
const B_COACH = user("coach-b", "coach", "gym-b");
const C_MEMBER = user("member-c1", "member", "gym-c");
const OPERATOR = user("operator", "platform_operator", null);
const ARCHIVED_ADMIN = user("admin-archived", "admin", null, "2026-09-01T00:00:00.000Z");

let world: U[];
const NOT_FOUND = { ok: false, message: "Member not found." };

const cookie = (id: string) => `session=${signSession({ userId: id }, MEMBER_SESSION_LIFETIME_MS)}`;
async function bulk(body: unknown, as?: string, rawBody?: string) {
  const { POST } = await import("@/app/api/staff/members/bulk-tier/route");
  return POST(
    new NextRequest("http://localhost/api/staff/members/bulk-tier", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(as ? { Cookie: cookie(as) } : {}) },
      body: rawBody ?? JSON.stringify(body),
    })
  );
}
const grant = (userIds: unknown, as: string, tier: unknown = "app_subscription") => bulk({ userIds, tier }, as);
const results = async (res: Response) => (await res.json()).data.results as { userId: string; ok: boolean; message: string }[];
const grantedIds = () => mockGrantMemberTier.mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.clearAllMocks();
  world = [A_ADMIN, A_COACH, A_MEMBER_1, A_MEMBER_2, A_MEMBER_PLAIN, B_ADMIN, B_MEMBER, B_COACH, C_MEMBER, OPERATOR, ARCHIVED_ADMIN];
  h.findUserById.mockImplementation((id: string) => world.find((u) => u.id === id));
  mockGrantMemberTier.mockResolvedValue({ ok: true, message: "Updated.", tier: "app_subscription" });
});

describe("bulk-tier: same-gym authorized controls", () => {
  it("grants every same-gym member, once each, with the requested tier", async () => {
    const res = await grant([A_MEMBER_1.id, A_MEMBER_2.id], A_ADMIN.id, "membership");

    expect(res.status).toBe(200);
    expect(await results(res)).toEqual([
      { userId: A_MEMBER_1.id, ok: true, message: "Updated." },
      { userId: A_MEMBER_2.id, ok: true, message: "Updated." },
    ]);
    expect(mockGrantMemberTier).toHaveBeenCalledTimes(2);
    expect(mockGrantMemberTier).toHaveBeenNthCalledWith(1, A_MEMBER_1.id, "membership");
    expect(mockGrantMemberTier).toHaveBeenNthCalledWith(2, A_MEMBER_2.id, "membership");
  });

  it("works inside a second tenant as well (Tenant B admin, Tenant B member)", async () => {
    const res = await grant([B_MEMBER.id], B_ADMIN.id);

    expect(res.status).toBe(200);
    expect((await results(res))[0].ok).toBe(true);
    expect(grantedIds()).toEqual([B_MEMBER.id]);
  });

  it("a platform operator may grant within its own gym (operator has no cross-gym reach: see below)", async () => {
    const res = await grant([A_MEMBER_1.id], OPERATOR.id);

    expect(res.status).toBe(200);
    expect(grantedIds()).toEqual([A_MEMBER_1.id]);
  });

  it("surfaces a grant failure or warning for a same-gym member as that item's result (existing behaviour)", async () => {
    mockGrantMemberTier.mockResolvedValueOnce({ ok: false, message: "Could not grant." });
    mockGrantMemberTier.mockResolvedValueOnce({ ok: true, message: "Updated.", warning: "Heads up." });

    const res = await grant([A_MEMBER_1.id, A_MEMBER_2.id], A_ADMIN.id);

    expect(await results(res)).toEqual([
      { userId: A_MEMBER_1.id, ok: false, message: "Could not grant." },
      { userId: A_MEMBER_2.id, ok: true, message: "Heads up." },
    ]);
  });
});

describe("bulk-tier: cross-gym targets are never granted", () => {
  it("a cross-gym id becomes a per-item 'Member not found.' result; nothing is granted", async () => {
    const res = await grant([B_MEMBER.id], A_ADMIN.id);

    expect(res.status).toBe(200); // per-item results are the existing contract
    expect(await results(res)).toEqual([{ userId: B_MEMBER.id, ...NOT_FOUND }]);
    expect(mockGrantMemberTier).not.toHaveBeenCalled();
  });

  it("in a mixed batch only the same-gym ids are granted, and results keep the request order", async () => {
    const res = await grant([B_MEMBER.id, A_MEMBER_1.id, C_MEMBER.id, A_MEMBER_2.id], A_ADMIN.id);

    expect((await results(res)).map((r) => [r.userId, r.ok])).toEqual([
      [B_MEMBER.id, false],
      [A_MEMBER_1.id, true],
      [C_MEMBER.id, false],
      [A_MEMBER_2.id, true],
    ]);
    expect(grantedIds()).toEqual([A_MEMBER_1.id, A_MEMBER_2.id]);
  });

  it.each([
    ["Tenant B admin -> Tenant A member (reverse direction)", B_ADMIN.id, A_MEMBER_1.id],
    ["Tenant B admin -> Tenant C member (two non-primary tenants)", B_ADMIN.id, C_MEMBER.id],
    ["Tenant A admin -> Tenant B member", A_ADMIN.id, B_MEMBER.id],
  ])("%s: denied, nothing granted", async (_label, actor, target) => {
    const res = await grant([target], actor);

    expect(await results(res)).toEqual([{ userId: target, ...NOT_FOUND }]);
    expect(mockGrantMemberTier).not.toHaveBeenCalled();
  });

  it("a platform operator gets no cross-gym reach here either", async () => {
    const res = await grant([B_MEMBER.id, C_MEMBER.id], OPERATOR.id);

    expect((await results(res)).every((r) => !r.ok && r.message === "Member not found.")).toBe(true);
    expect(mockGrantMemberTier).not.toHaveBeenCalled();
  });

  it("a missing id and a cross-gym id produce the identical result, so existence across gyms is not revealed", async () => {
    const [crossGym] = await results(await grant([B_MEMBER.id], A_ADMIN.id));
    const [missing] = await results(await grant(["no-such-member"], A_ADMIN.id));

    expect({ ok: crossGym.ok, message: crossGym.message }).toEqual({ ok: missing.ok, message: missing.message });
  });

  it("a cross-gym STAFF account reads exactly like a cross-gym member (role is not revealed)", async () => {
    const [asMember] = await results(await grant([B_MEMBER.id], A_ADMIN.id));
    const [asCoach] = await results(await grant([B_COACH.id], A_ADMIN.id));
    const [asAdmin] = await results(await grant([B_ADMIN.id], A_ADMIN.id));

    for (const r of [asCoach, asAdmin]) expect({ ok: r.ok, message: r.message }).toEqual({ ok: asMember.ok, message: asMember.message });
    expect(mockGrantMemberTier).not.toHaveBeenCalled();
  });

  it("ignores any client-supplied gym or tenant identifier in the body", async () => {
    const res = await bulk({ userIds: [B_MEMBER.id], tier: "app_subscription", gymId: null, tenantId: "gym-b" }, A_ADMIN.id);

    expect(await results(res)).toEqual([{ userId: B_MEMBER.id, ...NOT_FOUND }]);
    expect(mockGrantMemberTier).not.toHaveBeenCalled();
  });
});

describe("bulk-tier: wrong role, unauthenticated, archived and deleted actors", () => {
  it.each([
    ["a coach (below members.grantTier)", A_COACH.id],
    ["a plain member", A_MEMBER_PLAIN.id],
  ])("%s -> 403, and nothing is granted", async (_label, actor) => {
    const res = await grant([A_MEMBER_1.id], actor);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, message: "Only staff can manage memberships." });
    expect(mockGrantMemberTier).not.toHaveBeenCalled();
  });

  it("checks the capability before looking at any target: an unauthorized cross-gym request is 403, not a per-item result", async () => {
    const res = await grant([B_MEMBER.id], A_COACH.id);

    expect(res.status).toBe(403);
    expect(mockGrantMemberTier).not.toHaveBeenCalled();
  });

  it("no session -> 401, nothing granted", async () => {
    const res = await bulk({ userIds: [A_MEMBER_1.id], tier: "free" });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, message: "You must be signed in to manage memberships." });
    expect(mockGrantMemberTier).not.toHaveBeenCalled();
  });

  it("an ARCHIVED actor's still-valid session -> 401, identical to no session; nothing granted", async () => {
    const archived = await grant([A_MEMBER_1.id], ARCHIVED_ADMIN.id);
    const none = await bulk({ userIds: [A_MEMBER_1.id], tier: "free" });

    expect(archived.status).toBe(401);
    expect(await archived.json()).toEqual(await none.json());
    expect(mockGrantMemberTier).not.toHaveBeenCalled();
  });

  it("a DELETED actor's token -> 401; nothing granted", async () => {
    const res = await grant([A_MEMBER_1.id], "no-such-actor");

    expect(res.status).toBe(401);
    expect(mockGrantMemberTier).not.toHaveBeenCalled();
  });

  it("a restored actor works again with the same session", async () => {
    expect((await grant([A_MEMBER_1.id], ARCHIVED_ADMIN.id)).status).toBe(401);

    ARCHIVED_ADMIN.archivedAt = null;
    try {
      const res = await grant([A_MEMBER_1.id], ARCHIVED_ADMIN.id);
      expect(res.status).toBe(200);
      expect(grantedIds()).toEqual([A_MEMBER_1.id]);
    } finally {
      ARCHIVED_ADMIN.archivedAt = "2026-09-01T00:00:00.000Z";
    }
  });
});

describe("bulk-tier: request validation (existing behaviour, nothing granted)", () => {
  it.each([
    ["an unknown tier", { userIds: ["member-a1"], tier: "platinum" }, "A valid tier is required."],
    ["a missing tier", { userIds: ["member-a1"] }, "A valid tier is required."],
    ["an empty id list", { userIds: [], tier: "free" }, "At least one member is required."],
    ["a non-array id list", { userIds: "member-a1", tier: "free" }, "At least one member is required."],
    ["a non-string id in the list", { userIds: ["member-a1", 7], tier: "free" }, "At least one member is required."],
  ])("%s -> 400", async (_label, body, message) => {
    const res = await bulk(body, A_ADMIN.id);

    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe(message);
    expect(mockGrantMemberTier).not.toHaveBeenCalled();
  });

  it("invalid JSON -> 400", async () => {
    const res = await bulk(undefined, A_ADMIN.id, "{not json");

    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("Invalid JSON body.");
    expect(mockGrantMemberTier).not.toHaveBeenCalled();
  });
});
