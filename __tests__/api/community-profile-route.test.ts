// Route tests for app/api/mobile/community/profile/[userId]/route.ts and the who-can-follow gate on community/follow.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findCommunityPrivacyByUserId: vi.fn(),
  findProfileByUserId: vi.fn(),
  findWorkoutSessionsByUserId: vi.fn(),
  isCommunityEligible: vi.fn(),
  isFollowing: vi.fn(),
  followUser: vi.fn(),
  createNotification: vi.fn(),
  gymMember: vi.fn(),
  blocked: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  findUserById: h.findUserById,
  findCommunityPrivacyByUserId: h.findCommunityPrivacyByUserId,
  findProfileByUserId: h.findProfileByUserId,
  findWorkoutSessionsByUserId: h.findWorkoutSessionsByUserId,
  isCommunityEligible: h.isCommunityEligible,
  isFollowing: h.isFollowing,
  followUser: h.followUser,
  createNotification: h.createNotification,
}));
vi.mock("@/lib/push", () => ({ sendPush: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/community-profile-access", () => ({ isGymMemberOrStaff: () => h.gymMember() }));
vi.mock("@/lib/community-moderation", () => ({ isBlockedEitherWay: () => h.blocked() }));
vi.mock("@/lib/community-gym", () => ({ isGymStaff: (u: { role: string }) => u.role !== "member" }));

const ME = { id: "me", email: "me@x.test", role: "member" as const, gymId: null, createdAt: "2026-01-05T00:00:00Z" };
const OTHER = { id: "other", email: "o@x.test", role: "member" as const, gymId: null, createdAt: "2026-03-17T10:00:00Z" };
const OTHER_B = { id: "other-b", email: "b@x.test", role: "member" as const, gymId: "gym-b", createdAt: "2026-03-17T10:00:00Z" };
const COACH = { id: "coach", email: "c@x.test", role: "coach" as const, gymId: null, createdAt: "2025-01-01T00:00:00Z" };

const recentDate = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
const SESSIONS = [
  { id: "s1", userId: "other", date: recentDate, title: "Leg day", exercises: [{ name: "Squat", sets: 3, reps: 10, weight: "100" }], runs: [], createdAt: recentDate + "T10:00:00Z" },
  { id: "s2", userId: "other", date: recentDate, title: "Hidden", isPrivate: true, exercises: [], runs: [], createdAt: recentDate + "T11:00:00Z" },
];

const cookie = (id: string) => ({ Cookie: `session=${signSession({ userId: id }, MEMBER_SESSION_LIFETIME_MS)}` });

async function getProfile(userId: string, viewer: string | null = "me") {
  const mod = await import("@/app/api/mobile/community/profile/[userId]/route");
  const req = new NextRequest(`http://localhost/api/mobile/community/profile/${userId}`, { headers: viewer ? cookie(viewer) : {} });
  return mod.GET(req, { params: Promise.resolve({ userId }) });
}

async function follow(userId: string) {
  const mod = await import("@/app/api/mobile/community/follow/route");
  const req = new NextRequest("http://localhost/api/mobile/community/follow", {
    method: "POST",
    headers: { ...cookie("me"), "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  return mod.POST(req);
}

let privacyOf: Record<string, unknown> = {};
let following: Set<string>; // "a>b" means a follows b

beforeEach(() => {
  vi.clearAllMocks();
  privacyOf = {};
  following = new Set();
  const users = [ME, OTHER, OTHER_B, COACH];
  h.findUserById.mockImplementation((id: string) => users.find((u) => u.id === id));
  h.findCommunityPrivacyByUserId.mockImplementation((id: string) => privacyOf[id]);
  h.findProfileByUserId.mockImplementation((id: string) => ({ fullName: id === "other" ? "Alex Murphy" : id === "coach" ? "Coach Conor" : "Someone Else" }));
  h.findWorkoutSessionsByUserId.mockReturnValue(SESSIONS);
  h.isCommunityEligible.mockReturnValue(true);
  h.isFollowing.mockImplementation((a: string, b: string) => following.has(`${a}>${b}`));
  h.gymMember.mockReturnValue(false);
  h.blocked.mockReturnValue(false);
});

describe("GET /api/mobile/community/profile/[userId]", () => {
  it("requires sign-in", async () => {
    expect((await getProfile("other", null)).status).toBe(401);
  });

  it("gives a stranger the name and follow button only, by default", async () => {
    const res = await getProfile("other");
    const { data } = await res.json();
    expect(data).toMatchObject({ displayName: "Alex Murphy", detailHidden: true, detail: null, canFollow: true, isFollowing: false });
  });

  it("shows detail to a follower, without private sessions", async () => {
    following.add("me>other");
    const { data } = await (await getProfile("other")).json();
    expect(data.detailHidden).toBe(false);
    expect(data.detail.memberSince).toBe("2026-03");
    expect(data.detail.stats.week.sessions).toBe(1);
    expect(data.detail.stats.week.volumeKg).toBe(3000);
    expect(data.detail.recent.map((r: { title: string }) => r.title)).toEqual(["Leg day"]);
  });

  it("followers_gym opens detail to a gym member who does not follow", async () => {
    privacyOf.other = { profileVisibility: "followers_gym" };
    h.gymMember.mockReturnValue(true);
    expect((await (await getProfile("other")).json()).data.detailHidden).toBe(false);
    h.gymMember.mockReturnValue(false);
    expect((await (await getProfile("other")).json()).data.detailHidden).toBe(true);
  });

  it("everyone opens detail to a stranger", async () => {
    privacyOf.other = { profileVisibility: "everyone" };
    expect((await (await getProfile("other")).json()).data.detailHidden).toBe(false);
  });

  it("uses the person's own real-name setting", async () => {
    privacyOf.other = { showRealName: false };
    expect((await (await getProfile("other")).json()).data.displayName).toBe("Alex M.");
  });

  it("keeps volume off the card for someone hidden from the leaderboard", async () => {
    privacyOf.other = { profileVisibility: "everyone", leaderboardVisible: false };
    const { data } = await (await getProfile("other")).json();
    expect(data.detail.stats).toBeNull();
    expect(data.detail.recent).toHaveLength(1);
  });

  it("explains a closed door", async () => {
    privacyOf.other = { whoCanFollow: "nobody" };
    const { data } = await (await getProfile("other")).json();
    expect(data.canFollow).toBe(false);
    expect(data.followBlockedReason).toMatch(/isn't accepting/);
  });

  it("returns the same 404 for another gym, a block, an ineligible and a missing person", async () => {
    const results = [];
    results.push(await getProfile("other-b"));
    h.blocked.mockReturnValue(true);
    results.push(await getProfile("other"));
    h.blocked.mockReturnValue(false);
    h.isCommunityEligible.mockReturnValue(false);
    results.push(await getProfile("other"));
    results.push(await getProfile("nobody"));
    for (const r of results) {
      expect(r.status).toBe(404);
      expect((await r.json()).message).toBe("Member not found.");
    }
  });

  it("shows you your own card in full, whatever your settings", async () => {
    privacyOf.me = { profileVisibility: "followers", leaderboardVisible: false };
    h.findWorkoutSessionsByUserId.mockReturnValue(SESSIONS);
    const { data } = await (await getProfile("me")).json();
    expect(data).toMatchObject({ isSelf: true, detailHidden: false, canFollow: false });
    expect(data.detail.stats).not.toBeNull();
  });

  it("shows a coach by full name with no training numbers", async () => {
    privacyOf.coach = { profileVisibility: "everyone" };
    const { data } = await (await getProfile("coach")).json();
    expect(data).toMatchObject({ displayName: "Coach Conor", isStaff: true });
    expect(data.detail.stats).toBeNull();
    expect(data.detail.recent).toEqual([]);
  });
});

describe("POST /api/mobile/community/follow: who can follow", () => {
  it("blocks a new follow when the person is closed to followers", async () => {
    privacyOf.other = { whoCanFollow: "nobody" };
    const res = await follow("other");
    expect(res.status).toBe(403);
    expect(h.followUser).not.toHaveBeenCalled();
  });

  it("gym only: refuses a non-gym viewer, allows a gym member", async () => {
    privacyOf.other = { whoCanFollow: "gym" };
    expect((await follow("other")).status).toBe(403);
    h.gymMember.mockReturnValue(true);
    expect((await follow("other")).status).toBe(200);
    expect(h.followUser).toHaveBeenCalledWith("me", "other");
  });

  it("keeps an existing follower when the door has closed", async () => {
    privacyOf.other = { whoCanFollow: "nobody" };
    following.add("me>other");
    expect((await follow("other")).status).toBe(200);
  });

  it("anyone: allowed as before", async () => {
    expect((await follow("other")).status).toBe(200);
  });
});
