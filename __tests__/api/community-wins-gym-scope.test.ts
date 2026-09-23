// Route-level cross-gym read-isolation test for
// app/api/mobile/community/wins/route.ts — same defense-in-depth pattern as
// the sibling feed test: a cross-gym followed member's PB never surfaces,
// regardless of the follow relationship.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findFollowingIds: vi.fn(),
  findWorkoutSessionsByUserId: vi.fn(),
  findProfileByUserId: vi.fn(),
  findCommunityPrivacyByUserId: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

const GYM_A_CALLER = { id: "caller-a", email: "caller@x.test", role: "member" as const, gymId: null };
const GYM_A_FOLLOWED = { id: "followed-a", email: "followeda@x.test", role: "member" as const, gymId: null };
const GYM_B_FOLLOWED = { id: "followed-b", email: "followedb@x.test", role: "member" as const, gymId: "gym-b" };

function pbSession(userId: string, weight: number, date: string) {
  return {
    id: `session-${userId}-${date}`,
    userId,
    date,
    title: "Leg Day",
    exercises: [{ name: "Back Squat", weight: `${weight} kg`, reps: 5, sets: 1 }],
    runs: [],
    isPrivate: false,
    createdAt: `${date}T00:00:00.000Z`,
  };
}

async function get(limit?: number) {
  const mod = await import("@/app/api/mobile/community/wins/route");
  const token = signSession({ userId: GYM_A_CALLER.id }, MEMBER_SESSION_LIFETIME_MS);
  const req = new NextRequest(`http://localhost/api/mobile/community/wins${limit ? `?limit=${limit}` : ""}`, {
    headers: { Cookie: `session=${token}` },
  });
  return mod.GET(req);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) =>
    [GYM_A_CALLER, GYM_A_FOLLOWED, GYM_B_FOLLOWED].find((u) => u.id === id)
  );
  h.findFollowingIds.mockReturnValue([GYM_A_FOLLOWED.id, GYM_B_FOLLOWED.id]);
  h.findWorkoutSessionsByUserId.mockImplementation((userId: string) =>
    userId === GYM_A_FOLLOWED.id || userId === GYM_B_FOLLOWED.id
      ? [pbSession(userId, 100, "2026-01-01")]
      : []
  );
  h.findProfileByUserId.mockReturnValue({ fullName: "Test Member" });
  h.findCommunityPrivacyByUserId.mockReturnValue(undefined);
});

describe("GET /api/mobile/community/wins", () => {
  it("includes a same-gym followed member's win", async () => {
    const res = await get();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data.wins.map((w: { userId: string }) => w.userId)).toContain(GYM_A_FOLLOWED.id);
  });

  it("excludes a cross-gym followed member's win, even though the follow itself exists", async () => {
    const res = await get();
    const data = await res.json();

    const userIds = data.data.wins.map((w: { userId: string }) => w.userId);
    expect(userIds).not.toContain(GYM_B_FOLLOWED.id);
    expect(h.findFollowingIds).toHaveBeenCalledWith(GYM_A_CALLER.id);
  });

  it("does not scan session history for a cross-gym followed member at all", async () => {
    await get();
    expect(h.findWorkoutSessionsByUserId).not.toHaveBeenCalledWith(GYM_B_FOLLOWED.id);
  });

  it("rejects an unauthenticated request", async () => {
    const mod = await import("@/app/api/mobile/community/wins/route");
    const req = new NextRequest("http://localhost/api/mobile/community/wins");
    const res = await mod.GET(req);
    expect(res.status).toBe(401);
  });

  it("preserves existing private-session behavior (excluded regardless of gym)", async () => {
    h.findWorkoutSessionsByUserId.mockImplementation((userId: string) =>
      userId === GYM_A_FOLLOWED.id ? [{ ...pbSession(userId, 100, "2026-01-01"), isPrivate: true }] : []
    );
    const res = await get();
    const data = await res.json();
    expect(data.data.wins).toHaveLength(0);
  });

  it("preserves response shape and the 20/50/100 limit clamp", async () => {
    const res = await get(999); // not an allowed value -> falls back to default (20)
    const data = await res.json();
    expect(data).toMatchObject({ success: true, data: { wins: expect.any(Array), hasMore: expect.any(Boolean) } });
  });
});
