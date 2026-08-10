import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findFoodOffSubmissionById, findUserById, saveFoodOffSubmission } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// Explicit consent step — flips a submission from "pending_consent" to
// "queued". Nothing actually reaches Open Food Facts from here: this repo
// has no OFF producer credentials, so "queued" is where the workflow stops
// until a real submission job exists (see docs/food-catalog.md). Recording
// consent now means that job can drain the queue later without needing to
// re-ask every member who already agreed.
export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { submissionId } = (body ?? {}) as Record<string, unknown>;
  if (typeof submissionId !== "string" || !submissionId.trim()) {
    return NextResponse.json({ success: false, message: "submissionId is required." }, { status: 400 });
  }

  const existing = findFoodOffSubmissionById(submissionId);
  if (!existing || existing.userId !== user.id) {
    return NextResponse.json({ success: false, message: "Submission not found." }, { status: 404 });
  }
  if (existing.status !== "pending_consent") {
    return NextResponse.json({ success: false, message: `This submission is already ${existing.status}.` }, { status: 400 });
  }

  const now = new Date().toISOString();
  const updated = { ...existing, status: "queued" as const, consentedAt: now, updatedAt: now };
  saveFoodOffSubmission(updated);

  return NextResponse.json({ success: true, message: "Queued for submission to Open Food Facts.", data: updated }, { status: 200 });
}
