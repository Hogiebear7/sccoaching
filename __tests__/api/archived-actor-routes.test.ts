// An ARCHIVED account's still-valid session must not be able to act. Sessions are
// stateless signed tokens (no revocation), and most routes authenticate through
// verifyRequestSession, which now treats an archived or deleted account as no
// session. Representative routes, through the real routes, the real signed-
// session mechanism and the real can() / sameGym() / verifyRequestSession (only
// the datastore and the tier grant are mocked):
//   * POST /api/staff/members/reset-password  (account security)
//   * POST /api/staff/members/update          (login email + profile)
//   * POST /api/staff/members/[userId]/archive
//   * POST /api/staff/members/[userId]/tier   (tier grant)
//   * POST /api/mobile/staff/nutrition-target/update (mobile-staff)
//   * POST /api/profile/units                  (ordinary member route)
// For each: an archived actor gets the route's EXISTING unauthorized response
// (identical to having no session, and to a deleted account's token — so nothing
// reveals archive status), with no token created and nothing written. A live
// actor behaves exactly as before, and a restored actor works again.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  createResetToken: vi.fn(),
  findProfileByUserId: vi.fn(),
  saveProfile: vi.fn(),
  updateUserEmail: vi.fn(),
  setUserArchived: vi.fn(),
  findNutritionTargetByUserId: vi.fn(),
  saveNutritionTarget: vi.fn(),
  grantMemberTier: vi.fn(),
}));
vi.mock("@/lib/db", () => h);
vi.mock("@/lib/member-tier-wall", () => ({ staffCanViewMemberData: () => true }));
vi.mock("@/lib/tier-grant", () => ({ grantMemberTier: h.grantMemberTier }));

type U = { id: string; email: string; role: string; gymId: string | null; archivedAt: string | null };
const user = (id: string, role: string, archivedAt: string | null = null): U => ({ id, email: `${id}@x.test`, role, gymId: null, archivedAt });

let users: Record<string, U>;
const ARCHIVED_AT = "2026-09-01T00:00:00.000Z";

const cookie = (id: string) => `session=${signSession({ userId: id }, MEMBER_SESSION_LIFETIME_MS)}`;
const req = (as: string | null, body: unknown) =>
  new NextRequest("http://localhost/api/x", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(as ? { Cookie: cookie(as) } : {}) },
    body: JSON.stringify(body),
  });

const MEMBER_ID = "member";
const updateBody = { userId: MEMBER_ID, email: "member@x.test", fullName: "Some Person", phone: "0851234567", gender: "Other", primaryGoal: "General Health" };

type Case = {
  name: string;
  actorRole: "admin" | "coach" | "member";
  call: (as: string | null) => Promise<Response>;
  writes: () => ReturnType<typeof vi.fn>[];
};
const cases: Case[] = [
  {
    name: "members/reset-password",
    actorRole: "admin",
    call: async (as) => (await import("@/app/api/staff/members/reset-password/route")).POST(req(as, { userId: MEMBER_ID })),
    writes: () => [h.createResetToken],
  },
  {
    name: "members/update",
    actorRole: "admin",
    call: async (as) => (await import("@/app/api/staff/members/update/route")).POST(req(as, updateBody)),
    writes: () => [h.saveProfile, h.updateUserEmail],
  },
  {
    name: "members/[userId]/archive",
    actorRole: "admin",
    call: async (as) =>
      (await import("@/app/api/staff/members/[userId]/archive/route")).POST(req(as, { archived: true }), { params: Promise.resolve({ userId: MEMBER_ID }) }),
    writes: () => [h.setUserArchived],
  },
  {
    name: "members/[userId]/tier (tier grant)",
    actorRole: "admin",
    call: async (as) =>
      (await import("@/app/api/staff/members/[userId]/tier/route")).POST(req(as, { tier: "free" }), { params: Promise.resolve({ userId: MEMBER_ID }) }),
    writes: () => [h.grantMemberTier],
  },
  {
    name: "mobile/staff/nutrition-target/update (mobile-staff)",
    actorRole: "coach",
    call: async (as) =>
      (await import("@/app/api/mobile/staff/nutrition-target/update/route")).POST(req(as, { userId: MEMBER_ID, mode: "disabled" })),
    writes: () => [h.saveNutritionTarget],
  },
  {
    name: "profile/units (member route)",
    actorRole: "member",
    call: async (as) => (await import("@/app/api/profile/units/route")).POST(req(as, { preferredUnits: "metric" })),
    writes: () => [h.saveProfile],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  users = {
    admin: user("admin", "admin"),
    coach: user("coach", "coach"),
    member: user(MEMBER_ID, "member"),
    goneAdmin: user("goneAdmin", "admin", ARCHIVED_AT),
    goneCoach: user("goneCoach", "coach", ARCHIVED_AT),
    goneMember: user("goneMember", "member", ARCHIVED_AT),
  };
  h.findUserById.mockImplementation((id: string) => users[id]);
  h.createResetToken.mockReturnValue({ token: "tok-123", expiresAt: "2030-01-01T00:00:00.000Z" });
  h.findProfileByUserId.mockImplementation((id: string) => ({ userId: id, fullName: "Existing", email: `${id}@x.test`, cycleTrackingEnabled: false }));
  h.updateUserEmail.mockReturnValue(true);
  h.setUserArchived.mockReturnValue(true);
  h.findNutritionTargetByUserId.mockReturnValue(undefined);
  h.grantMemberTier.mockResolvedValue({ ok: true, tier: "free", message: "Updated." });
});

const actorFor = (role: Case["actorRole"], archived: boolean) => {
  const base = role === "admin" ? "Admin" : role === "coach" ? "Coach" : "Member";
  return archived ? `gone${base}` : base.toLowerCase();
};

describe.each(cases)("$name", (c) => {
  it("an ARCHIVED actor is rejected with 401 — nothing is created or written", async () => {
    const res = await c.call(actorFor(c.actorRole, true));

    expect(res.status).toBe(401);
    for (const write of c.writes()) expect(write).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it("the archived response is identical to having no session, and to a deleted account's token (no archive-status disclosure)", async () => {
    const archived = await c.call(actorFor(c.actorRole, true));
    const noSession = await c.call(null);
    users = { ...users }; // the token below names an account that doesn't exist
    const deleted = await c.call("no-such-account");

    expect(noSession.status).toBe(401);
    expect(deleted.status).toBe(401);
    const body = await archived.json();
    expect(body).toEqual(await noSession.json());
    expect(body).toEqual(await deleted.json());
    expect(JSON.stringify(body).toLowerCase()).not.toMatch(/archiv|deactivat/);
  });

  it("a LIVE actor is unchanged: the request goes through and writes", async () => {
    const res = await c.call(actorFor(c.actorRole, false));

    expect(res.status).toBe(200);
    expect(c.writes().some((write) => write.mock.calls.length > 0)).toBe(true);
  });

  it("a RESTORED actor works again with the same session", async () => {
    const id = actorFor(c.actorRole, true);
    expect((await c.call(id)).status).toBe(401);

    users[id].archivedAt = null;

    expect((await c.call(id)).status).toBe(200);
  });
});
