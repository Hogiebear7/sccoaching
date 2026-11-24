import { describe, expect, it } from "vitest";

import { DEFAULT_ALIAS, LEADERBOARD_ALIASES, isLeaderboardAlias, leaderboardAliasOf, leaderboardModeOf } from "@/lib/community-alias";
import type { CommunityPrivacyRecord, WorkoutSessionRecord } from "@/lib/db";
import { computeLeaderboard, type LeaderboardMemberInput } from "@/lib/leaderboard";
import { scoreChallenge } from "@/lib/challenges";

const priv = (over: Partial<CommunityPrivacyRecord>): CommunityPrivacyRecord =>
  ({ userId: "x", discoverable: true, leaderboardVisible: true, showRealName: true, createdAt: "", updatedAt: "", ...over }) as CommunityPrivacyRecord;

function session(userId: string, kg: number): WorkoutSessionRecord {
  return {
    id: `s-${userId}`,
    userId,
    date: "2026-11-20",
    title: "x",
    exercises: [{ name: "Back Squat", sets: 1, reps: 1, weight: String(kg) }],
    runs: [],
    createdAt: "2026-11-20T10:00:00Z",
    updatedAt: "2026-11-20T10:00:00Z",
  } as unknown as WorkoutSessionRecord;
}

const member = (userId: string, fullName: string, kg: number, privacy?: CommunityPrivacyRecord): LeaderboardMemberInput => ({
  userId,
  fullName,
  sessions: [session(userId, kg)],
  currentWeightKg: 80,
  privacy,
});

describe("mode and alias resolution", () => {
  it("defaults to named, and reads the old switch when no mode is stored", () => {
    expect(leaderboardModeOf(undefined)).toBe("named");
    expect(leaderboardModeOf(priv({ leaderboardVisible: false }))).toBe("hidden");
    expect(leaderboardModeOf(priv({ leaderboardMode: "alias", leaderboardVisible: true }))).toBe("alias");
    expect(leaderboardModeOf(priv({ leaderboardMode: "bogus" as never }))).toBe("named");
  });
  it("falls back to the default alias when none or an unlisted one is stored", () => {
    expect(leaderboardAliasOf(undefined)).toBe(DEFAULT_ALIAS);
    expect(leaderboardAliasOf(priv({ leaderboardAlias: "Not On The List" }))).toBe(DEFAULT_ALIAS);
    expect(leaderboardAliasOf(priv({ leaderboardAlias: "Shadow user" }))).toBe("Shadow user");
    expect(isLeaderboardAlias("Shadow user")).toBe(true);
    expect(LEADERBOARD_ALIASES[0]).toBe(DEFAULT_ALIAS);
  });
});

describe("leaderboard with aliases", () => {
  const members = [
    member("top", "Top Lifter", 200, priv({ leaderboardMode: "alias", leaderboardAlias: "Shadow user" })),
    member("me", "Me Member", 150),
    member("gone", "Gone Away", 300, priv({ leaderboardMode: "hidden", leaderboardVisible: false })),
    member("third", "Third Place", 100),
  ];

  it("keeps an aliased member ranked, under the alias, so nobody wrongly thinks they are first", () => {
    const rows = computeLeaderboard("volume", members, { id: "me", isStaff: false });
    expect(rows.map((r) => r.displayName)).toEqual(["Shadow user", "Me Member", "Third Place"]);
    expect(rows[0]).toMatchObject({ value: 200, isAlias: true, alias: null });
  });

  it("never sends an aliased member's real id to anyone else, and leaves the viewer's own id alone", () => {
    const rows = computeLeaderboard("volume", members, { id: "me", isStaff: false });
    expect(rows[0].userId).toBe("alias-0");
    expect(rows[1].userId).toBe("me");
    expect(JSON.stringify(rows)).not.toContain("Top Lifter");
    expect(JSON.stringify(rows)).not.toContain('"top"');
  });

  it("leaves a fully hidden member out for members", () => {
    expect(computeLeaderboard("volume", members, { id: "me", isStaff: false }).some((r) => r.displayName === "Gone Away")).toBe(false);
  });

  it("shows gym staff everyone by real name, and flags who is hidden from members", () => {
    const rows = computeLeaderboard("volume", members, { id: "coach", isStaff: true });
    expect(rows.map((r) => r.displayName)).toEqual(["Gone Away", "Top Lifter", "Me Member", "Third Place"]);
    expect(rows[0]).toMatchObject({ userId: "gone", hiddenFromMembers: true });
    expect(rows[1]).toMatchObject({ userId: "top", isAlias: true, alias: "Shadow user" });
  });

  it("tells an aliased member what others see, and keeps their real id", () => {
    const rows = computeLeaderboard("volume", members, { id: "top", isStaff: false });
    expect(rows[0]).toMatchObject({ userId: "top", displayName: "Top Lifter", isAlias: true, alias: "Shadow user" });
  });

  it("without a viewer reveals nothing private", () => {
    const rows = computeLeaderboard("volume", members);
    expect(rows.map((r) => r.displayName)).toEqual(["Shadow user", "Me Member", "Third Place"]);
    expect(rows[0].userId).toBe("alias-0");
  });

  it("still honours the real-name setting for named members", () => {
    const rows = computeLeaderboard("volume", [member("a", "Alex Murphy", 100, priv({ showRealName: false }))], { id: "z", isStaff: false });
    expect(rows[0].displayName).toBe("Alex M.");
  });
});

describe("challenge standings with aliases", () => {
  const members = [
    member("top", "Top Lifter", 200, priv({ leaderboardMode: "alias" })),
    member("me", "Me Member", 150),
    member("gone", "Gone Away", 300, priv({ leaderboardVisible: false })),
  ];
  it("uses the same rules as the main leaderboard (built-in metric)", () => {
    const rows = scoreChallenge("volume", members, "2026-11-01", "2026-11-30", null, { id: "me", isStaff: false });
    expect(rows.map((r) => r.displayName)).toEqual(["Hidden user", "Me Member"]);
    expect(scoreChallenge("volume", members, "2026-11-01", "2026-11-30", null, { id: "coach", isStaff: true }).map((r) => r.displayName)).toEqual([
      "Gone Away",
      "Top Lifter",
      "Me Member",
    ]);
  });
  it("and for a count metric such as days trained", () => {
    const rows = scoreChallenge("workouts", members, "2026-11-01", "2026-11-30", null, { id: "me", isStaff: false });
    expect(rows.map((r) => r.displayName).sort()).toEqual(["Hidden user", "Me Member"]);
    expect(rows.find((r) => r.displayName === "Hidden user")?.userId).toMatch(/^alias-/);
  });
});
