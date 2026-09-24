// Gym isolation for app/api/staff/staff-users/route.ts (create + role change)
// and app/api/staff/staff-users/archive/route.ts (archive/restore). Every
// target must be in the acting manager's own gym (cross-gym and missing are
// the same "User not found." 404, before the member-role 400, the
// last-manager rule, and any mutation); a newly created account always gets
// the ACTING MANAGER's gymId (never a body value); and the last-admin_manager
// safety rule is evaluated per gym from the staff user list. Auth uses the
// real signed-session mechanism; sameGym and can() are deliberately not
// mocked, and the user "database" is a realistic two-gym fixture.
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
}));
vi.mock("@/lib/db", () => h);
vi.mock("@/lib/password", () => ({ hashPassword: () => "salt:hash" }));

type U = { id: string; email: string; role: "member" | "coach" | "admin" | "admin_manager"; gymId: string | null; archivedAt: string | null };
const user = (id: string, role: U["role"], gymId: string | null, archivedAt: string | null = null): U => ({
  id,
  email: `${id}@x.test`,
  role,
  gymId,
  archivedAt,
});

// gymId: null is the established primary-gym convention (lib/gym-scope.ts).
const MGR_A = user("mgr-a", "admin_manager", null);
const MGR_A2 = user("mgr-a2", "admin_manager", null);
const ADMIN_A = user("admin-a", "admin", null);
const COACH_A = user("coach-a", "coach", null);
const MEMBER_A = user("member-a", "member", null);
const MGR_B = user("mgr-b", "admin_manager", "gym-b");
const MGR_B2 = user("mgr-b2", "admin_manager", "gym-b");
const ADMIN_B = user("admin-b", "admin", "gym-b");
const COACH_B = user("coach-b", "coach", "gym-b");
const MEMBER_B = user("member-b", "member", "gym-b");

let world: U[] = [];
function setWorld(...users: U[]) {
  world = users;
}
const DEFAULT_WORLD = [MGR_A, ADMIN_A, COACH_A, MEMBER_A, MGR_B, MGR_B2, ADMIN_B, COACH_B, MEMBER_B];

const NOT_FOUND = { success: false, message: "User not found." };

async function callRole(body: unknown, sessionUserId?: string, rawBody?: string) {
  const { POST } = await import("@/app/api/staff/staff-users/route");
  const req = new NextRequest("http://localhost/api/staff/staff-users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(sessionUserId
        ? { Cookie: `session=${signSession({ userId: sessionUserId }, MEMBER_SESSION_LIFETIME_MS)}` }
        : {}),
    },
    body: rawBody ?? JSON.stringify(body),
  });
  return POST(req);
}

async function callArchive(body: unknown, sessionUserId?: string, rawBody?: string) {
  const { POST } = await import("@/app/api/staff/staff-users/archive/route");
  const req = new NextRequest("http://localhost/api/staff/staff-users/archive", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(sessionUserId
        ? { Cookie: `session=${signSession({ userId: sessionUserId }, MEMBER_SESSION_LIFETIME_MS)}` }
        : {}),
    },
    body: rawBody ?? JSON.stringify(body),
  });
  return POST(req);
}

function expectNoMutation() {
  expect(h.updateUserRole).not.toHaveBeenCalled();
  expect(h.setUserArchived).not.toHaveBeenCalled();
  expect(h.createUserWithRole).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  setWorld(...DEFAULT_WORLD);
  h.findUserById.mockImplementation((id: string) => world.find((u) => u.id === id));
  h.findStaffUsers.mockImplementation(() => world.filter((u) => u.role !== "member"));
  h.findUserByEmail.mockReturnValue(undefined);
  h.createUserWithRole.mockReturnValue({ id: "new-1" });
});

describe("POST /api/staff/staff-users — role change", () => {
  it("changes a same-gym staff user's role", async () => {
    const res = await callRole({ id: ADMIN_A.id, role: "coach" }, MGR_A.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: "Role updated to coach." });
    expect(h.updateUserRole).toHaveBeenCalledWith(ADMIN_A.id, "coach");
  });

  it("works within the second gym too", async () => {
    const res = await callRole({ id: ADMIN_B.id, role: "coach" }, MGR_B.id);

    expect(res.status).toBe(200);
    expect(h.updateUserRole).toHaveBeenCalledWith(ADMIN_B.id, "coach");
  });

  it("denies a cross-gym role change with the existing 404, identical to a missing user", async () => {
    const crossGym = await callRole({ id: ADMIN_B.id, role: "admin_manager" }, MGR_A.id);
    const crossGymBody = await crossGym.json();
    const missing = await callRole({ id: "user-missing", role: "admin_manager" }, MGR_A.id);
    const missingBody = await missing.json();

    expect(crossGym.status).toBe(404);
    expect(crossGymBody).toEqual(NOT_FOUND);
    expect(missing.status).toBe(404);
    expect(missingBody).toEqual(crossGymBody);
    expectNoMutation();
  });

  it("denies the reverse direction too (gym-B manager, gym-A staff)", async () => {
    const res = await callRole({ id: ADMIN_A.id, role: "coach" }, MGR_B.id);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
    expectNoMutation();
  });

  it("does not reveal a cross-gym target's role: a member target gets the same 404, not the 'staff accounts only' 400", async () => {
    const crossGymMember = await callRole({ id: MEMBER_B.id, role: "coach" }, MGR_A.id);
    const crossGymStaff = await callRole({ id: COACH_B.id, role: "coach" }, MGR_A.id);

    expect(crossGymMember.status).toBe(404);
    expect(await crossGymMember.json()).toEqual(NOT_FOUND);
    expect(crossGymStaff.status).toBe(404);
    expect(await crossGymStaff.json()).toEqual(NOT_FOUND);

    // Control: the existing member-role rejection is preserved within the same gym.
    const sameGymMember = await callRole({ id: MEMBER_A.id, role: "coach" }, MGR_A.id);
    expect(sameGymMember.status).toBe(400);
    expect((await sameGymMember.json()).message).toBe("This tool manages staff accounts only.");
    expectNoMutation();
  });

  it("ignores a client-supplied gymId when targeting an existing user", async () => {
    const res = await callRole({ id: ADMIN_B.id, role: "coach", gymId: null }, MGR_A.id);

    expect(res.status).toBe(404);
    expectNoMutation();
  });
});

describe("POST /api/staff/staff-users/archive — archive and restore", () => {
  it("archives a same-gym staff user", async () => {
    const res = await callArchive({ id: ADMIN_A.id, archived: true }, MGR_A.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: "Account deactivated." });
    expect(h.setUserArchived).toHaveBeenCalledWith(ADMIN_A.id, true);
  });

  it("restores a same-gym staff user", async () => {
    setWorld(...DEFAULT_WORLD.filter((u) => u.id !== COACH_A.id), user("coach-a", "coach", null, "2026-01-01T00:00:00.000Z"));

    const res = await callArchive({ id: COACH_A.id, archived: false }, MGR_A.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: "Account reactivated." });
    expect(h.setUserArchived).toHaveBeenCalledWith(COACH_A.id, false);
  });

  it("denies a cross-gym archive with the existing 404, identical to a missing user", async () => {
    const crossGym = await callArchive({ id: ADMIN_B.id, archived: true }, MGR_A.id);
    const crossGymBody = await crossGym.json();
    const missing = await callArchive({ id: "user-missing", archived: true }, MGR_A.id);
    const missingBody = await missing.json();

    expect(crossGym.status).toBe(404);
    expect(crossGymBody).toEqual(NOT_FOUND);
    expect(missingBody).toEqual(crossGymBody);
    expectNoMutation();
  });

  it("denies a cross-gym restore", async () => {
    const res = await callArchive({ id: COACH_B.id, archived: false }, MGR_A.id);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
    expectNoMutation();
  });

  it("denies the reverse direction too (gym-B manager archiving gym-A staff)", async () => {
    const res = await callArchive({ id: ADMIN_A.id, archived: true }, MGR_B.id);

    expect(res.status).toBe(404);
    expectNoMutation();
  });

  it("does not reveal a cross-gym target's role: a member target gets the same 404, not the 'staff accounts only' 400", async () => {
    const res = await callArchive({ id: MEMBER_B.id, archived: true }, MGR_A.id);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);

    const sameGymMember = await callArchive({ id: MEMBER_A.id, archived: true }, MGR_A.id);
    expect(sameGymMember.status).toBe(400);
    expectNoMutation();
  });
});

describe("POST /api/staff/staff-users — staff creation gym", () => {
  const body = { email: "new@x.test", password: "password1", role: "coach" };

  it("places a new staff account in the creating manager's gym (primary gym: null)", async () => {
    const res = await callRole(body, MGR_A.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: "Created coach account for new@x.test.", id: "new-1" });
    expect(h.createUserWithRole).toHaveBeenCalledWith("new@x.test", "salt:hash", "coach", null);
  });

  it("places a new staff account in gym-B when a gym-B manager creates it", async () => {
    await callRole(body, MGR_B.id);

    expect(h.createUserWithRole).toHaveBeenCalledWith("new@x.test", "salt:hash", "coach", "gym-b");
  });

  it("cannot be redirected to another gym by a client-supplied gymId", async () => {
    await callRole({ ...body, gymId: "gym-b" }, MGR_A.id);
    expect(h.createUserWithRole).toHaveBeenLastCalledWith("new@x.test", "salt:hash", "coach", null);

    await callRole({ ...body, gymId: null }, MGR_B.id);
    expect(h.createUserWithRole).toHaveBeenLastCalledWith("new@x.test", "salt:hash", "coach", "gym-b");
  });

  it("creates nothing on invalid requests: bad role, short password, bad email, duplicate email", async () => {
    expect((await callRole({ ...body, role: "superuser" }, MGR_A.id)).status).toBe(400);
    expect((await callRole({ ...body, password: "short" }, MGR_A.id)).status).toBe(400);
    expect((await callRole({ ...body, email: "not-an-email" }, MGR_A.id)).status).toBe(400);
    h.findUserByEmail.mockReturnValue({ id: "dupe" });
    expect((await callRole(body, MGR_A.id)).status).toBe(409);
    expectNoMutation();
  });
});

describe("last-admin_manager protection is per gym", () => {
  it("blocks a gym's only manager from demoting themself, even though other gyms have managers", async () => {
    // Gym A: MGR_A only. Gym B: two managers. A global count would be 3 and allow this.
    setWorld(MGR_A, MGR_B, MGR_B2);

    const res = await callRole({ id: MGR_A.id, role: "admin" }, MGR_A.id);

    expect(res.status).toBe(409);
    expect((await res.json()).message).toBe(
      "You are the last admin manager — promote another admin manager before changing your own role."
    );
    expectNoMutation();
  });

  it("allows demoting a manager when another manager remains in the same gym, regardless of other gyms", async () => {
    // Gym A: two managers. Gym B: one (the last in gym B) — irrelevant to gym A's decision.
    setWorld(MGR_A, MGR_A2, MGR_B);

    const res = await callRole({ id: MGR_A2.id, role: "admin" }, MGR_A.id);

    expect(res.status).toBe(200);
    expect(h.updateUserRole).toHaveBeenCalledWith(MGR_A2.id, "admin");
  });

  it("still protects gym B's last manager while gym A has many managers", async () => {
    setWorld(MGR_A, MGR_A2, MGR_B);

    const res = await callRole({ id: MGR_B.id, role: "coach" }, MGR_B.id);

    expect(res.status).toBe(409);
    expectNoMutation();
  });

  it("does not let a gym-A manager touch gym B's last manager: the same-gym gate answers first (404, not 409)", async () => {
    setWorld(MGR_A, MGR_B);

    const demote = await callRole({ id: MGR_B.id, role: "admin" }, MGR_A.id);
    const archive = await callArchive({ id: MGR_B.id, archived: true }, MGR_A.id);

    expect(demote.status).toBe(404);
    expect(archive.status).toBe(404);
    expectNoMutation();
  });

  it("does not count archived managers toward the gym's remaining managers", async () => {
    setWorld(MGR_A, user("mgr-a-old", "admin_manager", null, "2026-01-01T00:00:00.000Z"), MGR_B, MGR_B2);

    const res = await callRole({ id: MGR_A.id, role: "admin" }, MGR_A.id);

    expect(res.status).toBe(409);
    expectNoMutation();
  });

  it("applies the same per-gym rule to archive: blocks the gym's last manager, allows one of two", async () => {
    setWorld(MGR_A, MGR_B, MGR_B2);
    const blocked = await callArchive({ id: MGR_A.id, archived: true }, MGR_A.id);
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).message).toBe("You are the last admin manager — you can't deactivate your own account.");
    expect(h.setUserArchived).not.toHaveBeenCalled();

    setWorld(MGR_A, MGR_A2, MGR_B);
    const allowed = await callArchive({ id: MGR_A2.id, archived: true }, MGR_A.id);
    expect(allowed.status).toBe(200);
    expect(h.setUserArchived).toHaveBeenCalledWith(MGR_A2.id, true);
  });

  it("does not apply the last-manager rule to restore", async () => {
    setWorld(MGR_A, user("mgr-a-old", "admin_manager", null, "2026-01-01T00:00:00.000Z"));

    const res = await callArchive({ id: "mgr-a-old", archived: false }, MGR_A.id);

    expect(res.status).toBe(200);
    expect(h.setUserArchived).toHaveBeenCalledWith("mgr-a-old", false);
  });
});

describe("authentication, capability, and validation are unchanged", () => {
  it("rejects unauthenticated requests on both routes, mutating nothing", async () => {
    const role = await callRole({ id: ADMIN_A.id, role: "coach" });
    const archive = await callArchive({ id: ADMIN_A.id, archived: true });

    expect(role.status).toBe(401);
    expect(archive.status).toBe(401);
    expectNoMutation();
  });

  it("rejects a plain admin (no staffUsers.manage) on both routes with 403, even for a same-gym target", async () => {
    const role = await callRole({ id: COACH_A.id, role: "admin" }, ADMIN_A.id);
    const archive = await callArchive({ id: COACH_A.id, archived: true }, ADMIN_A.id);
    const create = await callRole({ email: "x@x.test", password: "password1", role: "coach" }, ADMIN_A.id);

    expect(role.status).toBe(403);
    expect(archive.status).toBe(403);
    expect(create.status).toBe(403);
    expectNoMutation();
  });

  it("checks the capability before the gym: an unauthorized cross-gym request is 403, not 404", async () => {
    const res = await callRole({ id: ADMIN_B.id, role: "coach" }, ADMIN_A.id);

    expect(res.status).toBe(403);
    expectNoMutation();
  });

  it("preserves request validation on both routes", async () => {
    expect((await callRole(undefined, MGR_A.id, "{not json")).status).toBe(400);
    expect((await callRole({ id: ADMIN_A.id, role: "superuser" }, MGR_A.id)).status).toBe(400);
    expect((await callArchive(undefined, MGR_A.id, "{not json")).status).toBe(400);
    expect((await callArchive({ archived: true }, MGR_A.id)).status).toBe(400);
    expect((await callArchive({ id: ADMIN_A.id, archived: "yes" }, MGR_A.id)).status).toBe(400);
    expectNoMutation();
  });
});
