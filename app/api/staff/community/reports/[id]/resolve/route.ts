import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  deleteComment,
  findCommentById,
  findCommentReportById,
  findUserById,
  findWorkoutSessionById,
  saveCommentReport,
  saveWorkoutSession,
} from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { authorizeStaffRequest } from "@/lib/staff-auth";

// POST /api/staff/community/reports/[id]/resolve — { action: "resolve" | "dismiss" }
// resolve = remove the reported comment and mark the report resolved;
// dismiss = no action taken, just closes the report. Mirrors
// app/api/staff/bug-reports/status/route.ts's shape exactly.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authorizeStaffRequest(request, "comments.moderate");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { action } = (body ?? {}) as Record<string, unknown>;
  if (action !== "resolve" && action !== "dismiss") {
    return NextResponse.json({ success: false, message: "Invalid action." }, { status: 400 });
  }

  const report = findCommentReportById(id);
  if (!report) {
    return NextResponse.json({ success: false, message: "Report not found." }, { status: 404 });
  }

  // Report ownership is resolved through the underlying content, never the
  // reporter: commentId -> workoutSessionId -> the session owner's verified
  // gymId. A comment or session that no longer exists means ownership can't
  // be verified safely — fail closed into the same not-found response as a
  // genuinely missing report, rather than assume same-gym.
  // A reported workout post (targetType "workout") resolves through its workoutSessionId the same way.
  const isWorkoutReport = report.targetType === "workout";
  const comment = isWorkoutReport ? undefined : findCommentById(report.commentId);
  const session = isWorkoutReport
    ? report.workoutSessionId
      ? findWorkoutSessionById(report.workoutSessionId)
      : undefined
    : comment
      ? findWorkoutSessionById(comment.workoutSessionId)
      : undefined;
  const owner = session ? findUserById(session.userId) : undefined;
  if (!owner || !sameGym(auth.user, owner)) {
    return NextResponse.json({ success: false, message: "Report not found." }, { status: 404 });
  }

  const now = new Date().toISOString();
  if (action === "resolve") {
    if (isWorkoutReport) {
      // Takes the workout out of Community for good; it stays in the owner's own history and they can't re-share it.
      if (session) saveWorkoutSession({ ...session, communityRemovedAt: now, updatedAt: now });
    } else {
      deleteComment(report.commentId);
    }
  }

  saveCommentReport({
    ...report,
    status: action === "resolve" ? "resolved" : "dismissed",
    resolvedByStaffId: auth.user.id,
    resolvedAt: now,
  });

  return NextResponse.json({
    success: true,
    message: action === "resolve" ? (isWorkoutReport ? "Workout removed from Community." : "Comment removed.") : "Dismissed.",
  });
}
