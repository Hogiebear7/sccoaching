// Community profile card rules (owner request 2026-11-24): tap a name to see a small card, and two new settings decide who sees it and who may follow.
// Pure and DB-free so every rule is unit tested; the route fetches the data and passes it in.
//
// Two settings, both stored on the person's own CommunityPrivacyRecord and read from THEIR record, never the viewer's:
//   profileVisibility: who sees the card's detail (volume, recent activities, member since). Everyone else sees only the name and a follow button.
//     "followers"      only people who follow them        (default: private until the member chooses to open it up)
//     "followers_gym"  followers, plus members and staff of the same gym
//     "everyone"       anyone in Community at the same gym
//   whoCanFollow: who may START following them. Existing followers are always kept (the same grandfathering as `discoverable`).
//     "anyone"  (default, today's behaviour)   "gym"  only members and staff of the same gym   "nobody"  closed to new followers
// Cross-gym is never allowed by either setting: the route folds a different gym into the same "not found" as a missing person.

import type { CommunityPrivacyRecord, WorkoutSessionRecord } from "./db";
import { workoutVolumeKg } from "./member-stats";

export const PROFILE_VISIBILITIES = ["followers", "followers_gym", "everyone"] as const;
export type ProfileVisibility = (typeof PROFILE_VISIBILITIES)[number];

export const WHO_CAN_FOLLOW = ["anyone", "gym", "nobody"] as const;
export type WhoCanFollow = (typeof WHO_CAN_FOLLOW)[number];

export const DEFAULT_PROFILE_VISIBILITY: ProfileVisibility = "followers";
export const DEFAULT_WHO_CAN_FOLLOW: WhoCanFollow = "anyone";

export const isProfileVisibility = (v: unknown): v is ProfileVisibility => typeof v === "string" && (PROFILE_VISIBILITIES as readonly string[]).includes(v);
export const isWhoCanFollow = (v: unknown): v is WhoCanFollow => typeof v === "string" && (WHO_CAN_FOLLOW as readonly string[]).includes(v);

export function profileVisibilityOf(privacy: Pick<CommunityPrivacyRecord, "profileVisibility"> | undefined): ProfileVisibility {
  return isProfileVisibility(privacy?.profileVisibility) ? privacy.profileVisibility : DEFAULT_PROFILE_VISIBILITY;
}

export function whoCanFollowOf(privacy: Pick<CommunityPrivacyRecord, "whoCanFollow"> | undefined): WhoCanFollow {
  return isWhoCanFollow(privacy?.whoCanFollow) ? privacy.whoCanFollow : DEFAULT_WHO_CAN_FOLLOW;
}

export interface ViewerRelation {
  isSelf: boolean;
  /** The viewer follows the person whose card this is. */
  isFollower: boolean;
  /** The viewer holds a live gym Membership (or is gym staff) at the person's gym. */
  isGymMember: boolean;
}

/** May the viewer see the card's detail (volume, recent activities, member since)? */
export function canSeeProfileDetail(level: ProfileVisibility, viewer: ViewerRelation): boolean {
  if (viewer.isSelf) return true;
  if (level === "everyone") return true;
  if (level === "followers_gym") return viewer.isFollower || viewer.isGymMember;
  return viewer.isFollower;
}

export interface FollowDecision {
  allowed: boolean;
  /** Plain words for the button area when not allowed. */
  reason: string | null;
}

/** May the viewer follow this person right now? Someone already following is always allowed (grandfathered). */
export function followDecision(rule: WhoCanFollow, viewer: { isSelf: boolean; alreadyFollowing: boolean; isGymMember: boolean }): FollowDecision {
  if (viewer.isSelf) return { allowed: false, reason: null };
  if (viewer.alreadyFollowing) return { allowed: true, reason: null };
  if (rule === "nobody") return { allowed: false, reason: "This member isn't accepting new followers." };
  if (rule === "gym" && !viewer.isGymMember) return { allowed: false, reason: "This member only accepts followers from their gym's members." };
  return { allowed: true, reason: null };
}

const WINDOW_DAYS = { week: 7, month: 30, year: 365 } as const;

/** Sessions the member has not hidden and staff have not removed. These are the only ones the card counts or lists. */
export function communityVisibleSessions(sessions: WorkoutSessionRecord[]): WorkoutSessionRecord[] {
  return sessions.filter((s) => !s.isPrivate && !s.communityRemovedAt);
}

export interface ProfileStats {
  week: { volumeKg: number; sessions: number };
  month: { volumeKg: number; sessions: number };
  year: { volumeKg: number; sessions: number };
}

/** Trailing 7 / 30 / 365 day totals, the same windows the leaderboard uses so the two never disagree. */
export function profileStats(sessions: WorkoutSessionRecord[], now: Date = new Date()): ProfileStats {
  const out: ProfileStats = { week: { volumeKg: 0, sessions: 0 }, month: { volumeKg: 0, sessions: 0 }, year: { volumeKg: 0, sessions: 0 } };
  const visible = communityVisibleSessions(sessions);
  for (const key of ["week", "month", "year"] as const) {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - WINDOW_DAYS[key]);
    const cutoffISO = cutoff.toISOString().slice(0, 10);
    for (const s of visible) {
      if (s.date < cutoffISO) continue;
      out[key].sessions += 1;
      out[key].volumeKg += Math.round(workoutVolumeKg(s));
    }
  }
  return out;
}

export interface RecentActivity {
  id: string;
  date: string;
  title: string;
  exerciseCount: number;
  /** Km run in the session when it had runs, otherwise null. */
  distanceKm: number | null;
}

/** The latest few shareable sessions, newest first. Title and counts only: never weights or notes. */
export function recentActivities(sessions: WorkoutSessionRecord[], limit = 5): RecentActivity[] {
  return communityVisibleSessions(sessions)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map((s) => {
      const km = (s.runs ?? []).reduce((sum, r) => sum + (r.distance ?? 0), 0);
      return {
        id: s.id,
        date: s.date,
        title: s.title?.trim() || "Workout",
        exerciseCount: (s.exercises ?? []).length,
        distanceKm: km > 0 ? Math.round(km * 10) / 10 : null,
      };
    });
}

/** "2026-03" from an account's created timestamp (month precision only: never the exact day). */
export function memberSinceMonth(createdAt: string | undefined): string | null {
  return createdAt && /^\d{4}-\d{2}/.test(createdAt) ? createdAt.slice(0, 7) : null;
}
