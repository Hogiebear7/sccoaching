// TRIAL-ONLY — see docs/bug-reports.md for the full removal checklist.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findBugReportById, saveBugReport, type BugReportStatus } from "@/lib/db";
import { authorizeStaffRequest } from "@/lib/staff-auth";

const VALID_STATUSES: BugReportStatus[] = ["open", "resolved"];

export async function POST(request: NextRequest) {
  const auth = authorizeStaffRequest(request, "bugReports.manage");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { id, status } = (body ?? {}) as Record<string, unknown>;

  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ success: false, message: "id is required." }, { status: 400 });
  }
  if (typeof status !== "string" || !VALID_STATUSES.includes(status as BugReportStatus)) {
    return NextResponse.json({ success: false, message: "Invalid status." }, { status: 400 });
  }

  const report = findBugReportById(id);
  if (!report) {
    return NextResponse.json({ success: false, message: "Report not found." }, { status: 404 });
  }

  saveBugReport({ ...report, status: status as BugReportStatus, updatedAt: new Date().toISOString() });

  return NextResponse.json(
    { success: true, message: status === "resolved" ? "Marked resolved." : "Reopened." },
    { status: 200 }
  );
}
