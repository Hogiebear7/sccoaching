// Cross-gym isolation test for app/api/mobile/community/unfollow/route.ts.
// This route always returned a generic success message with no existence
// check at all — that's preserved exactly, so a cross-gym target simply
// never reaches unfollowUser (defense-in-depth against a relationship
// follow already prevents from being created), without changing the
// response in any way a caller could use to probe for it.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  unfollowUser: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

const GYM_A_CALLER = { id: "caller-a", email: "caller@x.test", role: "member" as const, gymId: null };
const GYM_A_TARGET = { id: "target-a", email: "targeta@x.test", role: "member" as const, gymId: null };
const GYM_B_TARGET = { id: "target-b", email: "targetb@x.test", role: "member" as const, gymId: "gym-b" };

async function post(userId: string, sessionUserId: string = GYM_A_CALLER.id) {
  const mod = await import("@/app/api/mobile/community/unfollow/route");
  const token = signSession({ userId: sessionUserId }, MEMBER_SESSION_LIFETIME_MS);
  const req = new NextRequest("http://localhost/api/mobile/community/unfollow", {
    method: "POST",
    headers: { Cookie: `session=${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  return mod.POST(req);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) =>
    [GYM_A_CALLER, GYM_A_TARGET, GYM_B_TARGET].find((u) => u.id === id)
  );
});

describe("POST /api/mobile/community/unfollow", () => {
  it("succeeds (mutates) for a same-gym target", async () => {
    const res = await post(GYM_A_TARGET.id);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(h.unfollowUser).toHaveBeenCalledWith(GYM_A_CALLER.id, GYM_A_TARGET.id);
  });

  it("returns the same generic success response for a cross-gym target without mutating", async () => {
    const crossGymRes = await post(GYM_B_TARGET.id);
    const crossGymData = await crossGymRes.json();

    const sameGymRes = await post(GYM_A_TARGET.id);
    const sameGymData = await sameGymRes.json();

    // Identical response shape/message either way — no signal a caller
    // could use to tell a cross-gym relationship from a same-gym one.
    expect(crossGymData).toEqual(sameGymData);
    expect(crossGymRes.status).toBe(200);
  });

  it("does not call unfollowUser for a cross-gym target", async () => {
    await post(GYM_B_TARGET.id);
    expect(h.unfollowUser).not.toHaveBeenCalled();
  });

  it("does not mutate an unrelated user's relationships", async () => {
    await post(GYM_B_TARGET.id);
    expect(h.unfollowUser).not.toHaveBeenCalledWith(GYM_A_CALLER.id, GYM_A_TARGET.id);
  });

  it("rejects an unauthenticated request", async () => {
    const mod = await import("@/app/api/mobile/community/unfollow/route");
    const req = new NextRequest("http://localhost/api/mobile/community/unfollow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: GYM_A_TARGET.id }),
    });
    const res = await mod.POST(req);
    expect(res.status).toBe(401);
  });
});
