// Community safety controls (Apple App Review Guideline 1.2 and Google Play's user-generated-content policy): members can BLOCK another member, REPORT
// a comment or a shared workout, and a conservative filter refuses obviously abusive comments before they are stored. Staff review reports in the existing
// queue (/staff/community-reports) and can remove the content. Everything here stays inside the member's own gym; nothing widens who can see what.
//
// BLOCKING IS MUTUAL IN EFFECT. If A blocks B, A no longer sees B's workouts, comments, likes or name anywhere in Community, and B no longer sees A's either, so
// a blocked person cannot keep reading or replying to the person who blocked them. Neither is told which of them blocked the other: the blocked member just no
// longer finds the blocker (the same "not found" answer as a cross-gym or private workout). Blocking also removes any follow in both directions and stops
// notifications between the two. The block list lives on the blocker's own profile (ProfileRecord.blockedUserIds) so it is removed with the account.
import { findProfileByUserId, findUserIdsBlocking } from "@/lib/db";
import type { WorkoutSessionRecord } from "@/lib/db";
import { sameGymAsStaff } from "@/lib/gym-scope";

export const MAX_BLOCKED = 500;

/** Ids this member has blocked. */
export function blockedByViewer(viewerId: string): Set<string> {
  return new Set(findProfileByUserId(viewerId)?.blockedUserIds ?? []);
}

/** Every id that must be invisible to this viewer in Community: people they blocked and people who blocked them. */
export function hiddenFromViewer(viewerId: string): Set<string> {
  const hidden = blockedByViewer(viewerId);
  for (const id of findUserIdsBlocking(viewerId)) hidden.add(id);
  return hidden;
}

export function isBlockedEitherWay(a: string, b: string): boolean {
  if (a === b) return false;
  return blockedByViewer(a).has(b) || blockedByViewer(b).has(a);
}

/** A workout removed from Community by staff after a report stays removed (the owner cannot flip it back with the visibility toggle). */
export function isSessionOutOfCommunity(session: Pick<WorkoutSessionRecord, "isPrivate" | "communityRemovedAt">): boolean {
  return !!session.isPrivate || !!session.communityRemovedAt;
}

/** The one rule for "may this member open this shared workout, comment on it or like it". False folds into the same not-found answer. */
export function canViewCommunitySession(me: { id: string; gymId?: string | null }, target: WorkoutSessionRecord): boolean {
  if (target.userId === me.id) return true;
  if (isSessionOutOfCommunity(target)) return false;
  if (!sameGymAsStaff(me, target.userId)) return false;
  return !isBlockedEitherWay(me.id, target.userId);
}

// A deliberately small, conservative list: it refuses only unmistakable slurs and direct threats, never ordinary gym banter. It is a first line, not the
// moderation system: reports and staff review are what handle everything else. Matching is on whole words after folding case and common letter swaps.
const BLOCKED_PATTERNS: RegExp[] = [
  /\bk[i1!]ll\s+(yourself|urself|you)\b/,
  /\b(go\s+)?kys\b/,
  /\bi('?ll|\s+will)\s+(kill|rape|hurt|stab|shoot)\s+(you|u)\b/,
  /\bn[i1!]gg(er|a)s?\b/,
  /\bf[a@]gg?[o0]ts?\b/,
  /\btr[a@]nn(y|ies)\b/,
  /\bret[a@]rds?\b/,
  /\bc[u*]nts?\b/,
  /\bwh[o0]res?\b/,
];

export const CONTENT_REFUSED_MESSAGE = "That comment can't be posted because it breaks our community rules. Please reword it.";

export function violatesCommunityRules(text: string): boolean {
  const folded = text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  return BLOCKED_PATTERNS.some((p) => p.test(folded));
}
