import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  CHALLENGE_METRICS,
  MAX_CHALLENGE_DAYS,
  MAX_CHALLENGE_TITLE,
  MAX_OPEN_CHALLENGES_PER_SCOPE,
  MAX_START_AHEAD_DAYS,
  challengeView,
  daysBetween,
  isIsoDate,
  todayIso,
  type ChallengeMetric,
} from "@/lib/challenges";
import { findGroupVisibleToMember, requireGroupAccess } from "@/lib/community-groups";
import { violatesCommunityRules } from "@/lib/community-moderation";
import { createChallengeIfUnderLimit, findChallengesByScope, findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// GET  /api/mobile/community/groups/[id]/challenges — the group's challenges (upcoming, active, ended, canceled), newest first. Members only.
// POST /api/mobile/community/groups/[id]/challenges — { title, metric, startDate, endDate } the ORGANISER sets one. Scored automatically from members'
// logged workouts (volume, days trained, or best squat / bench / deadlift) inside the dates. Up to 5 open at once; at most 90 days long; it can start
// today or up to 60 days ahead (never in the past, so it can't be backdated to a result that already exists).
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

  const { title, metric, startDate, endDate } = (body ?? {}) as Record<string, unknown>;
  const cleanTitle = typeof title === "string" ? title.trim() : "";
  if (!cleanTitle || cleanTitle.length > MAX_CHALLENGE_TITLE) {
    return NextResponse.json({ success: false, message: `Give the challenge a title of up to ${MAX_CHALLENGE_TITLE} characters.` }, { status: 400 });
  }
  if (violatesCommunityRules(cleanTitle)) {
    return NextResponse.json({ success: false, message: "That wording breaks the Community rules. Please change it." }, { status: 400 });
  }
  if (typeof metric !== "string" || !(CHALLENGE_METRICS as readonly string[]).includes(metric)) {
    return NextResponse.json({ success: false, message: "Choose what the challenge is scored on." }, { status: 400 });
  }
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    return NextResponse.json({ success: false, message: "Choose a start and end date." }, { status: 400 });
  }
  const today = todayIso();
  if (startDate < today) {
    return NextResponse.json({ success: false, message: "A challenge can't start in the past." }, { status: 400 });
  }
  if (daysBetween(today, startDate) > MAX_START_AHEAD_DAYS) {
    return NextResponse.json({ success: false, message: `A challenge can start up to ${MAX_START_AHEAD_DAYS} days from now.` }, { status: 400 });
  }
  if (endDate < startDate) {
    return NextResponse.json({ success: false, message: "The end date can't be before the start date." }, { status: 400 });
  }
  if (daysBetween(startDate, endDate) + 1 > MAX_CHALLENGE_DAYS) {
    return NextResponse.json({ success: false, message: `A challenge can run for up to ${MAX_CHALLENGE_DAYS} days.` }, { status: 400 });
  }

  const challenge = {
    id: randomUUID(),
    scopeType: "group" as const,
    scopeId: group.id,
    createdBy: me.id,
    title: cleanTitle,
    metric: metric as ChallengeMetric,
    startDate,
    endDate,
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
