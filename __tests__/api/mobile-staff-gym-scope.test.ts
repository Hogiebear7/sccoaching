// Route-level cross-gym denial tests for the 10 app/api/mobile/staff/* routes
// that already call sameGym() (lib/gym-scope.ts). These prove each route
// actually WIRES the check correctly, and that list-style routes never leak
// a different gym's records — the existing __tests__/lib/gym-scope.test.ts
// only proves sameGym() itself is correct in isolation. See
// docs/tenant-boundary-audit-2026-09.md §11 for why this slice exists.
//
// Auth uses the real signed-session mechanism (signSession + a session
// cookie, read via verifyRequestSession's cookie fallback — the mobile app's
// actual Bearer-header transport exercises the exact same verifySession()
// call, see lib/mobile-auth.ts). sameGym() and lib/permissions.ts's can()
// are deliberately NOT mocked, since exercising the real authorization logic
// is the entire point of this file.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findTrainingProgramById: vi.fn(),
  saveTrainingProgram: vi.fn(),
  deleteTrainingProgram: vi.fn(),
  findNutritionTargetByUserId: vi.fn(),
  saveNutritionTarget: vi.fn(),
  findMessagesByMemberId: vi.fn(),
  findProfileByUserId: vi.fn(),
  markMemberMessagesReadByStaff: vi.fn(),
  findMessageThreadSummaries: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

// staffCanViewMemberData and the training-programs/staff-members-data helper
// modules are mocked directly rather than satisfied through @/lib/db
// fixtures — those helpers' own correctness (tier resolution, programme-day
// parsing, member-summary aggregation) is unrelated to gym-scope, and the
// sameGym check runs before any of them are ever called on the denial path.
const { mockStaffCanViewMemberData } = vi.hoisted(() => ({ mockStaffCanViewMemberData: vi.fn() }));
vi.mock("@/lib/member-tier-wall", () => ({ staffCanViewMemberData: mockStaffCanViewMemberData }));

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

const { mockGetStaffMembersData, mockGetStaffMemberDetail } = vi.hoisted(() => ({
  mockGetStaffMembersData: vi.fn(),
  mockGetStaffMemberDetail: vi.fn(),
}));
vi.mock("@/lib/staff-members-data", () => ({
  getStaffMembersData: mockGetStaffMembersData,
  getStaffMemberDetail: mockGetStaffMemberDetail,
}));

// gymId: null is the established primary-gym convention (lib/gym-scope.ts,
// lib/profile-schema.ts) — every account created before multi-gym existed
// reads as null, and null-vs-null still compares equal. GYM_A represents
// "the primary gym" via that convention rather than a literal id.
const GYM_A_STAFF = { id: "staff-a", email: "staffa@x.test", role: "admin_manager" as const, gymId: null, archivedAt: null };
const GYM_A_MEMBER = { id: "member-a", email: "membera@x.test", role: "member" as const, gymId: null, archivedAt: null };
const GYM_B_MEMBER = { id: "member-b", email: "memberb@x.test", role: "member" as const, gymId: "gym-b", archivedAt: null };

const auth = signSession({ userId: GYM_A_STAFF.id });

function usersById(...users: { id: string }[]) {
  const map = new Map(users.map((u) => [u.id, u]));
  return (id: string) => map.get(id);
}

async function call(
  routeFile: string,
  method: "POST" | "GET",
  { body, params, query }: { body?: unknown; params?: Record<string, string>; query?: string } = {}
) {
  const mod = await import(`@/app/api/mobile/staff/${routeFile}/route`);
  const url = `http://localhost/api/mobile/staff/${routeFile}${query ? `?${query}` : ""}`;
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
  h.findUserById.mockImplementation(usersById(GYM_A_STAFF, GYM_A_MEMBER, GYM_B_MEMBER));
  mockStaffCanViewMemberData.mockReturnValue(true);
});

describe("GET /api/mobile/staff/programs", () => {
  it("denies a cross-gym ?userId", async () => {
    const res = await call("programs", "GET", { query: `userId=${GYM_B_MEMBER.id}` });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ success: false, message: "Member not found." });
    expect(mockGetStaffTrainingPrograms).not.toHaveBeenCalled();
  });

  it("returns programs for a same-gym ?userId (control)", async () => {
    mockGetStaffTrainingPrograms.mockReturnValue([{ id: "p1", userId: GYM_A_MEMBER.id }]);
    const res = await call("programs", "GET", { query: `userId=${GYM_A_MEMBER.id}` });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data).toEqual([{ id: "p1", userId: GYM_A_MEMBER.id }]);
  });

  it("excludes cross-gym programs from the unfiltered list (no userId)", async () => {
    mockGetStaffTrainingPrograms.mockReturnValue([
      { id: "p-a", userId: GYM_A_MEMBER.id },
      { id: "p-b", userId: GYM_B_MEMBER.id },
    ]);
    const res = await call("programs", "GET");
    expect(res.status).toBe(200);
    const data = await res.json();
    const ids = data.data.map((p: { id: string }) => p.id);
    expect(ids).toContain("p-a");
    expect(ids).not.toContain("p-b");
  });
});

describe("POST /api/mobile/staff/programs/create", () => {
  const body = { userId: "", name: "Programme A", days: [] };

  it("denies a cross-gym member id", async () => {
    const res = await call("programs/create", "POST", { body: { ...body, userId: GYM_B_MEMBER.id } });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ success: false, message: "Member not found." });
    expect(h.saveTrainingProgram).not.toHaveBeenCalled();
  });

  it("reaches saveTrainingProgram for a same-gym member id (control)", async () => {
    // This control verifies that the request passes gym-scope authorization;
    // full business validation is intentionally outside this test's scope.
    mockParseProgramDays.mockReturnValue({ ok: true, days: [] });
    const res = await call("programs/create", "POST", { body: { ...body, userId: GYM_A_MEMBER.id } });
    expect(res.status).not.toBe(404);
    expect(h.saveTrainingProgram).toHaveBeenCalled();
  });
});

describe("POST /api/mobile/staff/programs/update", () => {
  const body = { id: "prog-1", name: "Updated", days: [] };

  it("denies when the program belongs to a cross-gym member", async () => {
    h.findTrainingProgramById.mockReturnValue({ id: "prog-1", userId: GYM_B_MEMBER.id, days: [] });
    const res = await call("programs/update", "POST", { body });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ success: false, message: "Program not found." });
    expect(h.saveTrainingProgram).not.toHaveBeenCalled();
  });

  it("reaches saveTrainingProgram when the program belongs to a same-gym member (control)", async () => {
    // This control verifies that the request passes gym-scope authorization;
    // full business validation is intentionally outside this test's scope.
    h.findTrainingProgramById.mockReturnValue({ id: "prog-1", userId: GYM_A_MEMBER.id, status: "active", days: [] });
    mockParseProgramDays.mockReturnValue({ ok: true, days: [] });
    const res = await call("programs/update", "POST", { body });
    expect(res.status).not.toBe(404);
    expect(h.saveTrainingProgram).toHaveBeenCalled();
  });
});

describe("POST /api/mobile/staff/programs/delete", () => {
  it("denies when the program belongs to a cross-gym member", async () => {
    h.findTrainingProgramById.mockReturnValue({ id: "prog-1", userId: GYM_B_MEMBER.id });
    const res = await call("programs/delete", "POST", { body: { id: "prog-1" } });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ success: false, message: "Program not found." });
    expect(h.deleteTrainingProgram).not.toHaveBeenCalled();
  });

  it("deletes when the program belongs to a same-gym member (control)", async () => {
    h.findTrainingProgramById.mockReturnValue({ id: "prog-1", userId: GYM_A_MEMBER.id });
    const res = await call("programs/delete", "POST", { body: { id: "prog-1" } });
    expect(res.status).toBe(200);
    expect(h.deleteTrainingProgram).toHaveBeenCalledWith("prog-1");
  });
});

describe("GET /api/mobile/staff/nutrition-target", () => {
  it("denies a cross-gym ?userId", async () => {
    const res = await call("nutrition-target", "GET", { query: `userId=${GYM_B_MEMBER.id}` });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ success: false, message: "Member not found." });
    expect(h.findNutritionTargetByUserId).not.toHaveBeenCalled();
  });

  it("returns the target for a same-gym ?userId (control)", async () => {
    h.findNutritionTargetByUserId.mockReturnValue({ userId: GYM_A_MEMBER.id, calories: 2000 });
    const res = await call("nutrition-target", "GET", { query: `userId=${GYM_A_MEMBER.id}` });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.calories).toBe(2000);
  });
});

describe("POST /api/mobile/staff/nutrition-target/update", () => {
  const body = { userId: "", mode: "manual", calories: 2000, proteinG: 150, carbsG: 200, fatG: 60 };

  it("denies a cross-gym member id", async () => {
    const res = await call("nutrition-target/update", "POST", { body: { ...body, userId: GYM_B_MEMBER.id } });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ success: false, message: "Member not found." });
    expect(h.saveNutritionTarget).not.toHaveBeenCalled();
  });

  it("reaches saveNutritionTarget for a same-gym member id (control)", async () => {
    // This control verifies that the request passes gym-scope authorization;
    // full business validation is intentionally outside this test's scope.
    const res = await call("nutrition-target/update", "POST", { body: { ...body, userId: GYM_A_MEMBER.id } });
    expect(res.status).not.toBe(404);
    expect(h.saveNutritionTarget).toHaveBeenCalled();
  });
});

describe("GET /api/mobile/staff/messages/[memberId]", () => {
  it("denies a cross-gym memberId", async () => {
    const res = await call("messages/[memberId]", "GET", { params: { memberId: GYM_B_MEMBER.id } });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ success: false, message: "Member not found." });
    expect(h.markMemberMessagesReadByStaff).not.toHaveBeenCalled();
  });

  it("returns the thread for a same-gym memberId (control)", async () => {
    h.findMessagesByMemberId.mockReturnValue([]);
    h.findProfileByUserId.mockReturnValue({ fullName: "Member A" });
    const res = await call("messages/[memberId]", "GET", { params: { memberId: GYM_A_MEMBER.id } });
    expect(res.status).toBe(200);
    expect(h.markMemberMessagesReadByStaff).toHaveBeenCalledWith(GYM_A_MEMBER.id);
  });
});

describe("GET /api/mobile/staff/messages", () => {
  it("excludes cross-gym threads from the inbox list", async () => {
    h.findMessageThreadSummaries.mockReturnValue([
      { memberId: GYM_A_MEMBER.id, lastMessage: { body: "hi", senderRole: "member", createdAt: "2026-01-01" }, unreadFromMemberCount: 1 },
      { memberId: GYM_B_MEMBER.id, lastMessage: { body: "hi", senderRole: "member", createdAt: "2026-01-01" }, unreadFromMemberCount: 1 },
    ]);
    h.findProfileByUserId.mockReturnValue(null);
    const res = await call("messages", "GET");
    expect(res.status).toBe(200);
    const data = await res.json();
    const ids = data.data.map((s: { memberId: string }) => s.memberId);
    expect(ids).toContain(GYM_A_MEMBER.id);
    expect(ids).not.toContain(GYM_B_MEMBER.id);
  });
});

describe("GET /api/mobile/staff/members", () => {
  it("excludes cross-gym members from the list", async () => {
    mockGetStaffMembersData.mockReturnValue([{ userId: GYM_A_MEMBER.id }, { userId: GYM_B_MEMBER.id }]);
    const res = await call("members", "GET");
    expect(res.status).toBe(200);
    const data = await res.json();
    const ids = data.data.map((m: { userId: string }) => m.userId);
    expect(ids).toContain(GYM_A_MEMBER.id);
    expect(ids).not.toContain(GYM_B_MEMBER.id);
  });
});

describe("GET /api/mobile/staff/members/[userId]", () => {
  it("denies a cross-gym userId", async () => {
    const res = await call("members/[userId]", "GET", { params: { userId: GYM_B_MEMBER.id } });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ success: false, message: "Member not found." });
    expect(mockGetStaffMemberDetail).not.toHaveBeenCalled();
  });

  it("returns detail for a same-gym userId (control)", async () => {
    mockGetStaffMemberDetail.mockReturnValue({ userId: GYM_A_MEMBER.id });
    const res = await call("members/[userId]", "GET", { params: { userId: GYM_A_MEMBER.id } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.userId).toBe(GYM_A_MEMBER.id);
  });
});
