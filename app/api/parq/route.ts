import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findProfileByUserId, findUserById, saveProfile } from "@/lib/db";
import { hasActiveMembership } from "@/lib/membership";
import { verifyRequestSession } from "@/lib/mobile-auth";
import {
  PARQ_CONSENT,
  PARQ_DECLARATION,
  PARQ_FOOTER,
  PARQ_INTRO,
  PARQ_QUESTIONS,
  parqIsCurrent,
  parqRequired,
  validateParqSubmission,
} from "@/lib/parq";

// GET /api/parq: the form wording and whether THIS member needs to complete it now (a gym member with no current PAR-Q, and the gate switched on).
// POST /api/parq: save a completed PAR-Q on the member's profile. Both are for the signed-in member only; staff never write a member's PAR-Q here.
function memberFromRequest(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  return user && user.role === "member" ? user : null;
}

export async function GET(request: NextRequest) {
  const user = memberFromRequest(request);
  if (!user) return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  const profile = findProfileByUserId(user.id);
  const current = parqIsCurrent(profile?.parq);
  // Only gym members are ever asked. App-only (free or App Subscription) accounts get needed: false.
  const needed = parqRequired() && hasActiveMembership(user.id) && !current;
  return NextResponse.json({
    success: true,
    data: {
      needed,
      current,
      answeredAt: profile?.parq?.answeredAt ?? null,
      questions: PARQ_QUESTIONS,
      intro: PARQ_INTRO,
      consent: PARQ_CONSENT,
      declaration: PARQ_DECLARATION,
      footer: PARQ_FOOTER,
    },
  });
}

export async function POST(request: NextRequest) {
  const user = memberFromRequest(request);
  if (!user) return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  const profile = findProfileByUserId(user.id);
  if (!profile) return NextResponse.json({ success: false, message: "No profile found for this account." }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }
  const result = validateParqSubmission(body);
  if (!result.ok) return NextResponse.json({ success: false, message: result.message }, { status: 400 });

  saveProfile({ ...profile, parq: result.record, updatedAt: new Date().toISOString() });
  return NextResponse.json({ success: true, message: "Thanks, that's saved." });
}
