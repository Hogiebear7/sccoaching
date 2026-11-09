import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { gymCommunityAccess, sameGymId } from "@/lib/community-gym";
import { findGymCommentById, findGymPostById, removeGymComment } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// POST /api/mobile/community/gym/comments/[commentId]/remove — the author removes their own comment; the gym's coaches and admins can remove any in their gym.
export async function POST(request: NextRequest, { params }: { params: Promise<{ commentId: string }> }) {
  const { commentId } = await params;
  const access = gymCommunityAccess(verifyRequestSession(request)?.userId);
  if (!access.ok) return access.response;

  const comment = findGymCommentById(commentId);
  const post = comment ? findGymPostById(comment.postId) : undefined;
  if (!comment || comment.removedAt || !post || !sameGymId(post.gymId, access.gymId) || (!access.isStaff && comment.authorId !== access.user.id)) {
    return NextResponse.json({ success: false, message: "Comment not found." }, { status: 404 });
  }

  removeGymComment(comment.id, new Date().toISOString());
  return NextResponse.json({ success: true, message: "Comment removed." });
}
