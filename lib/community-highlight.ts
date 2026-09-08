// Picks the single most relevant thing to show in the mobile Home screen's
// Community module — a recent win among followed members, falling back to
// the member's own leaderboard position, falling back to an empty-state
// pointer. Deliberately restrained to ONE item, not a ranked list: "one
// strong item is better than a noisy collection of weak items."
//
// No "challenges" or "coach announcements" branch here — those aren't
// backend concepts yet (no challenge entity, no standalone announcement
// post type). This only surfaces what's actually derivable from real data
// today; a challenges/announcements source can slot in as another branch
// later without restructuring this selection logic.

import { computePersonalBests } from "./workouts";
import type { WorkoutSessionRecord } from "./db";

const RECENT_WIN_WINDOW_DAYS = 7;

export interface FollowedMemberActivity {
  userId: string;
  fullName: string;
  /** Full session history, not just recent — needed to know this member's
      all-time bests, not only what they logged this week. */
  allSessions: WorkoutSessionRecord[];
}

export interface RecentWin {
  userId: string;
  authorName: string;
  exerciseName: string;
  sessionId: string;
  date: string;
}

// A session "is the win" if some exercise in it matches that member's
// all-time heaviest weight for that exercise, dated to this exact session
// — i.e. this session is where the record was actually set, not just an
// exercise that happens to appear in both.
// Exported so the feed route can flag individual items as PBs (for the
// Community destination's "Wins" section) using the same definition.
export function sessionPbExerciseName(
  session: WorkoutSessionRecord,
  allTimeBests: ReturnType<typeof computePersonalBests>
): string | null {
  for (const ex of session.exercises) {
    const lower = ex.name.trim().toLowerCase();
    if (!lower) continue;
    const best = allTimeBests.find((b) => b.exerciseName.toLowerCase() === lower);
    if (best?.heaviestWeight?.date === session.date) return best.exerciseName;
  }
  return null;
}

// Most recent PB among the given members' non-private sessions within the
// trailing window. `todayISO` is passed in (not computed here) so this
// stays pure and testable against a fixed clock.
export function findRecentWin(members: FollowedMemberActivity[], todayISO: string): RecentWin | null {
  const cutoffISO = addDaysISO(todayISO, -RECENT_WIN_WINDOW_DAYS);

  let winner: RecentWin | null = null;

  for (const member of members) {
    const allTimeBests = computePersonalBests(member.allSessions);
    for (const session of member.allSessions) {
      if (session.isPrivate) continue;
      if (session.date < cutoffISO || session.date > todayISO) continue;
      const exerciseName = sessionPbExerciseName(session, allTimeBests);
      if (!exerciseName) continue;
      if (!winner || session.date > winner.date) {
        winner = { userId: member.userId, authorName: member.fullName, exerciseName, sessionId: session.id, date: session.date };
      }
    }
  }

  return winner;
}

function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
