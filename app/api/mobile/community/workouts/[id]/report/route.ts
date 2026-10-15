import { randomUUID } from "crypto";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createCommentReport, findAllCommentReports, findUserById, findWorkoutSessionById } from "@/lib/db";
import { canViewCommunitySession } from "@/lib/community-moderation";
import { verifyRequestSession } from "@/lib/mobile-auth";

const MAX_REASON_LENGTH = 300;

// POST /api/mobile/community/workouts/[id]/report — { reason }
// Reports a shared workout post. Same report -> staff queue -> resolve pipeline as comment reports (/staff/community-reports); resolving removes the
// workout from Community. Cross-gym, private, removed and blocked workouts all answer "not found", and you can't report your own. A second report from the same
// member on the same still-open post is accepted but not duplicated.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = verifyRequestSession(request);
  const me = session ? findUserById(session.userId) : undefined;
  if (!me) return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const target = findWorkoutSessionById(id);
  if (!target || target.userId === me.id || !canViewCommunitySession(me, target)) {
    return NextResponse.json({ success: false, message: "Workout not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }
  const { reason } = (body ?? {}) as Record<string, unknown>;
  const cleanReason = typeof reason === "string" ? reason.trim().slice(0, MAX_REASON_LENGTH) : "";
  if (!cleanReason) {
    return NextResponse.json({ success: false, message: "A reason is required." }, { status: 400 });
  }

  const already = findAllCommentReports().some(
    (r) => r.targetType === "workout" && r.workoutSessionId === id && r.reporterId === me.id && r.status === "open"
  );
  if (!already) {
    createCommentReport({
      id: randomUUID(),
      commentId: "",
      targetType: "workout",
      workoutSessionId: id,
      reporterId: me.id,
      reason: cleanReason,
      status: "open",
      resolvedByStaffId: null,
      resolvedAt: null,
      createdAt: new Date().toISOString(),
    });
  }

  return NextResponse.json({ success: true, message: "Reported. A coach will review it." });
}
