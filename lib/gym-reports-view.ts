import { gymAuthorView } from "@/lib/community-gym";
import { findGroupById, findGymCommentById, findGymPostById, findGymReports, findProfileByUserId, type GymReportRecord } from "@/lib/db";

// A gym community report as staff see it: the reported text, who wrote it and who reported it, so a decision can be made without opening anything else.
// Shared by the staff API (the app) and the staff web page, so the two always show the same thing.
export interface GymReportRow {
  id: string;
  targetType: GymReportRecord["targetType"];
  targetId: string;
  reason: string;
  status: GymReportRecord["status"];
  createdAt: string;
  /** The reported text; for a group its name and description. Null when it can no longer be found. */
  text: string | null;
  alreadyRemoved: boolean;
  /** Who wrote it; for a group, the organiser. */
  author: ReturnType<typeof gymAuthorView> | null;
  reporterName: string;
}

/** The reports for one gym (null = the primary gym), newest first, optionally only one status. */
export function gymReportRows(gymId: string | null, status?: GymReportRecord["status"]): GymReportRow[] {
  return findGymReports(gymId, status).map((r): GymReportRow => {
    const base = {
      id: r.id,
      targetType: r.targetType,
      targetId: r.targetId,
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt,
      reporterName: findProfileByUserId(r.reporterId)?.fullName ?? "A member",
    };
    if (r.targetType === "group") {
      const group = findGroupById(r.targetId);
      return {
        ...base,
        text: group ? (group.description ? `${group.name}\n${group.description}` : group.name) : null,
        alreadyRemoved: !group || !!group.closedAt,
        author: group ? gymAuthorView(group.organiserId) : null,
      };
    }
    const comment = r.targetType === "comment" ? findGymCommentById(r.targetId) : undefined;
    const post = r.targetType === "post" ? findGymPostById(r.targetId) : comment ? findGymPostById(comment.postId) : undefined;
    const authorId = r.targetType === "post" ? post?.authorId : comment?.authorId;
    return {
      ...base,
      text: r.targetType === "post" ? post?.body ?? null : comment?.body ?? null,
      alreadyRemoved: r.targetType === "post" ? !post || !!post.removedAt : !comment || !!comment.removedAt,
      author: authorId ? gymAuthorView(authorId) : null,
    };
  });
}
