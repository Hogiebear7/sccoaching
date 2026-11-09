import { NextResponse } from "next/server";

import { communityDisplayName } from "@/lib/community-display-name";
import { ADULT_CONFIRMATION_REQUIRED_CODE } from "@/lib/community-groups";
import { countGymComments, findCommunityPrivacyByUserId, findProfileByUserId, findUserById, type GymCommentRecord, type GymPostRecord, type StoredUser } from "@/lib/db";
import { requireFeature } from "@/lib/member-access-response";

// Shared pieces of the gym community routes (Community plan, 2026-11): one members-only space per gym for members holding a live gym Membership at that
// gym, plus that gym's coaches and admins, who can post and set challenges. Every call re-checks the caller from the live account.

export const MAX_GYM_POST = 1000;
export const MAX_GYM_COMMENT = 500;
export const MAX_GYM_REPORT_REASON = 200;
export const GYM_POSTS_PER_DAY = 10;
export const GYM_PAGE_SIZE = 30;

export const isGymStaff = (user: Pick<StoredUser, "role">) => user.role === "coach" || user.role === "admin" || user.role === "admin_manager";

export type GymAccess = { ok: true; user: StoredUser; isStaff: boolean; gymId: string | null } | { ok: false; response: NextResponse };

/**
 * Who may use the gym community: that gym's staff, or a member with a live gym Membership who has confirmed they are 18 or over. Archived accounts and
 * everyone else are refused. The gym is the caller's own (null = primary gym); nothing the app sends can widen it.
 */
export function gymCommunityAccess(userId: string | null | undefined): GymAccess {
  const user = userId ? findUserById(userId) : undefined;
  if (!user || user.archivedAt) {
    return { ok: false, response: NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 }) };
  }
  if (isGymStaff(user)) return { ok: true, user, isStaff: true, gymId: user.gymId ?? null };

  const upgrade = requireFeature(user.id, "communityGym");
  if (upgrade) return { ok: false, response: upgrade };
  if (!findCommunityPrivacyByUserId(user.id)?.adultConfirmedAt) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, code: ADULT_CONFIRMATION_REQUIRED_CODE, message: "Confirm you are 18 or over to use your gym's community." },
        { status: 403 }
      ),
    };
  }
  return { ok: true, user, isStaff: false, gymId: user.gymId ?? null };
}

/** The gym's challenges are scoped by gym: "primary" stands for the primary gym (gymId null). */
export const gymScopeId = (gymId: string | null) => gymId ?? "primary";

export const sameGymId =(a: string | null | undefined, b: string | null | undefined) => (a ?? null) === (b ?? null);

/** A person as the gym community shows them: coaches and admins by their full name, members by their own real-name setting. */
export function gymAuthorView(userId: string) {
  const user = findUserById(userId);
  const fullName = findProfileByUserId(userId)?.fullName?.trim() || "Member";
  const staff = !!user && isGymStaff(user);
  return {
    userId,
    displayName: staff ? fullName : communityDisplayName(fullName, findCommunityPrivacyByUserId(userId)),
    isStaff: staff,
  };
}

export function gymPostView(post: GymPostRecord, viewer: { id: string }, viewerIsStaff: boolean) {
  return {
    id: post.id,
    author: gymAuthorView(post.authorId),
    body: post.body,
    createdAt: post.createdAt,
    commentCount: countGymComments(post.id),
    canRemove: post.authorId === viewer.id || viewerIsStaff,
  };
}

export function gymCommentView(comment: GymCommentRecord, viewer: { id: string }, viewerIsStaff: boolean) {
  return {
    id: comment.id,
    author: gymAuthorView(comment.authorId),
    body: comment.body,
    createdAt: comment.createdAt,
    canRemove: comment.authorId === viewer.id || viewerIsStaff,
  };
}
