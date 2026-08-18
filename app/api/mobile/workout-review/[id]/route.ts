import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById, findWorkoutSessionById, saveWorkoutSession } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { generateWorkoutReview } from "@/lib/ai";
import { buildWorkoutReviewData } from "@/lib/workout-review";

// Session review for one already-logged workout — deterministic comparison
// stats (computed fresh every time, cheap) plus an AI narrative paragraph
// (generated once, cached on the session record, since the underlying data
// it's grounded in doesn't change after logging).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  }

  const { id } = await params;
  const session = findWorkoutSessionById(id);

  if (!session || session.userId !== user.id) {
    return NextResponse.json({ success: false, message: "This workout doesn't exist." }, { status: 404 });
  }

  const reviewData = buildWorkoutReviewData(user.id, session);

  let reviewText = session.reviewText ?? null;
  if (!reviewText) {
    reviewText = await generateWorkoutReview(reviewData);
    saveWorkoutSession({ ...session, reviewText, reviewGeneratedAt: new Date().toISOString() });
  }

  return NextResponse.json({
    success: true,
    data: {
      comparison: reviewData.comparison,
      recovery: reviewData.recovery,
      cyclePhase: reviewData.cyclePhase,
      nutrition: reviewData.nutrition,
      hydration: reviewData.hydration,
      reviewText,
    },
  });
}
