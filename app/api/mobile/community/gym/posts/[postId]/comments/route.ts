import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { MAX_GYM_COMMENT, gymCommentView, gymCommunityAccess, sameGymId } from "@/lib/community-gym";
import { hiddenFromViewer, violatesCommunityRules } from "@/lib/community-moderation";
import { createGymComment, findGymCommentsByPostId, findGymPostById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// GET  /api/mobile/community/gym/posts/[postId]/comments — the comments on a post in your gym, oldest first (comments by anyone blocked either way left out).
// POST /api/mobile/community/gym/posts/[postId]/comments — { body } up to 500 characters. Same access as the feed; a post you can't see is "not found".
export async function GET(request: NextRequest, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  const access = gymCommunityAccess(verifyRequestSession(request)?.userId);
  if (!access.ok) return access.response;

  const post = findGymPostById(postId);
  if (!post || post.removedAt || !sameGymId(post.gymId, access.gymId)) {
    return NextResponse.json({ success: false, message: "Post not found." }, { status: 404 });
  }

  const hidden = hiddenFromViewer(access.user.id);
  const comments = findGymCommentsByPostId(post.id).filter((c) => c.authorId === access.user.id || !hidden.has(c.authorId));
  return NextResponse.json({ success: true, data: comments.map((c) => gymCommentView(c, access.user, access.isStaff)) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const access = gymCommunityAccess(verifyRequestSession(request)?.userId);
  if (!access.ok) return access.response;

  const post = findGymPostById(postId);
  if (!post || post.removedAt || !sameGymId(post.gymId, access.gymId)) {
    return NextResponse.json({ success: false, message: "Post not found." }, { status: 404 });
  }

  const raw = (body as { body?: unknown } | null)?.body;
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text || text.length > MAX_GYM_COMMENT) {
    return NextResponse.json({ success: false, message: `Write a comment of up to ${MAX_GYM_COMMENT} characters.` }, { status: 400 });
  }
  if (violatesCommunityRules(text)) {
    return NextResponse.json({ success: false, message: "That wording breaks the Community rules. Please change it." }, { status: 400 });
  }

  const comment = { id: randomUUID(), postId: post.id, authorId: access.user.id, body: text, createdAt: new Date().toISOString(), removedAt: null };
  createGymComment(comment);
  return NextResponse.json({ success: true, data: gymCommentView(comment, access.user, access.isStaff) }, { status: 201 });
}
