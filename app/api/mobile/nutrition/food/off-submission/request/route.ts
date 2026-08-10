import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createFoodOffSubmission, findFoodById, findUserById, type FoodOffSubmissionRecord } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// Starts the (consent-gated) workflow to publish a member's own custom food
// to Open Food Facts — this only records intent as "pending_consent"; see
// .../off-submission/consent for the step that actually queues it, and
// docs/food-catalog.md for why the queue never drains automatically yet
// (no OFF producer credentials are configured in this deployment).
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

  const { customFoodId } = (body ?? {}) as Record<string, unknown>;
  if (typeof customFoodId !== "string" || !customFoodId.trim()) {
    return NextResponse.json({ success: false, message: "customFoodId is required." }, { status: 400 });
  }

  const food = findFoodById("custom", customFoodId);
  if (!food || food.ownerUserId !== user.id) {
    return NextResponse.json({ success: false, message: "Custom food not found." }, { status: 404 });
  }
  if (!food.barcode) {
    return NextResponse.json({ success: false, message: "Only a custom food with a barcode can be submitted to Open Food Facts." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const submission: FoodOffSubmissionRecord = {
    id: randomUUID(),
    userId: user.id,
    customFoodId,
    status: "pending_consent",
    consentedAt: null,
    submittedAt: null,
    failureReason: null,
    createdAt: now,
    updatedAt: now,
  };

  createFoodOffSubmission(submission);

  return NextResponse.json({ success: true, message: "Confirm consent to continue.", data: submission }, { status: 201 });
}
