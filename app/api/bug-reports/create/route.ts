// TRIAL-ONLY — see docs/bug-reports.md for the full removal checklist.
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createBugReport, findUserById, type BugReportRecord } from "@/lib/db";
import { isValidImageDataUrl } from "@/lib/image-upload";
import { verifySession } from "@/lib/session";

const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_SCREENSHOTS = 3;

export async function POST(request: NextRequest) {
  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to report a bug." },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { description, screenshots } = (body ?? {}) as Record<string, unknown>;

  if (typeof description !== "string" || !description.trim()) {
    return NextResponse.json(
      { success: false, message: "Describe the bug before submitting." },
      { status: 400 }
    );
  }
  if (description.trim().length > MAX_DESCRIPTION_LENGTH) {
    return NextResponse.json(
      { success: false, message: `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters.` },
      { status: 400 }
    );
  }

  let cleanScreenshots: string[] = [];
  if (screenshots !== undefined) {
    if (!Array.isArray(screenshots) || screenshots.length > MAX_SCREENSHOTS) {
      return NextResponse.json(
        { success: false, message: `Attach up to ${MAX_SCREENSHOTS} screenshots.` },
        { status: 400 }
      );
    }
    if (!screenshots.every((s) => typeof s === "string" && isValidImageDataUrl(s))) {
      return NextResponse.json(
        { success: false, message: "One of those screenshots is invalid or too large." },
        { status: 400 }
      );
    }
    cleanScreenshots = screenshots;
  }

  const now = new Date().toISOString();
  const report: BugReportRecord = {
    id: randomUUID(),
    userId: user.id,
    description: description.trim(),
    screenshots: cleanScreenshots,
    status: "open",
    createdAt: now,
    updatedAt: now,
  };

  createBugReport(report);

  return NextResponse.json(
    { success: true, message: "Thanks — your report's been logged." },
    { status: 200 }
  );
}
