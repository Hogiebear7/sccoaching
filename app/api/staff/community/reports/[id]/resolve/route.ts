import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { deleteComment, findCommentReportById, saveCommentReport } from "@/lib/db";
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

  if (action === "resolve") {
    deleteComment(report.commentId);
  }

  saveCommentReport({
    ...report,
    status: action === "resolve" ? "resolved" : "dismissed",
    resolvedByStaffId: auth.user.id,
    resolvedAt: new Date().toISOString(),
  });

  return NextResponse.json({ success: true, message: action === "resolve" ? "Comment removed." : "Dismissed." });
}
