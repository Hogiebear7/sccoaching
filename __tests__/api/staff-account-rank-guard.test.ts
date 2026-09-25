// An actor must not be able to act on a same-gym account whose role ranks
// STRICTLY above their own. The concrete hole this closes: a gym `admin`
// (members.account) could mint a reset link for — or change the login email of —
// the gym's `admin_manager` (the owner), which is an account takeover.
//
// Covered here (real routes, real signed sessions, real can() / sameGym() /
// rank; only the datastore is mocked):
//   * POST /api/staff/members/reset-password
//   * POST /api/staff/members/update
// A blocked target reads EXACTLY like a missing user (same status and message),
// before any token is created or any email / profile is written. Equal-rank and
// lower-rank targets keep the behaviour they had. The platform-operator
// protection is unchanged (see platform-operator-account-protection.test.ts).
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  createResetToken: vi.fn(),
  findProfileByUserId: vi.fn(),
  saveProfile: vi.fn(),
  updateUserEmail: vi.fn(),
}));
vi.mock("@/lib/db", () => h);
vi.mock("@/lib/member-tier-wall", () => ({ staffCanViewMemberData: () => true }));

type U = { id: string; email: string; role: string; gymId: string | null; archivedAt: string | null };
const user = (id: string, role: string, gymId: string | null = null): U => ({ id, email: `${id}@x.test`, role, gymId, archivedAt: null });

const MGR = user("mgr", "admin_manager");
const MGR_2 = user("mgr-2", "admin_manager");
const LEGACY_STAFF = user("legacy-staff", "staff");
const ADMIN = user("admin", "admin");
const ADMIN_2 = user("admin-2", "admin");
const COACH = user("coach", "coach");
const COACH_2 = user("coach-2", "coach");
const MEMBER = user("member", "member");
const OPERATOR = user("op", "platform_operator");
const WORLD = [MGR, MGR_2, LEGACY_STAFF, ADMIN, ADMIN_2, COACH, COACH_2, MEMBER, OPERATOR];

const cookie = (id: string) => `session=${signSession({ userId: id }, MEMBER_SESSION_LIFETIME_MS)}`;
const post = async (mod: string, body: unknown, as: string) => {
  const { POST } = await import(mod);
  return POST(
    new NextRequest("http://localhost/x", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie(as) },
      body: JSON.stringify(body),
    })
  );
};
const resetPassword = (userId: string, as: string) => post("@/app/api/staff/members/reset-password/route", { userId }, as);

// A complete, valid members/update body, so an ALLOWED call reaches the write.
const updateBody = (userId: string, email: string) => ({
  userId,
  email,
  fullName: "Some Person",
  phone: "0851234567",
  gender: "Other",
  primaryGoal: "General Health",
});
const updateMember = (userId: string, email: string, as: string) => post("@/app/api/staff/members/update/route", updateBody(userId, email), as);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  h.findUserById.mockImplementation((id: string) => WORLD.find((u) => u.id === id));
  h.createResetToken.mockReturnValue({ token: "tok-123", expiresAt: "2030-01-01T00:00:00.000Z" });
  h.findProfileByUserId.mockImplementation((id: string) => ({ userId: id, fullName: "Existing", email: `${id}@x.test`, cycleTrackingEnabled: false }));
  h.updateUserEmail.mockReturnValue(true);
});

describe("reset-password: a lower-ranked actor cannot mint a reset link for a higher-ranked account", () => {
  it.each([
    ["an admin_manager", MGR.id],
    ["a legacy 'staff' row (ranks as admin_manager)", LEGACY_STAFF.id],
  ])("admin -> %s: 404 'Member not found.', identical to a missing user, no token created", async (_label, target) => {
    const blocked = await resetPassword(target, ADMIN.id);
    const missing = await resetPassword("no-such-user", ADMIN.id);

    expect(blocked.status).toBe(missing.status);
    expect(await blocked.json()).toEqual(await missing.json());
    expect(h.createResetToken).not.toHaveBeenCalled();
  });

  it("a coach is refused by capability (403) before any target is looked at; no token", async () => {
    const res = await resetPassword(MGR.id, COACH.id);

    expect(res.status).toBe(403);
    expect(h.createResetToken).not.toHaveBeenCalled();
  });

  it("admin -> admin_manager is exactly the missing-user 404 (body and status), with no token and nothing logged", async () => {
    const res = await resetPassword(MGR.id, ADMIN.id);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, message: "Member not found." });
    expect(h.createResetToken).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it.each([
    ["admin -> a same-gym member", ADMIN.id, MEMBER.id],
    ["admin -> a same-gym coach", ADMIN.id, COACH.id],
    ["admin -> another admin (equal rank)", ADMIN.id, ADMIN_2.id],
    ["admin_manager -> an admin", MGR.id, ADMIN.id],
    ["admin_manager -> another admin_manager (equal rank)", MGR.id, MGR_2.id],
    ["legacy 'staff' -> admin_manager (staff ranks as admin_manager)", LEGACY_STAFF.id, MGR.id],
    ["admin_manager -> legacy 'staff'", MGR.id, LEGACY_STAFF.id],
    ["platform_operator -> an admin_manager in its own gym", OPERATOR.id, MGR.id],
  ])("still works (unchanged): %s", async (_label, actor, target) => {
    const res = await resetPassword(target, actor);

    expect(res.status).toBe(200);
    expect(h.createResetToken).toHaveBeenCalledWith(target);
  });
});

describe("members/update: a lower-ranked actor cannot change a higher-ranked account's login email or profile", () => {
  it("admin -> admin_manager: 404 'Member not found.'; no email change and no profile save", async () => {
    const res = await updateMember(MGR.id, "attacker@evil.test", ADMIN.id);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, message: "Member not found." });
    expect(h.updateUserEmail).not.toHaveBeenCalled();
    expect(h.saveProfile).not.toHaveBeenCalled();
  });

  it("admin -> legacy 'staff' row (ranks as admin_manager): blocked the same way", async () => {
    const res = await updateMember(LEGACY_STAFF.id, "attacker@evil.test", ADMIN.id);

    expect(res.status).toBe(404);
    expect(h.updateUserEmail).not.toHaveBeenCalled();
    expect(h.saveProfile).not.toHaveBeenCalled();
  });

  it("coach -> admin: blocked too (a coach editing a higher-ranked staff profile is no longer reachable)", async () => {
    const res = await updateMember(ADMIN.id, ADMIN.email, COACH.id);

    expect(res.status).toBe(404);
    expect(h.saveProfile).not.toHaveBeenCalled();
  });

  it("a blocked target and a missing user are indistinguishable (same status and body)", async () => {
    const blocked = await updateMember(MGR.id, "x@evil.test", ADMIN.id);
    const missing = await updateMember("no-such-user", "x@evil.test", ADMIN.id);

    expect(blocked.status).toBe(missing.status);
    expect(await blocked.json()).toEqual(await missing.json());
  });

  it.each([
    ["admin -> a same-gym member", ADMIN.id, MEMBER.id],
    ["admin -> a same-gym coach", ADMIN.id, COACH.id],
    ["admin -> another admin (equal rank)", ADMIN.id, ADMIN_2.id],
    ["admin_manager -> another admin_manager (equal rank)", MGR.id, MGR_2.id],
    ["legacy 'staff' -> admin_manager", LEGACY_STAFF.id, MGR.id],
    ["coach -> another coach (equal rank)", COACH.id, COACH_2.id],
    ["coach -> a member", COACH.id, MEMBER.id],
  ])("still saves the profile (unchanged): %s", async (_label, actor, target) => {
    const res = await updateMember(target, `${target}@x.test`, actor);

    expect(res.status).toBe(200);
    expect(h.saveProfile).toHaveBeenCalledTimes(1);
  });

  it("admin -> same-gym member email change still works (unchanged)", async () => {
    const res = await updateMember(MEMBER.id, "new-address@x.test", ADMIN.id);

    expect(res.status).toBe(200);
    expect(h.updateUserEmail).toHaveBeenCalledWith(MEMBER.id, "new-address@x.test");
  });
});
