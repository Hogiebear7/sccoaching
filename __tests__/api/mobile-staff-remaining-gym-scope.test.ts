// Regression coverage for mobile-staff routes that had no dedicated test file
// (Phase 3 gap: the code was already correctly scoped, but nothing locked it
// in). Characterizes existing behaviour only — no route was changed.
//   * GET  /api/mobile/staff/members             (gym-scoped list)
//   * GET  /api/mobile/staff/members/[userId]    (gym-scoped detail)
//   * GET  /api/mobile/staff/nutrition-target    (gym-scoped)
//   * GET  /api/mobile/staff/programs            (gym-scoped list/detail)
//   * POST /api/mobile/staff/programs/create     (gym-scoped)
//   * POST /api/mobile/staff/programs/delete     (gym-scoped)
//   * POST /api/mobile/staff/programs/update     (gym-scoped)
//   * GET  /api/mobile/staff/class-categories    (platform-global BY DESIGN —
//     class categories carry no gym field; documented, not a bug)
//   * GET  /api/mobile/staff/nutrition/moderation
//   * GET  /api/mobile/staff/nutrition/submissions
//     (both platform-global BY DESIGN — the shared food catalog; already
//     flagged in docs/tenant-boundary-audit-2026-09.md §12.2/§12.6 as an open
//     product decision, not implemented here. These two tests exist only so a
//     future accidental change is caught as a diff, not silently shipped.)
//
// Real signed sessions and the real can() / sameGym() / verifyRequestSession;
// only the datastore and lib/training-programs / lib/staff-members-data are
// mocked. Synthetic fixtures. Tenant A = primary gym (gymId: null convention);
// Tenant B is a separate gym.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findNutritionTargetByUserId: vi.fn(),
  findTrainingProgramById: vi.fn(),
  saveTrainingProgram: vi.fn(),
  deleteTrainingProgram: vi.fn(),
  findClassCategories: vi.fn(),
  findAllFoodModerationRequests: vi.fn(),
  findAllFoodSubmissions: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

const { mockStaffCanViewMemberData } = vi.hoisted(() => ({ mockStaffCanViewMemberData: vi.fn() }));
vi.mock("@/lib/member-tier-wall", () => ({ staffCanViewMemberData: mockStaffCanViewMemberData }));

const { mockGetStaffMembersData, mockGetStaffMemberDetail } = vi.hoisted(() => ({
  mockGetStaffMembersData: vi.fn(),
  mockGetStaffMemberDetail: vi.fn(),
}));
vi.mock("@/lib/staff-members-data", () => ({ getStaffMembersData: mockGetStaffMembersData, getStaffMemberDetail: mockGetStaffMemberDetail }));

const { mockGetStaffTrainingPrograms, mockArchiveOtherActivePrograms, mockParseProgramDays } = vi.hoisted(() => ({
  mockGetStaffTrainingPrograms: vi.fn(),
  mockArchiveOtherActivePrograms: vi.fn(),
  mockParseProgramDays: vi.fn(),
}));
vi.mock("@/lib/training-programs", () => ({
  getStaffTrainingPrograms: mockGetStaffTrainingPrograms,
  archiveOtherActivePrograms: mockArchiveOtherActivePrograms,
  parseProgramDays: mockParseProgramDays,
}));

type U = { id: string; email: string; role: string; gymId: string | null; archivedAt: string | null };
const user = (id: string, role: string, gymId: string | null): U => ({ id, email: `${id}@x.test`, role, gymId, archivedAt: null });

const A_COACH = user("coach-a", "coach", null);
const A_ADMIN = user("admin-a", "admin", null); // foodCatalog.manage is admin+, not coach
const A_MEMBER = user("member-a", "member", null);
const B_MEMBER = user("member-b", "member", "gym-b");
const A_PLAIN_MEMBER = user("plain-a", "member", null);
const WORLD = [A_COACH, A_ADMIN, A_MEMBER, B_MEMBER, A_PLAIN_MEMBER];

const cookie = (id: string) => `session=${signSession({ userId: id }, MEMBER_SESSION_LIFETIME_MS)}`;
const headers = (as?: string) => ({ "Content-Type": "application/json", ...(as ? { Cookie: cookie(as) } : {}) });
const get = (path: string, as?: string) => new NextRequest(`http://localhost${path}`, { headers: headers(as) });
const post = (path: string, body: unknown, as?: string) =>
  new NextRequest(`http://localhost${path}`, { method: "POST", headers: headers(as), body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => WORLD.find((u) => u.id === id));
  mockStaffCanViewMemberData.mockReturnValue(true);
  mockParseProgramDays.mockReturnValue({ ok: true, days: [] });
});

describe("GET /api/mobile/staff/members — gym-scoped list", () => {
  it("only same-gym members reach the response, even if getStaffMembersData returned a cross-gym row", async () => {
    mockGetStaffMembersData.mockReturnValue([{ userId: A_MEMBER.id }, { userId: B_MEMBER.id }]);
    const { GET } = await import("@/app/api/mobile/staff/members/route");

    const res = await GET(get("/api/mobile/staff/members", A_COACH.id));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.map((m: { userId: string }) => m.userId)).toEqual([A_MEMBER.id]);
  });

  it("wrong role -> 403; no session -> 401", async () => {
    const { GET } = await import("@/app/api/mobile/staff/members/route");

    expect((await GET(get("/api/mobile/staff/members", A_PLAIN_MEMBER.id))).status).toBe(403);
    expect((await GET(get("/api/mobile/staff/members"))).status).toBe(401);
  });
});

describe("GET /api/mobile/staff/members/[userId] — gym-scoped detail", () => {
  const call = async (userId: string, as?: string) => {
    const { GET } = await import("@/app/api/mobile/staff/members/[userId]/route");
    return GET(get(`/api/mobile/staff/members/${userId}`, as), { params: Promise.resolve({ userId }) });
  };

  it("same-gym member: returns detail", async () => {
    mockGetStaffMemberDetail.mockReturnValue({ userId: A_MEMBER.id });

    const res = await call(A_MEMBER.id, A_COACH.id);

    expect(res.status).toBe(200);
    expect(mockGetStaffMemberDetail).toHaveBeenCalledWith(A_MEMBER.id);
  });

  it("cross-gym member: 404 'Member not found.', detail never fetched", async () => {
    const res = await call(B_MEMBER.id, A_COACH.id);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, message: "Member not found." });
    expect(mockGetStaffMemberDetail).not.toHaveBeenCalled();
  });

  it("a same-gym member without the Membership tier is walled before detail is fetched", async () => {
    mockStaffCanViewMemberData.mockReturnValue(false);

    const res = await call(A_MEMBER.id, A_COACH.id);

    expect(res.status).toBe(403);
    expect(mockGetStaffMemberDetail).not.toHaveBeenCalled();
  });
});

describe("GET /api/mobile/staff/nutrition-target — gym-scoped", () => {
  const call = async (userId: string, as?: string) => {
    const { GET } = await import("@/app/api/mobile/staff/nutrition-target/route");
    return GET(get(`/api/mobile/staff/nutrition-target?userId=${userId}`, as));
  };

  it("same-gym member: returns the target", async () => {
    h.findNutritionTargetByUserId.mockReturnValue({ calories: 2000 });
    const res = await call(A_MEMBER.id, A_COACH.id);

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ calories: 2000 });
  });

  it("cross-gym member: 404, target never read", async () => {
    const res = await call(B_MEMBER.id, A_COACH.id);

    expect(res.status).toBe(404);
    expect(h.findNutritionTargetByUserId).not.toHaveBeenCalled();
  });
});

describe("GET /api/mobile/staff/programs — gym-scoped list and per-member detail", () => {
  it("no userId: filters the returned programs to same-gym, tier-eligible members", async () => {
    mockGetStaffTrainingPrograms.mockReturnValue([{ userId: A_MEMBER.id }, { userId: B_MEMBER.id }]);
    const { GET } = await import("@/app/api/mobile/staff/programs/route");

    const res = await GET(get("/api/mobile/staff/programs", A_COACH.id));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.map((p: { userId: string }) => p.userId)).toEqual([A_MEMBER.id]);
  });

  it("a userId for a cross-gym member: 404 before any program lookup", async () => {
    const { GET } = await import("@/app/api/mobile/staff/programs/route");

    const res = await GET(get(`/api/mobile/staff/programs?userId=${B_MEMBER.id}`, A_COACH.id));

    expect(res.status).toBe(404);
    expect(mockGetStaffTrainingPrograms).not.toHaveBeenCalled();
  });
});

describe("POST /api/mobile/staff/programs/create — gym-scoped", () => {
  const call = async (userId: string, as?: string) => {
    const { POST } = await import("@/app/api/mobile/staff/programs/create/route");
    return POST(post("/api/mobile/staff/programs/create", { userId, name: "Block A", days: [] }, as));
  };

  it("same-gym member: creates the program", async () => {
    const res = await call(A_MEMBER.id, A_COACH.id);

    expect(res.status).toBe(200);
    expect(h.saveTrainingProgram).toHaveBeenCalledTimes(1);
  });

  it("cross-gym member: 404, nothing saved", async () => {
    const res = await call(B_MEMBER.id, A_COACH.id);

    expect(res.status).toBe(404);
    expect(h.saveTrainingProgram).not.toHaveBeenCalled();
  });
});

describe("POST /api/mobile/staff/programs/delete and /update — gym-scoped via the program's owner", () => {
  it("delete: a cross-gym program's owner blocks the delete with 404", async () => {
    h.findTrainingProgramById.mockReturnValue({ id: "prog-1", userId: B_MEMBER.id });
    const { POST } = await import("@/app/api/mobile/staff/programs/delete/route");

    const res = await POST(post("/api/mobile/staff/programs/delete", { id: "prog-1" }, A_COACH.id));

    expect(res.status).toBe(404);
    expect(h.deleteTrainingProgram).not.toHaveBeenCalled();
  });

  it("delete: a same-gym program's owner allows the delete", async () => {
    h.findTrainingProgramById.mockReturnValue({ id: "prog-1", userId: A_MEMBER.id });
    const { POST } = await import("@/app/api/mobile/staff/programs/delete/route");

    const res = await POST(post("/api/mobile/staff/programs/delete", { id: "prog-1" }, A_COACH.id));

    expect(res.status).toBe(200);
    expect(h.deleteTrainingProgram).toHaveBeenCalledWith("prog-1");
  });

  it("update: a cross-gym program's owner blocks the update with 404", async () => {
    h.findTrainingProgramById.mockReturnValue({ id: "prog-1", userId: B_MEMBER.id, days: [] });
    const { POST } = await import("@/app/api/mobile/staff/programs/update/route");

    const res = await POST(post("/api/mobile/staff/programs/update", { id: "prog-1", name: "Renamed", days: [] }, A_COACH.id));

    expect(res.status).toBe(404);
    expect(h.saveTrainingProgram).not.toHaveBeenCalled();
  });
});

describe("GET /api/mobile/staff/class-categories — platform-global by design", () => {
  it("returns the full shared category list (no gym field exists on categories)", async () => {
    h.findClassCategories.mockReturnValue([{ slug: "strength", name: "Strength" }]);
    const { GET } = await import("@/app/api/mobile/staff/class-categories/route");

    const res = await GET(get("/api/mobile/staff/class-categories", A_COACH.id));

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([{ slug: "strength", name: "Strength" }]);
  });

  it("still requires the classes.manage capability", async () => {
    const { GET } = await import("@/app/api/mobile/staff/class-categories/route");

    expect((await GET(get("/api/mobile/staff/class-categories", A_PLAIN_MEMBER.id))).status).toBe(403);
  });
});

describe("nutrition moderation / submissions — platform-global BY DESIGN (documented open item, not fixed here)", () => {
  it("moderation list is not gym-filtered: any gym's foodCatalog.manage staff sees every gym's reports", async () => {
    h.findAllFoodModerationRequests.mockReturnValue([{ id: "m1" }, { id: "m2" }]);
    const { GET } = await import("@/app/api/mobile/staff/nutrition/moderation/route");

    const res = await GET(get("/api/mobile/staff/nutrition/moderation", A_ADMIN.id));

    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveLength(2); // unfiltered — see docs/tenant-boundary-audit-2026-09.md §12.6
  });

  it("submissions list is not gym-filtered: same platform-global design", async () => {
    h.findAllFoodSubmissions.mockReturnValue([{ id: "s1" }, { id: "s2" }]);
    const { GET } = await import("@/app/api/mobile/staff/nutrition/submissions/route");

    const res = await GET(get("/api/mobile/staff/nutrition/submissions", A_ADMIN.id));

    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveLength(2);
  });
});
