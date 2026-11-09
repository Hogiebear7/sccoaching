import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { gymCommunityAccess, sameGymId } from "@/lib/community-gym";
import { findGymPostById, removeGymPost } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// POST /api/mobile/community/gym/posts/[postId]/remove — the author removes their own post; any coach or admin of the same gym can remove any post there.
// A post in another gym, a missing post and a post you aren't allowed to remove all give the same "not found".
export async function POST(request: NextRequest, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  const access = gymCommunityAccess(verifyRequestSession(request)?.userId);
  if (!access.ok) return access.response;

  const post = findGymPostById(postId);
  if (!post || post.removedAt || !sameGymId(post.gymId, access.gymId) || (!access.isStaff && post.authorId !== access.user.id)) {
    return NextResponse.json({ success: false, message: "Post not found." }, { status: 404 });
  }

  removeGymPost(post.id, access.user.id, new Date().toISOString());
  return NextResponse.json({ success: true, message: "Post removed." });
}
