import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  countCommentsByWorkoutSessionId,
  countLikesByWorkoutSessionId,
  findCommunityPrivacyByUserId,
  findProfileByUserId,
  findUserById,
  findWorkoutSessionById,
  findWorkoutSessionsByUserId,
  hasLikedWorkoutSession,
} from "@/lib/db";
import { communityDisplayName } from "@/lib/community-display-name";
import { sessionPbExerciseName } from "@/lib/community-highlight";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { computePersonalBests } from "@/lib/workouts";

// GET /api/mobile/community/workouts/[id] — one feed item, same shape the
// feed list returns. Backs the mobile deep-link target
// (src/app/community/workout/[id].tsx) for notification taps that need to
// open specific content rather than dumping the member at the Community
// root — a session doesn't have to be on the requester's current feed page
// (or even from someone they still follow) to be reachable this way, same
// as any other permalink.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = verifyRequestSession(request);
  if (!session) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  const me = findUserById(session.userId);
  if (!me) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const target = findWorkoutSessionById(id);
  if (!target || (target.isPrivate && target.userId !== me.id)) {
    return NextResponse.json({ success: false, message: "Workout not found." }, { status: 404 });
  }

  const profile = findProfileByUserId(target.userId);
  const bests = computePersonalBests(findWorkoutSessionsByUserId(target.userId));
  const personalBestExercise = sessionPbExerciseName(target, bests);

  return NextResponse.json({
    success: true,
    data: {
      item: {
        id: target.id,
        userId: target.userId,
        authorName: communityDisplayName(
          profile?.fullName?.trim() || "Member",
          findCommunityPrivacyByUserId(target.userId)
        ),
        date: target.date,
        title: target.title,
        exercises: target.exercises,
        runs: target.runs,
        sessionRpe: target.sessionRpe ?? null,
        likeCount: countLikesByWorkoutSessionId(target.id),
        commentCount: countCommentsByWorkoutSessionId(target.id),
        likedByMe: hasLikedWorkoutSession(me.id, target.id),
        isPersonalBest: personalBestExercise !== null,
        personalBestExercise,
        createdAt: target.createdAt,
      },
    },
  });
}
