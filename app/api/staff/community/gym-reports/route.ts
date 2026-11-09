import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { gymAuthorView } from "@/lib/community-gym";
import { findGymCommentById, findGymPostById, findGymReports, findProfileByUserId } from "@/lib/db";
import { authorizeStaffRequest } from "@/lib/staff-auth";

// GET /api/staff/community/gym-reports?status=open|resolved|dismissed — reports of posts and comments in the staff member's OWN gym's community (capability
// comments.moderate). Each carries the reported text, who wrote it and who reported it, so staff can decide without opening the feed.
export async function GET(request: NextRequest) {
  const auth = authorizeStaffRequest(request, "comments.moderate");
  if (!auth.ok) return auth.response;

  const statusParam = new URL(request.url).searchParams.get("status");
  const status = statusParam === "resolved" || statusParam === "dismissed" ? statusParam : "open";

  const reports = findGymReports(auth.user.gymId ?? null, status).map((r) => {
    const comment = r.targetType === "comment" ? findGymCommentById(r.targetId) : undefined;
    const post = r.targetType === "post" ? findGymPostById(r.targetId) : comment ? findGymPostById(comment.postId) : undefined;
    const authorId = r.targetType === "post" ? post?.authorId : comment?.authorId;
    return {
      id: r.id,
      targetType: r.targetType,
      targetId: r.targetId,
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt,
      text: r.targetType === "post" ? post?.body ?? null : comment?.body ?? null,
      alreadyRemoved: r.targetType === "post" ? !post || !!post.removedAt : !comment || !!comment.removedAt,
      author: authorId ? gymAuthorView(authorId) : null,
      reporterName: findProfileByUserId(r.reporterId)?.fullName ?? "A member",
    };
  });

  return NextResponse.json({ success: true, data: reports });
}
