// Route-level cross-gym read-isolation test for
// app/api/mobile/community/feed/route.ts. Defense-in-depth: a same-gym
// follow relationship still surfaces; a cross-gym one — even though the
// follow itself is allowed by the (unchanged in this slice) follow route —
// is now excluded from the feed regardless of the follow record.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findFollowingIds: vi.fn(),
  findWorkoutSessionsByUserId: vi.fn(),
  findProfileByUserId: vi.fn(),
  findCommunityPrivacyByUserId: vi.fn(),
  countLikesByWorkoutSessionId: vi.fn(),
  countCommentsByWorkoutSessionId: vi.fn(),
  hasLikedWorkoutSession: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

// gymId: null is the established primary-gym convention (see lib/gym-scope.ts).
const GYM_A_CALLER = { id: "caller-a", email: "caller@x.test", role: "member" as const, gymId: null };
const GYM_A_FOLLOWED = { id: "followed-a", email: "followeda@x.test", role: "member" as const, gymId: null };
const GYM_B_FOLLOWED = { id: "followed-b", email: "followedb@x.test", role: "member" as const, gymId: "gym-b" };

function session(exercises: unknown[] = [{ name: "Back Squat" }]) {
  return {
    id: "session-1",
    userId: "",
    date: "2026-01-01",
    title: "Full Body",
    exercises,
    runs: [],
    isPrivate: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

async function get(query = "") {
  const mod = await import("@/app/api/mobile/community/feed/route");
  const token = signSession({ userId: GYM_A_CALLER.id }, MEMBER_SESSION_LIFETIME_MS);
  const req = new NextRequest(`http://localhost/api/mobile/community/feed${query}`, {
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
      ? [{ ...session(), id: `session-${userId}`, userId }]
      : []
  );
  h.findProfileByUserId.mockReturnValue({ fullName: "Test Member" });
  h.findCommunityPrivacyByUserId.mockReturnValue(undefined);
  h.countLikesByWorkoutSessionId.mockReturnValue(0);
  h.countCommentsByWorkoutSessionId.mockReturnValue(0);
  h.hasLikedWorkoutSession.mockReturnValue(false);
});

describe("GET /api/mobile/community/feed", () => {
  it("includes a same-gym followed member's session", async () => {
    const res = await get();
    const data = await res.json();

    expect(res.status).toBe(200);
    const userIds = data.data.items.map((i: { userId: string }) => i.userId);
    expect(userIds).toContain(GYM_A_FOLLOWED.id);
  });

  it("excludes a cross-gym followed member's session, even though the follow itself exists", async () => {
    const res = await get();
    const data = await res.json();

    expect(res.status).toBe(200);
    const userIds = data.data.items.map((i: { userId: string }) => i.userId);
    expect(userIds).not.toContain(GYM_B_FOLLOWED.id);
    // findFollowingIds itself still returned both — confirms the exclusion
    // is a gym check, not a change to follow behavior.
    expect(h.findFollowingIds).toHaveBeenCalledWith(GYM_A_CALLER.id);
  });

  it("does not fetch session history for a cross-gym followed member at all", async () => {
    await get();
    expect(h.findWorkoutSessionsByUserId).not.toHaveBeenCalledWith(GYM_B_FOLLOWED.id);
    expect(h.findWorkoutSessionsByUserId).toHaveBeenCalledWith(GYM_A_FOLLOWED.id);
  });

  it("rejects an unauthenticated request", async () => {
    const mod = await import("@/app/api/mobile/community/feed/route");
    const req = new NextRequest("http://localhost/api/mobile/community/feed");
    const res = await mod.GET(req);
    expect(res.status).toBe(401);
  });

  it("preserves existing private-session behavior (excluded regardless of gym)", async () => {
    h.findWorkoutSessionsByUserId.mockImplementation((userId: string) =>
      userId === GYM_A_FOLLOWED.id ? [{ ...session(), id: "private-1", userId, isPrivate: true }] : []
    );
    const res = await get();
    const data = await res.json();
    expect(data.data.items).toHaveLength(0);
  });

  it("preserves response shape and pagination fields", async () => {
    const res = await get("?limit=1&offset=0");
    const data = await res.json();
    expect(data).toMatchObject({ success: true, data: { items: expect.any(Array), hasMore: expect.any(Boolean) } });
    expect(data.data.items.length).toBeLessThanOrEqual(1);
  });
});
