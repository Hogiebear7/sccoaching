// The platform_operator role gates gym moderation, platform Finance and platform
// jobs, so its ACCOUNT must not be reachable from a tenant role that shares its
// gym. An operator with gymId: null (the primary-gym convention) is in the same
// gym as every null-gym tenant admin — without this protection an admin could
// mint a reset link for the operator (reset-password RETURNS the URL), change
// its login email, demote it, or deactivate it, i.e. take over or disable the
// platform role.
//
// Covered here (all via the real routes, the real signed-session mechanism, and
// the real can() / sameGym(); only the datastore is mocked):
//   * POST /api/staff/members/reset-password
//   * POST /api/staff/members/update (login-email change)
//   * POST /api/staff/staff-users        (role change + create)
//   * POST /api/staff/staff-users/archive
// A protected target reads EXACTLY like a missing user (same status and
// message), before any mutation. The role is also never assignable: no route can
// create a platform_operator or promote to it.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findUserByEmail: vi.fn(),
  findStaffUsers: vi.fn(),
  createUserWithRole: vi.fn(),
  updateUserRole: vi.fn(),
  setUserArchived: vi.fn(),
  createResetToken: vi.fn(),
  findProfileByUserId: vi.fn(),
  saveProfile: vi.fn(),
  updateUserEmail: vi.fn(),
}));
vi.mock("@/lib/db", () => h);
vi.mock("@/lib/password", () => ({ hashPassword: () => "salt:hash" }));
vi.mock("@/lib/member-tier-wall", () => ({ staffCanViewMemberData: () => true }));

type U = { id: string; email: string; role: string; gymId: string | null; archivedAt: string | null };
const user = (id: string, role: string, gymId: string | null): U => ({ id, email: `${id}@x.test`, role, gymId, archivedAt: null });

// gymId: null is the primary-gym convention. The operator shares it with the tenant admins below.
const OPERATOR = user("op", "platform_operator", null);
const MGR_A = user("mgr-a", "admin_manager", null);
const ADMIN_A = user("admin-a", "admin", null);
const COACH_A = user("coach-a", "coach", null);
const MEMBER_A = user("member-a", "member", null);
const COACH_B = user("coach-b", "coach", "gym-b");
const MEMBER_B = user("member-b", "member", "gym-b");
const WORLD = [OPERATOR, MGR_A, ADMIN_A, COACH_A, MEMBER_A, COACH_B, MEMBER_B];

const cookie = (id: string) => `session=${signSession({ userId: id }, MEMBER_SESSION_LIFETIME_MS)}`;
const post = async (mod: string, body: unknown, as?: string) => {
  const { POST } = await import(mod);
  return POST(
    new NextRequest("http://localhost/x", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(as ? { Cookie: cookie(as) } : {}) },
      body: JSON.stringify(body),
    })
  );
};
const resetPassword = (userId: string, as: string) => post("@/app/api/staff/members/reset-password/route", { userId }, as);
const updateMember = (body: Record<string, unknown>, as: string) => post("@/app/api/staff/members/update/route", body, as);
const staffUsers = (body: Record<string, unknown>, as: string) => post("@/app/api/staff/staff-users/route", body, as);
const archive = (body: Record<string, unknown>, as: string) => post("@/app/api/staff/staff-users/archive/route", body, as);

let logSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  h.findUserById.mockImplementation((id: string) => WORLD.find((u) => u.id === id));
  h.findUserByEmail.mockReturnValue(undefined);
  h.findStaffUsers.mockImplementation(() => WORLD.filter((u) => u.role !== "member"));
  h.createUserWithRole.mockReturnValue({ id: "new-user" });
  h.createResetToken.mockReturnValue({ token: "tok-123", expiresAt: "2030-01-01T00:00:00.000Z" });
  h.findProfileByUserId.mockReturnValue({ userId: "op", fullName: "Op", email: "op@x.test" });
});

describe("reset-password: a tenant role cannot mint a reset link for the operator (would be account takeover)", () => {
  it.each([
    ["admin", ADMIN_A.id],
    ["admin_manager", MGR_A.id],
  ])("%s -> 404 'Member not found.', identical to a missing user, no token created", async (_role, actor) => {
    const protectedTarget = await resetPassword(OPERATOR.id, actor);
    const missing = await resetPassword("no-such-user", actor);

    expect(protectedTarget.status).toBe(404);
    expect(await protectedTarget.json()).toEqual({ success: false, message: "Member not found." });
    expect(missing.status).toBe(404);
    expect(h.createResetToken).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("still works for a same-gym member (control), and an operator may reset a same-gym member", async () => {
    expect((await resetPassword(MEMBER_A.id, ADMIN_A.id)).status).toBe(200);
    expect((await resetPassword(MEMBER_A.id, OPERATOR.id)).status).toBe(200);
    expect(h.createResetToken).toHaveBeenCalledTimes(2);
  });
});

describe("members/update: a tenant role cannot change the operator's login email or profile", () => {
  it("admin -> 404 'Member not found.'; nothing saved, no email change", async () => {
    const res = await updateMember({ userId: OPERATOR.id, email: "attacker@evil.test" }, ADMIN_A.id);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, message: "Member not found." });
    expect(h.updateUserEmail).not.toHaveBeenCalled();
    expect(h.saveProfile).not.toHaveBeenCalled();
  });
});

describe("staff-users: the operator can't be demoted or deactivated by a tenant manager, and the role is never assignable", () => {
  it("role change of the operator by a tenant admin_manager -> 404 'User not found.', no update", async () => {
    const res = await staffUsers({ id: OPERATOR.id, role: "coach" }, MGR_A.id);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, message: "User not found." });
    expect(h.updateUserRole).not.toHaveBeenCalled();
  });

  it("archive of the operator by a tenant admin_manager -> 404 'User not found.', no change", async () => {
    const res = await archive({ id: OPERATOR.id, archived: true }, MGR_A.id);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, message: "User not found." });
    expect(h.setUserArchived).not.toHaveBeenCalled();
  });

  it("controls: the same tenant manager can still change a coach's role and archive a coach", async () => {
    expect((await staffUsers({ id: COACH_A.id, role: "admin" }, MGR_A.id)).status).toBe(200);
    expect(h.updateUserRole).toHaveBeenCalledWith(COACH_A.id, "admin");
    expect((await archive({ id: COACH_A.id, archived: true }, MGR_A.id)).status).toBe(200);
    expect(h.setUserArchived).toHaveBeenCalledWith(COACH_A.id, true);
  });

  it.each([
    ["tenant admin_manager", MGR_A.id],
    ["platform_operator", OPERATOR.id],
  ])("nobody can create or promote to platform_operator through the UI route (%s -> 400)", async (_who, actor) => {
    const create = await staffUsers({ email: "new@x.test", password: "Str0ng!Pass", role: "platform_operator" }, actor);
    const promote = await staffUsers({ id: COACH_A.id, role: "platform_operator" }, actor);

    for (const res of [create, promote]) {
      expect(res.status).toBe(400);
      expect((await res.json()).message).toBe("A valid role (coach, admin, admin_manager) is required.");
    }
    expect(h.createUserWithRole).not.toHaveBeenCalled();
    expect(h.updateUserRole).not.toHaveBeenCalled();
  });

  it("an operator acting on staff can still manage ordinary staff in their own gym (operator is not blocked from tenant tools)", async () => {
    expect((await staffUsers({ id: COACH_A.id, role: "admin" }, OPERATOR.id)).status).toBe(200);
  });
});

describe("platform privileges do not bypass ordinary same-gym checks: an operator (gymId null) has no cross-gym reach on tenant routes", () => {
  it("cannot mint a reset link for, or change the login email of, another gym's member", async () => {
    const reset = await resetPassword(MEMBER_B.id, OPERATOR.id);
    const update = await updateMember({ userId: MEMBER_B.id, email: "x@evil.test" }, OPERATOR.id);

    expect(reset.status).toBe(404);
    expect(await reset.json()).toEqual({ success: false, message: "Member not found." });
    expect(update.status).toBe(404);
    expect(h.createResetToken).not.toHaveBeenCalled();
    expect(h.updateUserEmail).not.toHaveBeenCalled();
    expect(h.saveProfile).not.toHaveBeenCalled();
  });

  it("cannot change the role of, or deactivate, another gym's staff", async () => {
    const role = await staffUsers({ id: COACH_B.id, role: "admin" }, OPERATOR.id);
    const off = await archive({ id: COACH_B.id, archived: true }, OPERATOR.id);

    expect(role.status).toBe(404);
    expect(off.status).toBe(404);
    expect(h.updateUserRole).not.toHaveBeenCalled();
    expect(h.setUserArchived).not.toHaveBeenCalled();
  });

  it("a newly created staff account always gets the acting operator's gym (null here), never a client value", async () => {
    await staffUsers({ email: "new@x.test", password: "Str0ng!Pass", role: "coach", gymId: "gym-b" }, OPERATOR.id);

    expect(h.createUserWithRole).toHaveBeenCalledWith("new@x.test", "salt:hash", "coach", null);
  });
});
