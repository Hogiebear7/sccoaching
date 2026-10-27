// Nutrition targets v2, slice B (docs/nutrition-targets-v2-plan-2026-10.md):
//   * POST /api/mobile/nutrition/diary/day-status   (self-owned)
//   * GET/POST /api/mobile/nutrition/preferences    (self-owned, coach lock)
//   * POST /api/mobile/staff/nutrition-target/update (distribution + lock,
//     gym-scoped, distribution-only updates keep mode and numbers)
//   * POST /api/mobile/nutrition/target/member-override keeps the coach lock
//
// Real signed sessions and the real can() / sameGym() / verifyRequestSession;
// only the datastore and the tier wall are mocked. Tenant A = primary gym
// (gymId: null convention); tenant B is a separate gym.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findProfileByUserId: vi.fn(),
  saveProfile: vi.fn(),
  findNutritionTargetByUserId: vi.fn(),
  saveNutritionTarget: vi.fn(),
  setNutritionDayStatus: vi.fn(),
  findNutritionDayStatusesByUserId: vi.fn(),
  findFoodEntriesByUserId: vi.fn(),
  findBodyWeightLogsByUserId: vi.fn(),
}));
vi.mock("@/lib/db", () => h);
// Plan gates are covered by __tests__/api/entitlement-server-enforcement.test.ts; this file is about what the route does once past them.
vi.mock("@/lib/member-access-response", () => ({ requireFeature: () => null, requireUnderFreeLimit: () => null }));

const { mockStaffCanViewMemberData } = vi.hoisted(() => ({ mockStaffCanViewMemberData: vi.fn() }));
vi.mock("@/lib/member-tier-wall", () => ({ staffCanViewMemberData: mockStaffCanViewMemberData }));

type U = { id: string; email: string; role: string; gymId: string | null; archivedAt: string | null };
const user = (id: string, role: string, gymId: string | null): U => ({ id, email: `${id}@x.test`, role, gymId, archivedAt: null });

const A_COACH = user("coach-a", "coach", null);
const A_MEMBER = user("member-a", "member", null);
const A_OTHER_MEMBER = user("member-a2", "member", null);
const B_MEMBER = user("member-b", "member", "gym-b");
const WORLD = [A_COACH, A_MEMBER, A_OTHER_MEMBER, B_MEMBER];

const cookie = (id: string) => `session=${signSession({ userId: id }, MEMBER_SESSION_LIFETIME_MS)}`;
const headers = (as?: string) => ({ "Content-Type": "application/json", ...(as ? { Cookie: cookie(as) } : {}) });
const get = (path: string, as?: string) => new NextRequest(`http://localhost${path}`, { headers: headers(as) });
const post = (path: string, body: unknown, as?: string) =>
  new NextRequest(`http://localhost${path}`, { method: "POST", headers: headers(as), body: JSON.stringify(body) });

const PROFILE = { userId: A_MEMBER.id, primaryGoal: "Weight Loss", calorieDistribution: null, goalPacePctPerWeek: null };

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => WORLD.find((u) => u.id === id));
  h.findProfileByUserId.mockImplementation((id: string) => (id === A_MEMBER.id ? { ...PROFILE } : undefined));
  h.findNutritionTargetByUserId.mockReturnValue(undefined);
  h.setNutritionDayStatus.mockImplementation((_u: string, _d: string, status: string | null) => (status ? { status } : null));
  mockStaffCanViewMemberData.mockReturnValue(true);
});

describe("POST /api/mobile/nutrition/diary/day-status", () => {
  const call = async (body: unknown, as?: string) => {
    const { POST } = await import("@/app/api/mobile/nutrition/diary/day-status/route");
    return POST(post("/api/mobile/nutrition/diary/day-status", body, as));
  };

  it("requires a session", async () => {
    expect((await call({ date: "2026-10-20", status: "complete" })).status).toBe(401);
    expect(h.setNutritionDayStatus).not.toHaveBeenCalled();
  });

  it("marks the session user's own day, ignoring any userId in the body", async () => {
    const res = await call({ date: "2026-10-20", status: "complete", userId: A_OTHER_MEMBER.id }, A_MEMBER.id);
    expect(res.status).toBe(200);
    expect(h.setNutritionDayStatus).toHaveBeenCalledWith(A_MEMBER.id, "2026-10-20", "complete");
    expect((await res.json()).data).toEqual({ date: "2026-10-20", status: "complete" });
  });

  it("clears a mark with status null", async () => {
    const res = await call({ date: "2026-10-20", status: null }, A_MEMBER.id);
    expect(res.status).toBe(200);
    expect(h.setNutritionDayStatus).toHaveBeenCalledWith(A_MEMBER.id, "2026-10-20", null);
  });

  it("rejects bad dates, future days and unknown statuses", async () => {
    expect((await call({ date: "20-10-2026", status: "complete" }, A_MEMBER.id)).status).toBe(400);
    expect((await call({ date: "2999-01-01", status: "complete" }, A_MEMBER.id)).status).toBe(400);
    expect((await call({ date: "2026-10-20", status: "done" }, A_MEMBER.id)).status).toBe(400);
    expect(h.setNutritionDayStatus).not.toHaveBeenCalled();
  });
});

describe("GET /api/mobile/nutrition/diary returns the day's mark", () => {
  it("includes dayStatus for the requested date only", async () => {
    h.findFoodEntriesByUserId.mockReturnValue([]);
    h.findNutritionDayStatusesByUserId.mockReturnValue([
      { userId: A_MEMBER.id, date: "2026-10-19", status: "incomplete" },
      { userId: A_MEMBER.id, date: "2026-10-20", status: "complete" },
    ]);
    const { GET } = await import("@/app/api/mobile/nutrition/diary/route");
    const res = await GET(get("/api/mobile/nutrition/diary?date=2026-10-20", A_MEMBER.id));
    expect((await res.json()).data.dayStatus).toBe("complete");
    expect(h.findNutritionDayStatusesByUserId).toHaveBeenCalledWith(A_MEMBER.id);
  });
});

describe("/api/mobile/nutrition/preferences", () => {
  const save = async (body: unknown, as?: string) => {
    const { POST } = await import("@/app/api/mobile/nutrition/preferences/route");
    return POST(post("/api/mobile/nutrition/preferences", body, as));
  };

  it("requires a session", async () => {
    expect((await save({ calorieDistribution: "training" })).status).toBe(401);
  });

  it("saves the member's distribution and pace on their own profile", async () => {
    const res = await save({ calorieDistribution: "training", goalPacePctPerWeek: -0.75 }, A_MEMBER.id);
    expect(res.status).toBe(200);
    expect(h.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ userId: A_MEMBER.id, calorieDistribution: "training", goalPacePctPerWeek: -0.75 })
    );
  });

  it("leaves fields that weren't sent alone", async () => {
    h.findProfileByUserId.mockReturnValue({ ...PROFILE, calorieDistribution: "even", goalPacePctPerWeek: -0.25 });
    await save({ goalPacePctPerWeek: -0.5 }, A_MEMBER.id);
    expect(h.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ calorieDistribution: "even", goalPacePctPerWeek: -0.5 }));
  });

  it("saves an activity level and rejects unknown ones", async () => {
    expect((await save({ activityLevel: "athlete" }, A_MEMBER.id)).status).toBe(400);
    expect(h.saveProfile).not.toHaveBeenCalled();
    expect((await save({ activityLevel: "light" }, A_MEMBER.id)).status).toBe(200);
    expect(h.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ activityLevel: "light" }));
  });

  it("rejects paces that aren't offered and unknown distributions", async () => {
    expect((await save({ goalPacePctPerWeek: -3 }, A_MEMBER.id)).status).toBe(400);
    expect((await save({ goalPacePctPerWeek: -0.6 }, A_MEMBER.id)).status).toBe(400);
    expect((await save({ calorieDistribution: "carb-cycle" }, A_MEMBER.id)).status).toBe(400);
    expect(h.saveProfile).not.toHaveBeenCalled();
  });

  it("refuses a distribution change while the coach lock is on, but still allows pace", async () => {
    h.findNutritionTargetByUserId.mockReturnValue({ distribution: "training", distributionLocked: true });
    expect((await save({ calorieDistribution: "even" }, A_MEMBER.id)).status).toBe(403);
    expect(h.saveProfile).not.toHaveBeenCalled();
    expect((await save({ goalPacePctPerWeek: -0.25 }, A_MEMBER.id)).status).toBe(200);
  });

  it("GET reports the lock and coach default", async () => {
    h.findNutritionTargetByUserId.mockReturnValue({ distribution: "training", distributionLocked: true });
    const { GET } = await import("@/app/api/mobile/nutrition/preferences/route");
    const res = await GET(get("/api/mobile/nutrition/preferences", A_MEMBER.id));
    expect((await res.json()).data).toEqual({
      calorieDistribution: null,
      goalPacePctPerWeek: null,
      activityLevel: null,
      coachDistribution: "training",
      distributionLocked: true,
    });
  });
});

describe("POST /api/mobile/staff/nutrition-target/update — distribution and lock", () => {
  const call = async (body: unknown, as?: string) => {
    const { POST } = await import("@/app/api/mobile/staff/nutrition-target/update/route");
    return POST(post("/api/mobile/staff/nutrition-target/update", body, as));
  };

  it("cross-gym member: 404, nothing read or written", async () => {
    const res = await call({ userId: B_MEMBER.id, distribution: "training", distributionLocked: true }, A_COACH.id);
    expect(res.status).toBe(404);
    expect(h.findNutritionTargetByUserId).not.toHaveBeenCalled();
    expect(h.saveNutritionTarget).not.toHaveBeenCalled();
  });

  it("a member can't use the staff route to lock their own distribution", async () => {
    const res = await call({ userId: A_MEMBER.id, distribution: "even", distributionLocked: true }, A_MEMBER.id);
    expect(res.status).toBe(403);
    expect(h.saveNutritionTarget).not.toHaveBeenCalled();
  });

  it("a distribution-only update keeps the member's mode and numbers", async () => {
    h.findNutritionTargetByUserId.mockReturnValue({
      id: "t1",
      userId: A_MEMBER.id,
      mode: "auto",
      calories: null,
      proteinG: null,
      carbsG: null,
      fatG: null,
      setByStaffId: "someone",
      notes: "keep me",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const res = await call({ userId: A_MEMBER.id, distribution: "training", distributionLocked: true }, A_COACH.id);
    expect(res.status).toBe(200);
    expect(h.saveNutritionTarget).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "auto", notes: "keep me", setByStaffId: "someone", distribution: "training", distributionLocked: true })
    );
  });

  it("a distribution-only update for a member with no record starts in auto, not manual", async () => {
    await call({ userId: A_MEMBER.id, distribution: "even" }, A_COACH.id);
    expect(h.saveNutritionTarget).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "auto", distribution: "even", distributionLocked: false })
    );
  });

  it("a normal target save keeps an existing lock", async () => {
    h.findNutritionTargetByUserId.mockReturnValue({ id: "t1", userId: A_MEMBER.id, mode: "auto", distribution: "training", distributionLocked: true });
    await call({ userId: A_MEMBER.id, mode: "disabled" }, A_COACH.id);
    expect(h.saveNutritionTarget).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "disabled", distribution: "training", distributionLocked: true })
    );
  });

  it("rejects bad values and locking with no distribution", async () => {
    expect((await call({ userId: A_MEMBER.id, distribution: "weird" }, A_COACH.id)).status).toBe(400);
    expect((await call({ userId: A_MEMBER.id, distributionLocked: "yes" }, A_COACH.id)).status).toBe(400);
    expect((await call({ userId: A_MEMBER.id, distributionLocked: true }, A_COACH.id)).status).toBe(400);
    expect(h.saveNutritionTarget).not.toHaveBeenCalled();
  });
});

describe("POST /api/mobile/nutrition/target/member-override keeps the coach's distribution", () => {
  it("an applied AI-coach target doesn't wipe the lock", async () => {
    h.findProfileByUserId.mockReturnValue({ ...PROFILE, currentWeightKg: 70 });
    h.findBodyWeightLogsByUserId.mockReturnValue([]);
    h.findNutritionTargetByUserId.mockReturnValue({ id: "t1", userId: A_MEMBER.id, mode: "auto", distribution: "training", distributionLocked: true });
    const { POST } = await import("@/app/api/mobile/nutrition/target/member-override/route");
    const res = await POST(
      post("/api/mobile/nutrition/target/member-override", { calories: 2200, proteinG: 150, carbsG: 250, fatG: 66 }, A_MEMBER.id)
    );
    expect(res.status).toBe(200);
    expect(h.saveNutritionTarget).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "manual", calories: 2200, distribution: "training", distributionLocked: true })
    );
  });
});
