import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { MAX_OPEN_CHALLENGES_PER_SCOPE, challengeView, parseChallengeInput, todayIso } from "@/lib/challenges";
import { gymCommunityAccess, gymScopeId } from "@/lib/community-gym";
import { violatesCommunityRules } from "@/lib/community-moderation";
import { createChallengeIfUnderLimit, findChallengesByScope } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// GET  /api/mobile/community/gym/challenges — your gym's challenges (upcoming, active, ended, canceled). Gym members and the gym's staff.
// POST /api/mobile/community/gym/challenges — { title, metric, custom?, startDate, endDate }. ANY coach or admin of the gym sets one (members don't). Same
// kinds (ready-made or custom), scoring and date rules as group challenges (lib/challenges.ts): scored from logged workouts and cardio inside the dates; 90
// days at most; can't start in the past; up to 5 open at once.
export async function GET(request: NextRequest) {
  const access = gymCommunityAccess(verifyRequestSession(request)?.userId);
  if (!access.ok) return access.response;

  const today = todayIso();
  return NextResponse.json({ success: true, data: findChallengesByScope("gym", gymScopeId(access.gymId)).map((c) => challengeView(c, today)) });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const access = gymCommunityAccess(verifyRequestSession(request)?.userId);
  if (!access.ok) return access.response;
  if (!access.isStaff) {
    return NextResponse.json({ success: false, message: "Only your gym's coaches and admins can set challenges." }, { status: 403 });
  }

  const today = todayIso();
  const parsed = parseChallengeInput(body, today);
  if (!parsed.ok) return NextResponse.json({ success: false, message: parsed.message }, { status: 400 });
  if (violatesCommunityRules(parsed.title) || (parsed.custom && violatesCommunityRules(parsed.custom.subject))) {
    return NextResponse.json({ success: false, message: "That wording breaks the Community rules. Please change it." }, { status: 400 });
  }

  const challenge = {
    id: randomUUID(),
    scopeType: "gym" as const,
    scopeId: gymScopeId(access.gymId),
    createdBy: access.user.id,
    title: parsed.title,
    metric: parsed.metric,
    ...(parsed.custom ? { custom: parsed.custom } : {}),
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    createdAt: new Date().toISOString(),
    canceledAt: null,
  };
  const created = createChallengeIfUnderLimit(challenge, MAX_OPEN_CHALLENGES_PER_SCOPE, today);
  if (!created.ok) {
    return NextResponse.json(
      { success: false, message: `Your gym can have up to ${MAX_OPEN_CHALLENGES_PER_SCOPE} open challenges. Cancel one or wait for one to end.` },
      { status: 409 }
    );
  }
  return NextResponse.json({ success: true, data: challengeView(challenge, today) }, { status: 201 });
}
