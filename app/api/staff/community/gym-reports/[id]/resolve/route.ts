import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { sameGymId } from "@/lib/community-gym";
import { closeGroup, findGymCommentById, findGymReportById, removeGymComment, removeGymPost, resolveGymReport } from "@/lib/db";
import { authorizeStaffRequest } from "@/lib/staff-auth";

// POST /api/staff/community/gym-reports/[id]/resolve — { action: "resolve" | "dismiss" } (capability comments.moderate). resolve removes the reported
// post or comment (or closes the reported group) and closes the report; dismiss closes it with no action. A report from another gym, or one already closed,
// reads as "not found".
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const auth = authorizeStaffRequest(request, "comments.moderate", { allowAppToken: true });
  if (!auth.ok) return auth.response;

  const action = (body as { action?: unknown } | null)?.action;
  if (action !== "resolve" && action !== "dismiss") {
    return NextResponse.json({ success: false, message: "Invalid action." }, { status: 400 });
  }

  const report = findGymReportById(id);
  if (!report || report.status !== "open" || !sameGymId(report.gymId, auth.user.gymId)) {
    return NextResponse.json({ success: false, message: "Report not found." }, { status: 404 });
  }

  const now = new Date().toISOString();
  if (action === "resolve") {
    if (report.targetType === "post") removeGymPost(report.targetId, auth.user.id, now);
    else if (report.targetType === "group") closeGroup(report.targetId, now);
    else if (findGymCommentById(report.targetId)) removeGymComment(report.targetId, now);
  }
  resolveGymReport(report.id, action === "resolve" ? "resolved" : "dismissed", auth.user.id, now);

  return NextResponse.json({ success: true, message: action === "resolve" ? "Removed." : "Dismissed." });
}
