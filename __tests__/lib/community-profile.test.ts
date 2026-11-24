import { describe, expect, it } from "vitest";

import type { WorkoutSessionRecord } from "@/lib/db";
import {
  canSeeProfileDetail,
  followDecision,
  memberSinceMonth,
  profileStats,
  profileVisibilityOf,
  recentActivities,
  whoCanFollowOf,
} from "@/lib/community-profile";

const NOW = new Date("2026-11-24T12:00:00Z");

function session(over: Partial<WorkoutSessionRecord> & { date: string }): WorkoutSessionRecord {
  return {
    id: `s-${over.date}-${over.title ?? "x"}`,
    userId: "u1",
    title: "Session",
    exercises: [{ name: "Squat", sets: 3, reps: 10, weight: "100" }],
    runs: [],
    createdAt: `${over.date}T10:00:00.000Z`,
    updatedAt: `${over.date}T10:00:00.000Z`,
    ...over,
  } as unknown as WorkoutSessionRecord;
}

describe("settings defaults", () => {
  it("defaults to followers-only detail and anyone-can-follow", () => {
    expect(profileVisibilityOf(undefined)).toBe("followers");
    expect(whoCanFollowOf(undefined)).toBe("anyone");
    expect(profileVisibilityOf({ profileVisibility: "nonsense" as never })).toBe("followers");
  });
});

describe("canSeeProfileDetail", () => {
  const stranger = { isSelf: false, isFollower: false, isGymMember: false };
  it("followers only: a follower yes, a gym member and a stranger no", () => {
    expect(canSeeProfileDetail("followers", { ...stranger, isFollower: true })).toBe(true);
    expect(canSeeProfileDetail("followers", { ...stranger, isGymMember: true })).toBe(false);
    expect(canSeeProfileDetail("followers", stranger)).toBe(false);
  });
  it("followers and gym: a follower or a gym member yes, a stranger no", () => {
    expect(canSeeProfileDetail("followers_gym", { ...stranger, isFollower: true })).toBe(true);
    expect(canSeeProfileDetail("followers_gym", { ...stranger, isGymMember: true })).toBe(true);
    expect(canSeeProfileDetail("followers_gym", stranger)).toBe(false);
  });
  it("everyone: anyone yes", () => {
    expect(canSeeProfileDetail("everyone", stranger)).toBe(true);
  });
  it("you can always see your own", () => {
    expect(canSeeProfileDetail("followers", { ...stranger, isSelf: true })).toBe(true);
  });
});

describe("followDecision", () => {
  const base = { isSelf: false, alreadyFollowing: false, isGymMember: false };
  it("anyone: allowed", () => {
    expect(followDecision("anyone", base)).toEqual({ allowed: true, reason: null });
  });
  it("gym: only gym members", () => {
    expect(followDecision("gym", base).allowed).toBe(false);
    expect(followDecision("gym", base).reason).toMatch(/gym/);
    expect(followDecision("gym", { ...base, isGymMember: true }).allowed).toBe(true);
  });
  it("nobody: refused with a plain reason", () => {
    expect(followDecision("nobody", base)).toEqual({ allowed: false, reason: "This member isn't accepting new followers." });
  });
  it("an existing follower is kept even when the door has since closed", () => {
    expect(followDecision("nobody", { ...base, alreadyFollowing: true }).allowed).toBe(true);
    expect(followDecision("gym", { ...base, alreadyFollowing: true }).allowed).toBe(true);
  });
  it("you cannot follow yourself", () => {
    expect(followDecision("anyone", { ...base, isSelf: true }).allowed).toBe(false);
  });
});

describe("profileStats", () => {
  it("totals trailing 7, 30 and 365 days and counts sessions", () => {
    const stats = profileStats(
      [
        session({ date: "2026-11-23", title: "a" }), // 3000 kg, in all three
        session({ date: "2026-11-01", title: "b" }), // month and year
        session({ date: "2026-03-01", title: "c" }), // year only
        session({ date: "2025-01-01", title: "d" }), // none
      ],
      NOW,
    );
    expect(stats.week).toEqual({ volumeKg: 3000, sessions: 1 });
    expect(stats.month).toEqual({ volumeKg: 6000, sessions: 2 });
    expect(stats.year).toEqual({ volumeKg: 9000, sessions: 3 });
  });

  it("leaves out sessions the member hid or staff removed", () => {
    const stats = profileStats(
      [session({ date: "2026-11-23", title: "a" }), session({ date: "2026-11-22", title: "p", isPrivate: true }), session({ date: "2026-11-21", title: "r", communityRemovedAt: "2026-11-22T00:00:00Z" })],
      NOW,
    );
    expect(stats.week.sessions).toBe(1);
  });
});

describe("recentActivities", () => {
  it("returns the newest five shareable sessions with title and counts only", () => {
    const sessions = ["01", "02", "03", "04", "05", "06", "07"].map((d) => session({ date: `2026-11-${d}`, title: `Day ${d}` }));
    sessions.push(session({ date: "2026-11-20", title: "Secret", isPrivate: true }));
    const recent = recentActivities(sessions);
    expect(recent).toHaveLength(5);
    expect(recent[0].title).toBe("Day 07");
    expect(recent.some((r) => r.title === "Secret")).toBe(false);
    expect(Object.keys(recent[0]).sort()).toEqual(["date", "distanceKm", "exerciseCount", "id", "title"]);
  });

  it("adds up run distance and falls back to a generic title", () => {
    const [r] = recentActivities([session({ date: "2026-11-02", title: "  ", runs: [{ distance: 5.04 }, { distance: 2 }] as never })]);
    expect(r.title).toBe("Workout");
    expect(r.distanceKm).toBe(7);
  });
});

describe("memberSinceMonth", () => {
  it("gives month precision only", () => {
    expect(memberSinceMonth("2026-03-17T10:00:00.000Z")).toBe("2026-03");
    expect(memberSinceMonth(undefined)).toBeNull();
    expect(memberSinceMonth("garbage")).toBeNull();
  });
});
