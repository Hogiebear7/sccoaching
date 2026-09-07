// Pure leaderboard computation for the Community tab — total volume and
// best Squat/Bench/Deadlift (plus that lift as % of current bodyweight)
// across members. Pure and DB-free, same split as lib/training-programs.ts:
// the caller (an API route) fetches sessions/profile/privacy data and
// builds the input list; this module only computes and sorts. No caching
// layer — recomputed per request, same as lib/workouts.ts's
// computePersonalBests, which is fine at single-gym scale.

import { workoutVolumeKg } from "./member-stats";
import { computePersonalBests, findPersonalBestByKeywords } from "./workouts";
import type { CommunityPrivacyRecord, WorkoutSessionRecord } from "./db";

export type LeaderboardMetric = "volume" | "squat" | "bench" | "deadlift";

export const LEADERBOARD_METRICS: LeaderboardMetric[] = ["volume", "squat", "bench", "deadlift"];

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
}

// Real name, or first name + last initial when the member has opted out —
// same "quiet degrade rather than hide entirely" spirit as everywhere else
// privacy is handled in this app.
function displayNameFor(fullName: string, privacy: CommunityPrivacyRecord | undefined): string {
  const trimmed = fullName.trim();
  if (privacy?.showRealName !== false) return trimmed;

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return trimmed;
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export function computeLeaderboard(
  metric: LeaderboardMetric,
  members: LeaderboardMemberInput[]
): LeaderboardEntry[] {
  const entries: LeaderboardEntry[] = [];

  for (const { userId, fullName, sessions, currentWeightKg, privacy } of members) {
    // Absence of a CommunityPrivacyRecord means visible-by-default —
    // confirmed with the member; only an explicit false hides them.
    if (privacy?.leaderboardVisible === false) continue;

    const displayName = displayNameFor(fullName, privacy);

    if (metric === "volume") {
      const value = sessions.reduce((sum, session) => sum + workoutVolumeKg(session), 0);
      if (value <= 0) continue;
      entries.push({ userId, displayName, value, bodyweightPct: null });
      continue;
    }

    const best = findPersonalBestByKeywords(computePersonalBests(sessions), LIFT_KEYWORDS[metric]);
    if (!best?.heaviestWeight) continue;

    const value = best.heaviestWeight.value;
    const bodyweightPct =
      currentWeightKg && currentWeightKg > 0 ? Math.round((value / currentWeightKg) * 1000) / 10 : null;
    entries.push({ userId, displayName, value, bodyweightPct });
  }

  return entries.sort((a, b) => b.value - a.value);
}
