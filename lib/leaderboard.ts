// Pure leaderboard computation for the Community tab — total volume and
// best Squat/Bench/Deadlift (plus that lift as % of current bodyweight)
// across members. Pure and DB-free, same split as lib/training-programs.ts:
// the caller (an API route) fetches sessions/profile/privacy data and
// builds the input list; this module only computes and sorts. No caching
// layer — recomputed per request, same as lib/workouts.ts's
// computePersonalBests, which is fine at single-gym scale.

import { leaderboardAliasOf, leaderboardModeOf } from "./community-alias";
import { communityDisplayName } from "./community-display-name";
import { workoutVolumeKg } from "./member-stats";
import { computePersonalBests, findPersonalBestByKeywords } from "./workouts";
import type { CommunityPrivacyRecord, WorkoutSessionRecord } from "./db";

export type LeaderboardMetric = "volume" | "squat" | "bench" | "deadlift";

export const LEADERBOARD_METRICS: LeaderboardMetric[] = ["volume", "squat", "bench", "deadlift"];

// All-time "volume" structurally favours whoever joined earliest — more
// months logging, more accumulated kg, regardless of how hard anyone's
// actually training right now. week/month/year are trailing windows
// anchored to today, not calendar-aligned periods, specifically so two
// members who joined a month apart get a genuinely equal-length window to
// be ranked within — a calendar month wouldn't guarantee that for someone
// who joined mid-month. "custom" is an explicit inclusive [start, end]
// range; either bound may be omitted to leave that side open.
export type LeaderboardRange = "week" | "month" | "year" | "all" | "custom";

export const LEADERBOARD_RANGES: LeaderboardRange[] = ["week", "month", "year", "all", "custom"];

const RANGE_DAYS: Record<"week" | "month" | "year", number> = {
  week: 7,
  month: 30,
  year: 365,
};

export function filterSessionsByRange(
  sessions: WorkoutSessionRecord[],
  range: LeaderboardRange,
  customStartISO?: string | null,
  customEndISO?: string | null
): WorkoutSessionRecord[] {
  if (range === "all") return sessions;

  if (range === "custom") {
    if (!customStartISO && !customEndISO) return sessions;
    return sessions.filter((s) => {
      if (customStartISO && s.date < customStartISO) return false;
      if (customEndISO && s.date > customEndISO) return false;
      return true;
    });
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RANGE_DAYS[range]);
  const cutoffISO = cutoff.toISOString().slice(0, 10);
  return sessions.filter((s) => s.date >= cutoffISO);
}

// A separate, smaller list from lib/workouts.ts's TRACKED_PERSONAL_BEST_EXERCISES
// (Back Squat, Bench Press, Lunge, Push Up, Front Plank) — that one is tuned
// for a staff quick-view widget and includes bodyweight moves unsuited to a
// %-bodyweight ranking. This is the classic "big 3", confirmed with the member.
const LIFT_KEYWORDS: Record<"squat" | "bench" | "deadlift", string[]> = {
  squat: ["squat"],
  bench: ["bench"],
  deadlift: ["deadlift"],
};

export interface LeaderboardMemberInput {
  userId: string;
  fullName: string;
  sessions: WorkoutSessionRecord[];
  currentWeightKg: number | null;
  privacy: CommunityPrivacyRecord | undefined;
}

export interface LeaderboardEntry {
  userId: string;
  displayName: string;
  /** kg — total volume for "volume", heaviest lift ever logged for the others. */
  value: number;
  /** value as % of current bodyweight, one decimal place — null for
      "volume" (a bodyweight ratio isn't meaningful there) or when the
      member has no current weight on file. */
  bodyweightPct: number | null;
  /** True when this member is shown under an alias. Absent for everyone shown by name. */
  isAlias?: boolean;
  /** The alias the member chose. Only sent to that member and to gym staff; null for everyone else (who just see it as the name). */
  alias?: string | null;
  /** Only sent to gym staff: this member has hidden themselves from other members entirely. */
  hiddenFromMembers?: boolean;
}

/** Who is looking. Gym staff see real names for everyone; a member always sees themselves. Without a viewer, nothing private is revealed. */
export interface LeaderboardViewer {
  id: string;
  isStaff: boolean;
}

type Presented = Pick<LeaderboardEntry, "userId" | "displayName" | "isAlias" | "alias" | "hiddenFromMembers">;

/** How one member appears to this viewer, or null when they are not shown. Shared by the main leaderboard and challenge standings. */
export function presentMember(
  member: Pick<LeaderboardMemberInput, "userId" | "fullName" | "privacy">,
  viewer?: LeaderboardViewer
): Presented | null {
  const { userId, fullName, privacy } = member;
  const mode = leaderboardModeOf(privacy);
  const realName = communityDisplayName(fullName, privacy);
  const isSelf = viewer?.id === userId;
  const staff = viewer?.isStaff === true;

  if (mode === "named") return { userId, displayName: realName };
  if (mode === "hidden") return staff && !isSelf ? { userId, displayName: realName, hiddenFromMembers: true } : null;

  const alias = leaderboardAliasOf(privacy);
  return staff || isSelf ? { userId, displayName: realName, isAlias: true, alias } : { userId, displayName: alias, isAlias: true, alias: null };
}

/**
 * Last step, after sorting: an aliased entry the viewer may not identify gets an opaque id (its place in this list), so the response never carries the real
 * id of someone hiding behind an alias. Staff and the member themselves keep real ids (the app uses them to highlight "you" and open the profile card).
 */
export function maskAliasIds(entries: LeaderboardEntry[], viewer?: LeaderboardViewer): LeaderboardEntry[] {
  return entries.map((e, i) => (e.isAlias && !viewer?.isStaff && e.userId !== viewer?.id ? { ...e, userId: `alias-${i}` } : e));
}

export function computeLeaderboard(
  metric: LeaderboardMetric,
  members: LeaderboardMemberInput[],
  viewer?: LeaderboardViewer
): LeaderboardEntry[] {
  const entries: LeaderboardEntry[] = [];

  for (const member of members) {
    const { userId, sessions, currentWeightKg } = member;
    // Absence of a CommunityPrivacyRecord means shown by name — confirmed
    // with the member; only an explicit choice changes how they appear.
    const shown = presentMember(member, viewer);
    if (!shown) continue;

    if (metric === "volume") {
      const value = sessions.reduce((sum, session) => sum + workoutVolumeKg(session), 0);
      if (value <= 0) continue;
      entries.push({ ...shown, value, bodyweightPct: null });
      continue;
    }

    const best = findPersonalBestByKeywords(computePersonalBests(sessions), LIFT_KEYWORDS[metric]);
    if (!best?.heaviestWeight) continue;

    const value = best.heaviestWeight.value;
    const bodyweightPct =
      currentWeightKg && currentWeightKg > 0 ? Math.round((value / currentWeightKg) * 1000) / 10 : null;
    entries.push({ ...shown, userId, value, bodyweightPct });
  }

  return maskAliasIds(entries.sort((a, b) => b.value - a.value), viewer);
}
