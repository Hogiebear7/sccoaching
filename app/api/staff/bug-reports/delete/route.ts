// TRIAL-ONLY — see docs/bug-reports.md for the full removal checklist.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { deleteBugReport, findBugReportById, findUserById } from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { authorizeStaffRequest } from "@/lib/staff-auth";

export async function POST(request: NextRequest) {
  const auth = authorizeStaffRequest(request, "bugReports.manage");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { id } = (body ?? {}) as Record<string, unknown>;

  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ success: false, message: "id is required." }, { status: 400 });
  }

  // Ownership: report -> reporter -> gym. A cross-gym report (or one whose
  // reporter can't be resolved) gets the same not-found response as a missing
  // one, before any write.
  const report = findBugReportById(id);
  const reporter = report ? findUserById(report.userId) : undefined;
  if (!report || !reporter || !sameGym(auth.user, reporter)) {
    return NextResponse.json({ success: false, message: "Report not found." }, { status: 404 });
  }

  deleteBugReport(id);

  return NextResponse.json({ success: true, message: "Report deleted." }, { status: 200 });
}
