import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  countCommentsByWorkoutSessionId,
  countLikesByWorkoutSessionId,
  findFollowingIds,
  findProfileByUserId,
  findUserById,
  findWorkoutSessionsByUserId,
  hasLikedWorkoutSession,
} from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// GET /api/mobile/community/feed?limit=&offset=
// Chronological feed of sessions logged by everyone the member follows,
// excluding any session its owner marked isPrivate. Offset-paginated —
// plenty at single-gym scale (same "no premature pagination cursor"
// judgment as everywhere else new in this pass).
export async function GET(request: NextRequest) {
  const session = verifyRequestSession(request);
  if (!session) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  const me = findUserById(session.userId);
  if (!me) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(params.get("limit") ?? "", 10) || DEFAULT_LIMIT));
  const offset = Math.max(0, Number.parseInt(params.get("offset") ?? "", 10) || 0);

  const followingIds = findFollowingIds(me.id);

  const allSessions = followingIds
    .flatMap((id) => findWorkoutSessionsByUserId(id).filter((s) => !s.isPrivate))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  const page = allSessions.slice(offset, offset + limit);

  const items = page.map((s) => {
    const profile = findProfileByUserId(s.userId);
    return {
      id: s.id,
      userId: s.userId,
      authorName: profile?.fullName?.trim() || "Member",
      date: s.date,
      title: s.title,
      exercises: s.exercises,
      runs: s.runs,
      sessionRpe: s.sessionRpe ?? null,
      likeCount: countLikesByWorkoutSessionId(s.id),
      commentCount: countCommentsByWorkoutSessionId(s.id),
      likedByMe: hasLikedWorkoutSession(me.id, s.id),
      createdAt: s.createdAt,
    };
  });

  return NextResponse.json({
    success: true,
    data: { items, hasMore: offset + limit < allSessions.length },
  });
}
