import { NextResponse } from "next/server";
import { AI_UNAVAILABLE_CODE, AI_UNAVAILABLE_MESSAGE } from "@/lib/ai-stream";
import type { NextRequest } from "next/server";

import { findUserById, findWorkoutSessionById, updateWorkoutSession } from "@/lib/db";
import { hasAccess } from "@/lib/member-access";
import { aiAllowanceRefusal, aiFailureResponse } from "@/lib/ai-allowance-response";
import { resolveMemberAccessForUser } from "@/lib/membership-entitlement";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { generateWorkoutReview } from "@/lib/ai";
import { hasAiConsent } from "@/lib/ai-consent";
import { buildWorkoutReviewData } from "@/lib/workout-review";
import { computeWorkoutScore, WORKOUT_SCORE_ENABLED } from "@/lib/workout-score";

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

  if (!hasAccess(resolveMemberAccessForUser(user.id), "workoutReview")) {
    return NextResponse.json({ success: false, message: "Workout review needs the App Subscription." }, { status: 403 });
  }

  const { id } = await params;
  const session = findWorkoutSessionById(id);

  if (!session || session.userId !== user.id) {
    return NextResponse.json({ success: false, message: "This workout doesn't exist." }, { status: 404 });
  }

  const reviewData = buildWorkoutReviewData(user.id, session);

  let reviewText = session.reviewText ?? null;
  // A review already generated and stored is shown. A new one is only requested from the AI provider if this member has allowed it; the comparison below is always returned.
  const aiConsentRequired = !reviewText && !hasAiConsent(user.id);
  if (!reviewText && !aiConsentRequired) {
    // A bounded AI allowance, checked before anything is sent to the provider (lib/ai-allowance.ts). A review that is already stored is never blocked by it.
    const allowanceRefusal = aiAllowanceRefusal(user.id);
    if (allowanceRefusal) return allowanceRefusal;
    try {
      reviewText = await generateWorkoutReview(reviewData);
    } catch (err) {
      const refused = aiFailureResponse(err);
      if (refused) return refused;
      console.error("Workout review failed:", err);
      return NextResponse.json({ success: false, code: AI_UNAVAILABLE_CODE, message: AI_UNAVAILABLE_MESSAGE }, { status: 502 });
    }
    // The AI call above can take seconds: set only the review fields on the session as it is NOW, so an edit made meanwhile is not overwritten.
    updateWorkoutSession(session.id, () => ({ reviewText, reviewGeneratedAt: new Date().toISOString() }));
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
      aiConsentRequired,
      // Computed fresh every request (cheap, deterministic) — unlike
      // reviewText it's never cached, so flipping WORKOUT_SCORE_ENABLED on
      // later doesn't require regenerating anything for existing sessions.
      score: WORKOUT_SCORE_ENABLED ? computeWorkoutScore(reviewData) : undefined,
    },
  });
}
