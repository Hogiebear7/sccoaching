// Route-level cross-gym read-isolation test for
// app/api/mobile/community/workouts/[id]/route.ts — the permalink route,
// previously the broadest leak (reachable for any non-private session with
// no follow relationship required at all). A cross-gym workout must be
// reported exactly the same as a genuinely missing one: no distinct status
// code, no message revealing that the resource exists elsewhere.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findWorkoutSessionById: vi.fn(),
  findWorkoutSessionsByUserId: vi.fn(),
  findProfileByUserId: vi.fn(),
  findCommunityPrivacyByUserId: vi.fn(),
  countLikesByWorkoutSessionId: vi.fn(),
  countCommentsByWorkoutSessionId: vi.fn(),
  hasLikedWorkoutSession: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

const GYM_A_CALLER = { id: "caller-a", email: "caller@x.test", role: "member" as const, gymId: null };
const GYM_A_OWNER = { id: "owner-a", email: "ownera@x.test", role: "member" as const, gymId: null };
const GYM_B_OWNER = { id: "owner-b", email: "ownerb@x.test", role: "member" as const, gymId: "gym-b" };

function makeSession(userId: string, overrides: Partial<{ isPrivate: boolean }> = {}) {
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

async function get(id: string, sessionUserId: string = GYM_A_CALLER.id) {
  const mod = await import("@/app/api/mobile/community/workouts/[id]/route");
  const token = signSession({ userId: sessionUserId }, MEMBER_SESSION_LIFETIME_MS);
  const req = new NextRequest(`http://localhost/api/mobile/community/workouts/${id}`, {
    headers: { Cookie: `session=${token}` },
  });
  return mod.GET(req, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) =>
    [GYM_A_CALLER, GYM_A_OWNER, GYM_B_OWNER].find((u) => u.id === id)
  );
  h.findWorkoutSessionsByUserId.mockReturnValue([]);
  h.findProfileByUserId.mockReturnValue({ fullName: "Test Member" });
  h.findCommunityPrivacyByUserId.mockReturnValue(undefined);
  h.countLikesByWorkoutSessionId.mockReturnValue(0);
  h.countCommentsByWorkoutSessionId.mockReturnValue(0);
  h.hasLikedWorkoutSession.mockReturnValue(false);
});

describe("GET /api/mobile/community/workouts/[id]", () => {
  it("returns a same-gym workout", async () => {
    h.findWorkoutSessionById.mockReturnValue(makeSession(GYM_A_OWNER.id));

    const res = await get("session-1");
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data.item.userId).toBe(GYM_A_OWNER.id);
  });

  it("returns the same not-found response for a cross-gym workout as for a genuinely missing one", async () => {
    h.findWorkoutSessionById.mockReturnValue(makeSession(GYM_B_OWNER.id));
    const crossGymRes = await get("session-1");
    const crossGymData = await crossGymRes.json();

    h.findWorkoutSessionById.mockReturnValue(undefined);
    const missingRes = await get("does-not-exist");
    const missingData = await missingRes.json();

    expect(crossGymRes.status).toBe(missingRes.status);
    expect(crossGymData).toEqual(missingData);
    expect(crossGymRes.status).toBe(404);
    expect(crossGymData.message).toBe("Workout not found.");
  });

  it("does not expose any owner/workout detail for a cross-gym workout", async () => {
    h.findWorkoutSessionById.mockReturnValue(makeSession(GYM_B_OWNER.id));

    const res = await get("session-1");
    const data = await res.json();

    expect(data.data).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain(GYM_B_OWNER.id);
  });

  it("lets a member view their own session regardless of privacy or gym", async () => {
    h.findWorkoutSessionById.mockReturnValue(makeSession(GYM_A_CALLER.id, { isPrivate: true }));

    const res = await get("session-1", GYM_A_CALLER.id);

    expect(res.status).toBe(200);
  });

  it("preserves existing private-session behavior for a same-gym non-owner", async () => {
    h.findWorkoutSessionById.mockReturnValue(makeSession(GYM_A_OWNER.id, { isPrivate: true }));

    const res = await get("session-1");
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.message).toBe("Workout not found.");
  });

  it("rejects an unauthenticated request", async () => {
    const mod = await import("@/app/api/mobile/community/workouts/[id]/route");
    const req = new NextRequest("http://localhost/api/mobile/community/workouts/session-1");
    const res = await mod.GET(req, { params: Promise.resolve({ id: "session-1" }) });
    expect(res.status).toBe(401);
  });
});
