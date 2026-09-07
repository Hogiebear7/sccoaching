import { findAllCommentReports, findCommentById, findProfileByUserId, findUserById } from "@/lib/db";
import { requireStaffPage } from "@/lib/staff-auth";
import { CommunityReportsView } from "./CommunityReportsView";

export default async function StaffCommunityReportsPage() {
  await requireStaffPage("comments.moderate");

  const reports = findAllCommentReports().map((r) => {
    const reporterProfile = findProfileByUserId(r.reporterId);
    const reporterUser = findUserById(r.reporterId);
    const comment = findCommentById(r.commentId);
    const commentAuthorProfile = comment ? findProfileByUserId(comment.userId) : null;
    return {
      ...r,
      reporterName: reporterProfile?.fullName?.trim() || reporterUser?.email || "Unknown member",
      // A comment already removed (by its author, or a prior resolve) has
      // nothing left to show — the report still lists so staff can dismiss
      // it, just without content to review.
      commentBody: comment?.body ?? null,
      commentAuthorName: commentAuthorProfile?.fullName?.trim() ?? null,
    };
  });

  return <CommunityReportsView reports={reports} />;
}
