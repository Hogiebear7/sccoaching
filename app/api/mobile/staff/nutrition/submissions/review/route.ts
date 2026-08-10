import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findFoodById, findFoodSubmissionById, findUserById, saveFoodSubmission, type FoodSubmissionRecord } from "@/lib/db";
import { mapFoodToOffSubmissionPayload } from "@/lib/food-submission";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { isOffLiveWriteEnabled, offSubmissionProvider } from "@/lib/open-food-facts-client";
import { can } from "@/lib/permissions";

const DECISIONS: Array<"approved" | "rejected"> = ["approved", "rejected"];

// body: { id, decision: "approved" | "rejected", note?: string }
//
// "approved" is the terminal state in this deployment: no OFF producer
// credentials exist, so isOffLiveWriteEnabled() is always false here. If a
// future deployment enables it, approving additionally attempts the live
// write and the record moves on to "submitted_to_open_food_facts" / "failed"
// — see docs/food-catalog.md for the config flag and provider seam.
export async function POST(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;
  const staffUser = sessionUserId ? findUserById(sessionUserId) : undefined;

  if (!staffUser) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  if (!can(staffUser.role, "foodCatalog.manage")) {
    return NextResponse.json({ success: false, message: "Staff access required." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { id, decision, note } = (body ?? {}) as Record<string, unknown>;

  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ success: false, message: "id is required." }, { status: 400 });
  }
  if (typeof decision !== "string" || !DECISIONS.includes(decision as "approved" | "rejected")) {
    return NextResponse.json({ success: false, message: "decision must be 'approved' or 'rejected'." }, { status: 400 });
  }

  const existing = findFoodSubmissionById(id);
  if (!existing) {
    return NextResponse.json({ success: false, message: "Submission not found." }, { status: 404 });
  }
  if (existing.status !== "pending_review") {
    return NextResponse.json({ success: false, message: `This submission is already ${existing.status}.` }, { status: 400 });
  }

  const now = new Date().toISOString();
  const reviewNote = typeof note === "string" && note.trim() ? note.trim().slice(0, 500) : null;

  if (decision === "rejected") {
    saveFoodSubmission({
      ...existing,
      status: "rejected",
      reviewedByStaffId: staffUser.id,
      reviewedAt: now,
      reviewNote,
      updatedAt: now,
    });
    return NextResponse.json({ success: true, message: "Submission rejected." }, { status: 200 });
  }

  // Approved — attempt a live OFF write only if explicitly enabled.
  let updated: FoodSubmissionRecord = {
    ...existing,
    status: "approved",
    reviewedByStaffId: staffUser.id,
    reviewedAt: now,
    reviewNote,
    updatedAt: now,
  };

  if (isOffLiveWriteEnabled()) {
    const food = findFoodById("custom", existing.customFoodId);
    if (food) {
      try {
        const payload = mapFoodToOffSubmissionPayload(food, {
          frontPhotoUrl: existing.frontPhotoUrl,
          labelPhotoUrl: existing.labelPhotoUrl,
        });
        const result = await offSubmissionProvider.submit(payload);
        if (result.ok) {
          updated = { ...updated, status: "submitted_to_open_food_facts", offProductId: result.offProductId, submittedAt: now, updatedAt: now };
        } else {
          console.error(`[food-catalog] OFF live write failed for submission ${existing.id}: ${result.reason}`);
          updated = { ...updated, status: "failed", failureReason: result.reason, updatedAt: now };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error(`[food-catalog] OFF live write threw for submission ${existing.id}: ${message}`);
        updated = { ...updated, status: "failed", failureReason: message, updatedAt: now };
      }
    }
  }

  saveFoodSubmission(updated);

  return NextResponse.json({ success: true, message: "Submission approved.", data: updated }, { status: 200 });
}
