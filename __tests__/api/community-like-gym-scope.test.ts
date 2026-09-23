// Cross-gym isolation test for
// app/api/mobile/community/workouts/[id]/like/route.ts. Like/unlike share
// a single toggle endpoint, so both are covered by the same gate: a
// cross-gym session is folded into the existing not-found/private 404, and
// the toggle call underneath never runs on denial.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findWorkoutSessionById: vi.fn(),
  toggleWorkoutLike: vi.fn(),
  findCommunityPrivacyByUserId: vi.fn(),
  findProfileByUserId: vi.fn(),
  createNotification: vi.fn(),
}));
vi.mock("@/lib/db", () => h);
vi.mock("@/lib/push", () => ({ sendPush: vi.fn().mockResolvedValue(undefined) }));

const GYM_A_CALLER = { id: "caller-a", email: "caller@x.test", role: "member" as const, gymId: null };
const GYM_A_OWNER = { id: "owner-a", email: "ownera@x.test", role: "member" as const, gymId: null };
const GYM_B_OWNER = { id: "owner-b", email: "ownerb@x.test", role: "member" as const, gymId: "gym-b" };

function session(userId: string, overrides: Partial<{ isPrivate: boolean }> = {}) {
  return {
    id: "session-1",
    userId,
    date: "2026-01-01",
    title: "Full Body",
    exercises: [{ name: "Back Squat" }],
    runs: [],
    isPrivate: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function post(id: string, sessionUserId: string = GYM_A_CALLER.id) {
  const mod = await import("@/app/api/mobile/community/workouts/[id]/like/route");
  const token = signSession({ userId: sessionUserId }, MEMBER_SESSION_LIFETIME_MS);
  const req = new NextRequest(`http://localhost/api/mobile/community/workouts/${id}/like`, {
    method: "POST",
    headers: { Cookie: `session=${token}` },
  });
  return mod.POST(req, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) =>
    [GYM_A_CALLER, GYM_A_OWNER, GYM_B_OWNER].find((u) => u.id === id)
  );
  h.toggleWorkoutLike.mockReturnValue(true);
  h.findCommunityPrivacyByUserId.mockReturnValue(undefined);
  h.findProfileByUserId.mockReturnValue({ fullName: "Test Member" });
});

describe("POST /api/mobile/community/workouts/[id]/like", () => {
  it("likes a same-gym session", async () => {
    h.findWorkoutSessionById.mockReturnValue(session(GYM_A_OWNER.id));

    const res = await post("session-1");
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data.liked).toBe(true);
    expect(h.toggleWorkoutLike).toHaveBeenCalledWith(GYM_A_CALLER.id, "session-1");
  });

  it("unlikes a same-gym session (toggle off)", async () => {
    h.findWorkoutSessionById.mockReturnValue(session(GYM_A_OWNER.id));
    h.toggleWorkoutLike.mockReturnValue(false);

    const res = await post("session-1");
    const data = await res.json();

    expect(data.data.liked).toBe(false);
    expect(h.toggleWorkoutLike).toHaveBeenCalledWith(GYM_A_CALLER.id, "session-1");
  });

  it("rejects a cross-gym session using the existing not-found response", async () => {
    h.findWorkoutSessionById.mockReturnValue(session(GYM_B_OWNER.id));
    const crossGymRes = await post("session-1");
    const crossGymData = await crossGymRes.json();

    h.findWorkoutSessionById.mockReturnValue(undefined);
    const missingRes = await post("does-not-exist");
    const missingData = await missingRes.json();

    expect(crossGymRes.status).toBe(missingRes.status);
    expect(crossGymData).toEqual(missingData);
    expect(crossGymRes.status).toBe(404);
  });

  it("does not touch a LikeRecord for a cross-gym session (like)", async () => {
    h.findWorkoutSessionById.mockReturnValue(session(GYM_B_OWNER.id));
    await post("session-1");
    expect(h.toggleWorkoutLike).not.toHaveBeenCalled();
  });

  it("does not touch a LikeRecord for a cross-gym session (unlike attempt)", async () => {
    h.findWorkoutSessionById.mockReturnValue(session(GYM_B_OWNER.id));
    h.toggleWorkoutLike.mockReturnValue(false);
    await post("session-1");
    expect(h.toggleWorkoutLike).not.toHaveBeenCalled();
  });

  it("preserves existing private-session behavior for a same-gym non-owner", async () => {
    h.findWorkoutSessionById.mockReturnValue(session(GYM_A_OWNER.id, { isPrivate: true }));

    const res = await post("session-1");
    expect(res.status).toBe(404);
    expect(h.toggleWorkoutLike).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    const mod = await import("@/app/api/mobile/community/workouts/[id]/like/route");
    const req = new NextRequest("http://localhost/api/mobile/community/workouts/session-1/like", {
      method: "POST",
    });
    const res = await mod.POST(req, { params: Promise.resolve({ id: "session-1" }) });
    expect(res.status).toBe(401);
  });
});
