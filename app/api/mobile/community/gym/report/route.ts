import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { MAX_GYM_REPORT_REASON, gymCommunityAccess, sameGymId } from "@/lib/community-gym";
import { createGymReport, findGymCommentById, findGymPostById, hasOpenGymReport } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// POST /api/mobile/community/gym/report — { targetType: "post" | "comment", targetId, reason } Report a gym post or comment to the gym's staff (they
// review it under Community reports). You can report anything you can see, even from someone you have blocked. Reporting twice is a quiet no-op.
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const access = gymCommunityAccess(verifyRequestSession(request)?.userId);
  if (!access.ok) return access.response;

  const { targetType, targetId, reason } = (body ?? {}) as Record<string, unknown>;
  const cleanReason = typeof reason === "string" ? reason.trim() : "";
  if ((targetType !== "post" && targetType !== "comment") || typeof targetId !== "string" || !targetId) {
    return NextResponse.json({ success: false, message: "Choose what you are reporting." }, { status: 400 });
  }
  if (!cleanReason || cleanReason.length > MAX_GYM_REPORT_REASON) {
    return NextResponse.json({ success: false, message: `Tell us why, in up to ${MAX_GYM_REPORT_REASON} characters.` }, { status: 400 });
  }

  const comment = targetType === "comment" ? findGymCommentById(targetId) : undefined;
  const post = targetType === "post" ? findGymPostById(targetId) : comment ? findGymPostById(comment.postId) : undefined;
  const removed = targetType === "post" ? post?.removedAt : comment?.removedAt;
  if (!post || removed || !sameGymId(post.gymId, access.gymId)) {
    return NextResponse.json({ success: false, message: "That post or comment isn't there any more." }, { status: 404 });
  }

  if (!hasOpenGymReport(access.user.id, targetType, targetId)) {
    createGymReport({
      id: randomUUID(),
      gymId: access.gymId,
      targetType,
      targetId,
      reporterId: access.user.id,
      reason: cleanReason,
      status: "open",
      resolvedById: null,
      resolvedAt: null,
      createdAt: new Date().toISOString(),
    });
  }
  return NextResponse.json({ success: true, message: "Thanks. Our team will take a look." }, { status: 201 });
}
