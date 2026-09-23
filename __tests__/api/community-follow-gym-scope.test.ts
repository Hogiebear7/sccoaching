// Cross-gym isolation test for app/api/mobile/community/follow/route.ts.
// A cross-gym follow attempt must be rejected using the exact same
// not-found response as a missing or ineligible member — no distinct
// status or message reveals that a cross-gym account exists.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findCommunityPrivacyByUserId: vi.fn(),
  findProfileByUserId: vi.fn(),
  followUser: vi.fn(),
  isCommunityEligible: vi.fn(),
  isFollowing: vi.fn(),
  createNotification: vi.fn(),
}));
vi.mock("@/lib/db", () => h);
vi.mock("@/lib/push", () => ({ sendPush: vi.fn().mockResolvedValue(undefined) }));

const GYM_A_CALLER = { id: "caller-a", email: "caller@x.test", role: "member" as const, gymId: null };
const GYM_A_TARGET = { id: "target-a", email: "targeta@x.test", role: "member" as const, gymId: null };
const GYM_B_TARGET = { id: "target-b", email: "targetb@x.test", role: "member" as const, gymId: "gym-b" };
const GYM_A_TARGET_2 = { id: "target-a2", email: "targeta2@x.test", role: "member" as const, gymId: null };

async function post(userId: string, sessionUserId: string = GYM_A_CALLER.id) {
  const mod = await import("@/app/api/mobile/community/follow/route");
  const token = signSession({ userId: sessionUserId }, MEMBER_SESSION_LIFETIME_MS);
  const req = new NextRequest("http://localhost/api/mobile/community/follow", {
    method: "POST",
    headers: { Cookie: `session=${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  return mod.POST(req);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) =>
    [GYM_A_CALLER, GYM_A_TARGET, GYM_B_TARGET, GYM_A_TARGET_2].find((u) => u.id === id)
  );
  h.isCommunityEligible.mockReturnValue(true);
  h.isFollowing.mockReturnValue(false);
  h.findCommunityPrivacyByUserId.mockReturnValue(undefined);
  h.findProfileByUserId.mockReturnValue({ fullName: "Test Member" });
});

describe("POST /api/mobile/community/follow", () => {
  it("succeeds for a same-gym target", async () => {
    const res = await post(GYM_A_TARGET.id);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(h.followUser).toHaveBeenCalledWith(GYM_A_CALLER.id, GYM_A_TARGET.id);
  });

  it("rejects a cross-gym target using the existing not-found response", async () => {
    const crossGymRes = await post(GYM_B_TARGET.id);
    const crossGymData = await crossGymRes.json();

    const missingRes = await post("does-not-exist");
    const missingData = await missingRes.json();

    expect(crossGymRes.status).toBe(missingRes.status);
    expect(crossGymData).toEqual(missingData);
    expect(crossGymRes.status).toBe(404);
    expect(crossGymData.message).toBe("Member not found.");
  });

  it("does not create a FollowRecord when the target is cross-gym", async () => {
    await post(GYM_B_TARGET.id);
    expect(h.followUser).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    const mod = await import("@/app/api/mobile/community/follow/route");
    const req = new NextRequest("http://localhost/api/mobile/community/follow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: GYM_A_TARGET.id }),
    });
    const res = await mod.POST(req);
    expect(res.status).toBe(401);
  });

  it("preserves existing duplicate-follow behavior (idempotent, still success)", async () => {
    h.isFollowing.mockReturnValue(true);
    const res = await post(GYM_A_TARGET.id);
    expect(res.status).toBe(200);
    expect(h.followUser).toHaveBeenCalledWith(GYM_A_CALLER.id, GYM_A_TARGET.id);
  });

  it("distinguishes two same-gym, same-display-name targets by user ID", async () => {
    h.findProfileByUserId.mockReturnValue({ fullName: "Same Name" });

    await post(GYM_A_TARGET.id);
    expect(h.followUser).toHaveBeenLastCalledWith(GYM_A_CALLER.id, GYM_A_TARGET.id);

    await post(GYM_A_TARGET_2.id);
    expect(h.followUser).toHaveBeenLastCalledWith(GYM_A_CALLER.id, GYM_A_TARGET_2.id);
  });
});
