// Route-level cross-gym read-isolation test for
// app/api/mobile/community/highlight/route.ts. Two independent gym checks
// live in this route: the followed-member win branch (same pattern as
// feed/wins) and the leaderboard-fallback branch (same pattern as the
// dedicated leaderboard route) — both covered here.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findFollowingIds: vi.fn(),
  findWorkoutSessionsByUserId: vi.fn(),
  findProfileByUserId: vi.fn(),
  findCommunityPrivacyByUserId: vi.fn(),
  findCommunityEligibleUsers: vi.fn(),
  findBodyWeightLogsByUserId: vi.fn(),
}));
vi.mock("@/lib/db", () => h);
vi.mock("@/lib/body-weight", () => ({ resolveCurrentWeightKg: vi.fn(() => null) }));

const GYM_A_CALLER = { id: "caller-a", email: "caller@x.test", role: "member" as const, gymId: null, archivedAt: null };
const GYM_A_FOLLOWED = { id: "followed-a", email: "followeda@x.test", role: "member" as const, gymId: null, archivedAt: null };
const GYM_B_FOLLOWED = { id: "followed-b", email: "followedb@x.test", role: "member" as const, gymId: "gym-b", archivedAt: null };

function pbSession(userId: string) {
  return {
    id: `session-${userId}`,
    userId,
    date: new Date().toISOString().slice(0, 10),
    title: "Leg Day",
    exercises: [{ name: "Back Squat", weight: "100 kg", reps: 5, sets: 1 }],
    runs: [],
    isPrivate: false,
    createdAt: new Date().toISOString(),
  };
}

async function get() {
  const mod = await import("@/app/api/mobile/community/highlight/route");
  const token = signSession({ userId: GYM_A_CALLER.id }, MEMBER_SESSION_LIFETIME_MS);
  const req = new NextRequest("http://localhost/api/mobile/community/highlight", {
    headers: { Cookie: `session=${token}` },
  });
  return mod.GET(req);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) =>
    [GYM_A_CALLER, GYM_A_FOLLOWED, GYM_B_FOLLOWED].find((u) => u.id === id)
  );
  h.findProfileByUserId.mockReturnValue({ fullName: "Test Member" });
  h.findCommunityPrivacyByUserId.mockReturnValue(undefined);
  h.findBodyWeightLogsByUserId.mockReturnValue([]);
  h.findCommunityEligibleUsers.mockReturnValue([]);
});

describe("GET /api/mobile/community/highlight — win branch", () => {
  it("surfaces a same-gym followed member's win", async () => {
    h.findFollowingIds.mockReturnValue([GYM_A_FOLLOWED.id]);
    h.findWorkoutSessionsByUserId.mockImplementation((id: string) =>
      id === GYM_A_FOLLOWED.id ? [pbSession(id)] : []
    );

    const res = await get();
    const data = await res.json();

    expect(data.data.type).toBe("win");
  });

  it("never surfaces a cross-gym followed member's win, even though the follow itself exists", async () => {
    h.findFollowingIds.mockReturnValue([GYM_B_FOLLOWED.id]);
    h.findWorkoutSessionsByUserId.mockImplementation((id: string) =>
      id === GYM_B_FOLLOWED.id ? [pbSession(id)] : []
    );

    const res = await get();
    const data = await res.json();

    expect(data.data.type).not.toBe("win");
    expect(h.findFollowingIds).toHaveBeenCalledWith(GYM_A_CALLER.id);
  });
});

describe("GET /api/mobile/community/highlight — leaderboard fallback branch", () => {
  beforeEach(() => {
    h.findFollowingIds.mockReturnValue([]); // no wins to find -> falls through to leaderboard
  });

  it("ranks the caller against same-gym members only", async () => {
    h.findCommunityEligibleUsers.mockReturnValue([GYM_A_CALLER, GYM_A_FOLLOWED, GYM_B_FOLLOWED]);
    h.findWorkoutSessionsByUserId.mockImplementation((id: string) =>
      id === GYM_A_CALLER.id ? [{ ...pbSession(id), exercises: [{ name: "Deadlift", weight: "50 kg", reps: 5, sets: 1 }] }] : []
    );

    const res = await get();
    const data = await res.json();

    // Only the caller has volume in this fixture, so they're #1 among
    // same-gym eligible members regardless of how many cross-gym members
    // exist in the pool.
    expect(data.data.type).toBe("leaderboard");
    expect(data.data.text).toMatch(/#1/);
  });

  it("falls back to the empty pointer when no same-gym members are ranked", async () => {
    h.findCommunityEligibleUsers.mockReturnValue([GYM_B_FOLLOWED]); // only a cross-gym member exists
    h.findWorkoutSessionsByUserId.mockReturnValue([]);

    const res = await get();
    const data = await res.json();

    expect(data.data.type).toBe("empty");
  });
});

it("rejects an unauthenticated request", async () => {
  const mod = await import("@/app/api/mobile/community/highlight/route");
  const req = new NextRequest("http://localhost/api/mobile/community/highlight");
  const res = await mod.GET(req);
  expect(res.status).toBe(401);
});
