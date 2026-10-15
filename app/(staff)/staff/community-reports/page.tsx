import {
  findAllCommentReports,
  findCommentById,
  findProfileByUserId,
  findUserById,
  findWorkoutSessionById,
} from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { requireStaffPage } from "@/lib/staff-auth";
import { CommunityReportsView } from "./CommunityReportsView";

export default async function StaffCommunityReportsPage() {
  const me = await requireStaffPage("comments.moderate");

  // Report ownership is resolved through the underlying content, never the
  // reporter: for a comment, commentId -> workoutSessionId -> the session
  // owner's verified gymId; for a reported workout post, workoutSessionId ->
  // the session owner's verified gymId. Content that no longer exists can't
  // be verified safely, so that report is excluded rather than assumed
  // same-gym.
  const reports = findAllCommentReports()
    .map((r) => {
      const isWorkout = r.targetType === "workout";
      const comment = isWorkout ? undefined : findCommentById(r.commentId);
      const session = isWorkout
        ? r.workoutSessionId
          ? findWorkoutSessionById(r.workoutSessionId)
          : undefined
        : comment
          ? findWorkoutSessionById(comment.workoutSessionId)
          : undefined;
      const owner = session ? findUserById(session.userId) : undefined;
      return { report: r, comment, session, owner, isWorkout };
    })
    .filter(({ owner }) => !!owner && sameGym(me, owner))
    .map(({ report: r, comment, session, owner, isWorkout }) => {
      const reporterProfile = findProfileByUserId(r.reporterId);
      const reporterUser = findUserById(r.reporterId);
      const commentAuthorProfile = comment ? findProfileByUserId(comment.userId) : null;
      const ownerProfile = owner ? findProfileByUserId(owner.id) : null;
      return {
        ...r,
        reporterName: reporterProfile?.fullName?.trim() || reporterUser?.email || "Unknown member",
        commentBody: comment?.body ?? null,
        commentAuthorName: commentAuthorProfile?.fullName?.trim() ?? null,
        workoutTitle: isWorkout ? (session?.title ?? null) : null,
        workoutAuthorName: isWorkout ? (ownerProfile?.fullName?.trim() ?? null) : null,
        workoutRemoved: isWorkout ? !!session?.communityRemovedAt : false,
      };
    });

  return <CommunityReportsView reports={reports} />;
}
