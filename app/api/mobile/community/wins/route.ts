import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findCommunityPrivacyByUserId,
  findFollowingIds,
  findProfileByUserId,
  findUserById,
  findWorkoutSessionsByUserId,
} from "@/lib/db";
import { communityDisplayName } from "@/lib/community-display-name";
import { sessionPbExerciseName } from "@/lib/community-highlight";
import { sameGymAsStaff } from "@/lib/gym-scope";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { computePersonalBests } from "@/lib/workouts";

const DEFAULT_LIMIT = 20;
const ALLOWED_LIMITS = [20, 50, 100];

export interface CommunityWinEntry {
  id: string;
  userId: string;
  authorName: string;
  date: string;
  personalBestExercise: string;
}

// GET /api/mobile/community/wins?limit=20|50|100
// Every personal-best session across everyone the member follows, most
// recent first. Unlike the main feed (activity-first, only looks at each
// author's most recent DEFAULT_LIMIT sessions), this scans each followed
// member's FULL session history — a win from months ago still surfaces
// here even once it's scrolled off their recent activity. Reuses the same
// PB definition as the feed route (sessionPbExerciseName) so a session
// counts as a "win" identically in both places.
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
  const requestedLimit = Number.parseInt(params.get("limit") ?? "", 10);
  const limit = ALLOWED_LIMITS.includes(requestedLimit) ? requestedLimit : DEFAULT_LIMIT;

  // Same defense-in-depth gym check as the main feed route — a followed
  // member's wins only surface here if they're also in the caller's gym.
  const followingIds = findFollowingIds(me.id).filter((id) => sameGymAsStaff(me, id));

  const wins: CommunityWinEntry[] = [];

  for (const authorId of followingIds) {
    const sessions = findWorkoutSessionsByUserId(authorId);
    const bests = computePersonalBests(sessions);
    const authorName = communityDisplayName(
      findProfileByUserId(authorId)?.fullName?.trim() || "Member",
      findCommunityPrivacyByUserId(authorId)
    );

    for (const s of sessions) {
      if (s.isPrivate) continue;
      const exerciseName = sessionPbExerciseName(s, bests);
      if (!exerciseName) continue;
      wins.push({ id: s.id, userId: authorId, authorName, date: s.date, personalBestExercise: exerciseName });
    }
  }

  wins.sort((a, b) => b.date.localeCompare(a.date));

  return NextResponse.json({
    success: true,
    data: { wins: wins.slice(0, limit), hasMore: wins.length > limit },
  });
}
