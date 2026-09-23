// Route-level cross-gym read-isolation test for
// app/api/mobile/community/leaderboard/route.ts. Also covers the
// non-deduplication requirement: two distinct userIds sharing the same
// display name must both appear as separate entries when both are same-gym.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findCommunityEligibleUsers: vi.fn(),
  findProfileByUserId: vi.fn(),
  findWorkoutSessionsByUserId: vi.fn(),
  findBodyWeightLogsByUserId: vi.fn(),
  findCommunityPrivacyByUserId: vi.fn(),
}));
vi.mock("@/lib/db", () => h);
vi.mock("@/lib/body-weight", () => ({ resolveCurrentWeightKg: vi.fn(() => null) }));

const GYM_A_CALLER = { id: "caller-a", email: "caller@x.test", role: "member" as const, gymId: null, archivedAt: null };
const GYM_A_MEMBER = { id: "member-a", email: "membera@x.test", role: "member" as const, gymId: null, archivedAt: null };
const GYM_B_MEMBER = { id: "member-b", email: "memberb@x.test", role: "member" as const, gymId: "gym-b", archivedAt: null };
const GYM_A_MEMBER_2 = { id: "member-a2", email: "membera2@x.test", role: "member" as const, gymId: null, archivedAt: null };

function volumeSession(userId: string, weight: number) {
  return {
    id: `session-${userId}`,
    userId,
    date: "2026-01-01",
    title: "Leg Day",
    exercises: [{ name: "Back Squat", weight: `${weight} kg`, reps: 5, sets: 1 }],
    runs: [],
    isPrivate: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

async function get(query = "") {
  const mod = await import("@/app/api/mobile/community/leaderboard/route");
  const token = signSession({ userId: GYM_A_CALLER.id }, MEMBER_SESSION_LIFETIME_MS);
  const req = new NextRequest(`http://localhost/api/mobile/community/leaderboard${query}`, {
    headers: { Cookie: `session=${token}` },
  });
  return mod.GET(req);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) =>
    [GYM_A_CALLER, GYM_A_MEMBER, GYM_B_MEMBER, GYM_A_MEMBER_2].find((u) => u.id === id)
  );
  h.findProfileByUserId.mockImplementation((id: string) => ({ fullName: `Name-${id}` }));
  h.findBodyWeightLogsByUserId.mockReturnValue([]);
  h.findCommunityPrivacyByUserId.mockReturnValue(undefined);
  h.findWorkoutSessionsByUserId.mockReturnValue([]);
});

describe("GET /api/mobile/community/leaderboard", () => {
  it("ranks same-gym members", async () => {
    h.findCommunityEligibleUsers.mockReturnValue([GYM_A_CALLER, GYM_A_MEMBER]);
    h.findWorkoutSessionsByUserId.mockImplementation((id: string) =>
      id === GYM_A_MEMBER.id ? [volumeSession(id, 100)] : []
    );

    const res = await get();
    const data = await res.json();

    expect(res.status).toBe(200);
    const userIds = data.data.entries.map((e: { userId: string }) => e.userId);
    expect(userIds).toContain(GYM_A_MEMBER.id);
  });

  it("excludes cross-gym members from the eligible pool entirely", async () => {
    h.findCommunityEligibleUsers.mockReturnValue([GYM_A_CALLER, GYM_A_MEMBER, GYM_B_MEMBER]);
    h.findWorkoutSessionsByUserId.mockImplementation((id: string) =>
      id === GYM_A_MEMBER.id || id === GYM_B_MEMBER.id ? [volumeSession(id, 100)] : []
    );

    const res = await get();
    const data = await res.json();

    const userIds = data.data.entries.map((e: { userId: string }) => e.userId);
    expect(userIds).not.toContain(GYM_B_MEMBER.id);
    expect(h.findWorkoutSessionsByUserId).not.toHaveBeenCalledWith(GYM_B_MEMBER.id);
  });

  it("keeps two same-gym members with the same display name as separate distinct entries", async () => {
    h.findProfileByUserId.mockImplementation((id: string) =>
      id === GYM_A_MEMBER.id || id === GYM_A_MEMBER_2.id ? { fullName: "Same Name" } : { fullName: `Name-${id}` }
    );
    h.findCommunityEligibleUsers.mockReturnValue([GYM_A_CALLER, GYM_A_MEMBER, GYM_A_MEMBER_2]);
    h.findWorkoutSessionsByUserId.mockImplementation((id: string) =>
      id === GYM_A_MEMBER.id ? [volumeSession(id, 100)] : id === GYM_A_MEMBER_2.id ? [volumeSession(id, 80)] : []
    );

    const res = await get();
    const data = await res.json();

    const sameNameEntries = data.data.entries.filter((e: { displayName: string }) => e.displayName === "Same Name");
    expect(sameNameEntries).toHaveLength(2);
    const ids = sameNameEntries.map((e: { userId: string }) => e.userId).sort();
    expect(ids).toEqual([GYM_A_MEMBER.id, GYM_A_MEMBER_2.id].sort());
  });

  it("preserves metric/range handling", async () => {
    h.findCommunityEligibleUsers.mockReturnValue([]);
    const res = await get("?metric=squat&range=month");
    const data = await res.json();
    expect(data.data.metric).toBe("squat");
    expect(data.data.range).toBe("month");
  });

  it("preserves response shape", async () => {
    h.findCommunityEligibleUsers.mockReturnValue([]);
    const res = await get();
    const data = await res.json();
    expect(data).toMatchObject({
      success: true,
      data: { metric: "volume", range: "all", entries: expect.any(Array), myUserId: GYM_A_CALLER.id },
    });
  });

  it("rejects an unauthenticated request", async () => {
    const mod = await import("@/app/api/mobile/community/leaderboard/route");
    const req = new NextRequest("http://localhost/api/mobile/community/leaderboard");
    const res = await mod.GET(req);
    expect(res.status).toBe(401);
  });
});
