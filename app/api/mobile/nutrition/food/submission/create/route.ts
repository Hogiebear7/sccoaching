import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  createFoodSubmission,
  findFoodById,
  findFoodSubmissionByCustomFoodId,
  findUserById,
  type FoodSubmissionRecord,
} from "@/lib/db";
import { getFoodSubmissionEligibility } from "@/lib/food-submission";
import { isValidImageDataUrl } from "@/lib/image-upload";
import { verifyRequestSession } from "@/lib/mobile-auth";

// A photo can reasonably be a fuller-resolution shot than the tiny cover
// images image-upload.ts's default cap targets — mirrors label-scan's cap.
const MAX_SUBMISSION_PHOTO_LENGTH = 3_000_000;

// A resubmission is only allowed once the prior attempt reached a terminal
// non-live state (rejected/failed) — anything still in flight blocks a
// duplicate rather than silently creating a second competing record.
const BLOCKING_STATUSES: FoodSubmissionRecord["status"][] = ["pending_review", "approved", "submitted_to_open_food_facts"];

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

  const { customFoodId, consent, frontPhotoUrl, labelPhotoUrl } = (body ?? {}) as Record<string, unknown>;

  if (typeof customFoodId !== "string" || !customFoodId.trim()) {
    return NextResponse.json({ success: false, message: "customFoodId is required." }, { status: 400 });
  }
  if (consent !== true) {
    return NextResponse.json({ success: false, message: "Explicit consent is required to submit this food publicly." }, { status: 400 });
  }

  const food = findFoodById("custom", customFoodId);
  if (!food || food.ownerUserId !== user.id) {
    return NextResponse.json({ success: false, message: "Custom food not found." }, { status: 404 });
  }

  const { eligibility, missingFields } = getFoodSubmissionEligibility(food);
  if (eligibility !== "eligible_for_submission") {
    return NextResponse.json(
      { success: false, message: `This food is missing required fields for submission: ${missingFields.join(", ")}.` },
      { status: 400 }
    );
  }

  const existing = findFoodSubmissionByCustomFoodId(customFoodId);
  if (existing && BLOCKING_STATUSES.includes(existing.status)) {
    return NextResponse.json({ success: false, message: `This food already has a submission in progress (${existing.status}).` }, { status: 400 });
  }

  let cleanFrontPhotoUrl: string | null = null;
  if (frontPhotoUrl !== undefined && frontPhotoUrl !== null) {
    if (typeof frontPhotoUrl !== "string" || !isValidImageDataUrl(frontPhotoUrl, MAX_SUBMISSION_PHOTO_LENGTH)) {
      return NextResponse.json({ success: false, message: "Front photo is invalid or too large." }, { status: 400 });
    }
    cleanFrontPhotoUrl = frontPhotoUrl;
  }

  let cleanLabelPhotoUrl: string | null = null;
  if (labelPhotoUrl !== undefined && labelPhotoUrl !== null) {
    if (typeof labelPhotoUrl !== "string" || !isValidImageDataUrl(labelPhotoUrl, MAX_SUBMISSION_PHOTO_LENGTH)) {
      return NextResponse.json({ success: false, message: "Label photo is invalid or too large." }, { status: 400 });
    }
    cleanLabelPhotoUrl = labelPhotoUrl;
  }

  const now = new Date().toISOString();
  const submission: FoodSubmissionRecord = {
    id: randomUUID(),
    userId: user.id,
    customFoodId,
    status: "pending_review",
    consentGiven: true,
    consentedAt: now,
    frontPhotoUrl: cleanFrontPhotoUrl,
    labelPhotoUrl: cleanLabelPhotoUrl,
    reviewedByStaffId: null,
    reviewedAt: null,
    reviewNote: null,
    offProductId: null,
    submittedAt: null,
    failureReason: null,
    createdAt: now,
    updatedAt: now,
  };

  createFoodSubmission(submission);

  return NextResponse.json({ success: true, message: "Submitted for review.", data: submission }, { status: 201 });
}
