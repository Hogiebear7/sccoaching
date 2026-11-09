import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { MAX_OPEN_CHALLENGES_PER_SCOPE, challengeView, parseChallengeInput, todayIso } from "@/lib/challenges";
import { findGroupVisibleToMember, requireGroupAccess } from "@/lib/community-groups";
import { violatesCommunityRules } from "@/lib/community-moderation";
import { createChallengeIfUnderLimit, findChallengesByScope, findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// GET  /api/mobile/community/groups/[id]/challenges — the group's challenges (upcoming, active, ended, canceled), newest first. Members only.
// POST /api/mobile/community/groups/[id]/challenges — { title, metric, custom?, startDate, endDate } the ORGANISER sets one. `metric` is a ready-made kind
// (strength, consistency, running, cardio: lib/challenges.ts) or "custom" with { measure, subject | cardioType, targetDistanceKm }. Scored automatically from
// members' logged workouts and cardio inside the dates. Up to 5 open at once; at most 90 days long; it can start today or up to 60 days ahead (never in the
// past, so it can't be backdated to a result that already exists).
// Everything asynchronous (params, body) is read first so the checks and the write run back to back (scripts/audit-await-gaps.cjs).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = verifyRequestSession(request);
  const me = session ? findUserById(session.userId) : undefined;
  if (!me) return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  const gate = requireGroupAccess(me.id);
  if (gate) return gate;

  const group = findGroupVisibleToMember(me.id, id);
  if (!group) return NextResponse.json({ success: false, message: "Group not found." }, { status: 404 });

  const today = todayIso();
  return NextResponse.json({ success: true, data: findChallengesByScope("group", group.id).map((c) => challengeView(c, today)) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const session = verifyRequestSession(request);
  const me = session ? findUserById(session.userId) : undefined;
  if (!me) return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  const gate = requireGroupAccess(me.id);
  if (gate) return gate;

  const group = findGroupVisibleToMember(me.id, id);
  if (!group || group.organiserId !== me.id) {
    return NextResponse.json({ success: false, message: "Group not found." }, { status: 404 });
  }

  // The same rules as the gym's challenges (lib/challenges.ts): title, kind (ready-made or custom), dates. Wording checks stay here.
  const today = todayIso();
  const parsed = parseChallengeInput(body, today);
  if (!parsed.ok) return NextResponse.json({ success: false, message: parsed.message }, { status: 400 });
  if (violatesCommunityRules(parsed.title) || (parsed.custom && violatesCommunityRules(parsed.custom.subject))) {
    return NextResponse.json({ success: false, message: "That wording breaks the Community rules. Please change it." }, { status: 400 });
  }

  const challenge = {
    id: randomUUID(),
    scopeType: "group" as const,
    scopeId: group.id,
    createdBy: me.id,
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
      { success: false, message: `A group can have up to ${MAX_OPEN_CHALLENGES_PER_SCOPE} open challenges. Cancel one or wait for one to end.` },
      { status: 409 }
    );
  }

  return NextResponse.json({ success: true, data: challengeView(challenge, today) }, { status: 201 });
}
