import { randomUUID } from "crypto";

import { hiddenFromViewer } from "@/lib/community-moderation";
import { isGymStaff } from "@/lib/community-gym";
import {
  createNotification,
  findCommunityPrivacyByUserId,
  findGroupMembers,
  findMembersInGym,
  findNotificationByDedupeKey,
  findProfileByUserId,
  findUserById,
  type ChallengeRecord,
  type NotificationType,
  type StoredUser,
} from "@/lib/db";
import { challengeLabel } from "@/lib/challenges";
import { resolveMemberAccessForUser } from "@/lib/membership-entitlement";
import { sendPush } from "@/lib/push";

// Community notifications (groups, the gym community, challenges). Each one is an in-app notification, and a push as well when the member has push turned on
// (the same single switch every other notification follows). Nothing here reads or sends anything the member could not already see in the app.

export interface CommunityNotice {
  type: NotificationType;
  title: string;
  body: string;
  /** An in-app route (always under /community, which the app opens directly). */
  linkHref: string;
  /** Stops the same notice reaching the same person twice. Omit for one-offs that are already unique (a comment id, say). */
  dedupeKey?: string;
}

/** Sends one notice to one person. Returns false when it was skipped because they already had it. Never throws. */
export function notifyCommunityUser(userId: string, notice: CommunityNotice): boolean {
  try {
    if (notice.dedupeKey && findNotificationByDedupeKey(userId, notice.dedupeKey)) return false;
    createNotification({
      id: randomUUID(),
      userId,
      type: notice.type,
      title: notice.title,
      body: notice.body,
      readAt: null,
      linkHref: notice.linkHref,
      dedupeKey: notice.dedupeKey ?? null,
      createdAt: new Date().toISOString(),
    });
    if (findProfileByUserId(userId)?.pushNotificationsEnabled !== false) {
      void sendPush(userId, { title: notice.title, body: notice.body, linkHref: notice.linkHref });
    }
    return true;
  } catch (err) {
    console.error("[community-notify] could not notify", userId, err);
    return false;
  }
}

/**
 * The members of a gym who can open its community right now: a live gym Membership and their own 18+ confirmation (the gym screens refuse them otherwise).
 * `exceptUserId` (the author) and anyone blocked either way with them are left out.
 */
export function gymCommunityAudience(gymId: string | null, exceptUserId?: string): string[] {
  const hidden = exceptUserId ? hiddenFromViewer(exceptUserId) : new Set<string>();
  return findMembersInGym(gymId)
    .filter((u) => u.id !== exceptUserId && !hidden.has(u.id))
    .filter((u) => resolveMemberAccessForUser(u.id).gymMembership && !!findCommunityPrivacyByUserId(u.id)?.adultConfirmedAt)
    .map((u) => u.id);
}

/** The in-app route a challenge notice opens (the same one the start and finish notices use). */
export function challengeLink(c: Pick<ChallengeRecord, "scopeType" | "scopeId" | "id">): string {
  return c.scopeType === "group"
    ? `/community/challenge?scope=group&groupId=${encodeURIComponent(c.scopeId)}&challengeId=${encodeURIComponent(c.id)}`
    : `/community/challenge?scope=gym&challengeId=${encodeURIComponent(c.id)}`;
}

/** The people to tell about a new group challenge: the group's other members. The organiser, archived accounts and anyone blocked either way with the organiser are left out. */
export function groupChallengeAudience(groupId: string, exceptUserId: string): string[] {
  const hidden = hiddenFromViewer(exceptUserId);
  return findGroupMembers(groupId)
    .map((m) => m.userId)
    .filter((id) => id !== exceptUserId && !hidden.has(id))
    .filter((id) => {
      const user = findUserById(id);
      return !!user && !user.archivedAt;
    });
}

/**
 * The organiser setting a challenge tells the rest of the group straight away ("New challenge in <group>"), once each. It names the group, not the person, so it
 * never reveals anyone who has chosen to appear under an alias. The existing start-day notice still goes out for a challenge that starts later.
 */
export function notifyGroupOfNewChallenge(challenge: ChallengeRecord, groupName: string, organiserId: string): number {
  let sent = 0;
  try {
    for (const userId of groupChallengeAudience(challenge.scopeId, organiserId)) {
      if (
        notifyCommunityUser(userId, {
          type: "challenge_created",
          title: `New challenge in ${clip(groupName, 40)}`,
          body: `${clip(challenge.title, 60)}: ${challengeLabel(challenge.metric, challenge.custom)}. ${challenge.startDate} to ${challenge.endDate}.`,
          linkHref: challengeLink(challenge),
          dedupeKey: `challenge-new:${challenge.id}`,
        })
      ) {
        sent++;
      }
    }
  } catch (err) {
    console.error("[community-notify] could not notify a group of a new challenge", err);
  }
  return sent;
}

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** A coach's or admin's post in the gym feed tells the gym's members. Member posts do not (one post must not buzz a whole gym). */
export function notifyGymOfStaffPost(author: Pick<StoredUser, "id" | "role" | "gymId">, postBody: string, authorName: string): number {
  if (!isGymStaff(author)) return 0;
  let sent = 0;
  for (const userId of gymCommunityAudience(author.gymId ?? null, author.id)) {
    if (notifyCommunityUser(userId, { type: "gym_post", title: `${authorName} posted in your gym's community`, body: clip(postBody, 110), linkHref: "/community/gym" })) sent++;
  }
  return sent;
}

/** A comment on someone's gym post tells the post's author (not when they comment on their own post, nor when blocked either way). */
export function notifyGymPostAuthorOfComment(input: { postAuthorId: string; commenterId: string; commenterName: string; commentId: string; commentBody: string }): boolean {
  if (input.postAuthorId === input.commenterId) return false;
  if (hiddenFromViewer(input.postAuthorId).has(input.commenterId)) return false;
  const author = findUserById(input.postAuthorId);
  if (!author || author.archivedAt) return false;
  return notifyCommunityUser(input.postAuthorId, {
    type: "gym_comment",
    title: `${input.commenterName} commented on your post`,
    body: clip(input.commentBody, 110),
    linkHref: "/community/gym",
    dedupeKey: `gym-comment:${input.commentId}`,
  });
}
