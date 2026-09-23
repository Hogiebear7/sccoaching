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
  // reporter: commentId -> workoutSessionId -> the session owner's verified
  // gymId. A comment or session that no longer exists can't be verified
  // safely, so that report is excluded rather than assumed same-gym.
  const reports = findAllCommentReports()
    .map((r) => {
      const comment = findCommentById(r.commentId);
      const session = comment ? findWorkoutSessionById(comment.workoutSessionId) : undefined;
      const owner = session ? findUserById(session.userId) : undefined;
      return { report: r, comment, owner };
    })
    .filter(({ owner }) => !!owner && sameGym(me, owner))
    .map(({ report: r, comment }) => {
      const reporterProfile = findProfileByUserId(r.reporterId);
      const reporterUser = findUserById(r.reporterId);
      const commentAuthorProfile = comment ? findProfileByUserId(comment.userId) : null;
      return {
        ...r,
        reporterName: reporterProfile?.fullName?.trim() || reporterUser?.email || "Unknown member",
        commentBody: comment?.body ?? null,
        commentAuthorName: commentAuthorProfile?.fullName?.trim() ?? null,
      };
    });

  return <CommunityReportsView reports={reports} />;
}
