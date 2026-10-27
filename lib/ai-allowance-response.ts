import { NextResponse } from "next/server";

import { AI_ALLOWANCE_CODE, AI_ALLOWANCE_UNAVAILABLE_CODE, AI_PAUSED_CODE, AI_UPGRADE_CODE, checkAiAllowance } from "@/lib/ai-allowance";
import { AiAllowanceError, AiRequestTooLargeError } from "@/lib/ai-metering";
import { checkRateLimit } from "@/lib/rate-limit";

// The one line each member-facing AI route adds: null to carry on, or the response to return. The provider is never called when this refuses. It is the
// friendly answer; the atomic reservation in lib/ai-metering.ts is the guarantee.
/** Every member AI request counts towards one limit per member, across all AI features (owner decision 2026-10-27), on top of each feature's own. */
export const AI_REQUESTS_PER_MINUTE = 10;
export const AI_RATE_LIMITED_CODE = "ai_rate_limited";

export function aiAllowanceRefusal(userId: string): NextResponse | null {
  const rate = checkRateLimit(`ai-any:${userId}`, AI_REQUESTS_PER_MINUTE, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, code: AI_RATE_LIMITED_CODE, message: "One moment: AI coaching will be ready again in a minute." },
      { status: 429 }
    );
  }
  const result = checkAiAllowance(userId);
  if (result.ok) return null;
  // A free member's feature that is part of the subscription: a plain "403 needs the subscription", the same shape as every other plan gate.
  if (result.reason === "upgrade") {
    return NextResponse.json({ success: false, code: AI_UPGRADE_CODE, message: result.message }, { status: 403 });
  }
  if (result.reason === "paused") {
    return NextResponse.json({ success: false, code: AI_PAUSED_CODE, message: result.message }, { status: 403 });
  }
  if (result.reason === "unavailable") {
    return NextResponse.json({ success: false, code: AI_ALLOWANCE_UNAVAILABLE_CODE, message: result.message }, { status: 503 });
  }
  return NextResponse.json({ success: false, code: AI_ALLOWANCE_CODE, kind: result.kind, message: result.message, resetsAt: result.resetsAt }, { status: 429 });
}

// For a route's catch block. The pre-check above is the friendly answer, but the atomic reservation inside the AI call is the guarantee, so when two requests
// race past the pre-check one of them is refused there. This turns that refusal (or an oversized request) into the same response instead of a generic failure.
export function aiFailureResponse(error: unknown): NextResponse | null {
  if (error instanceof AiAllowanceError) {
    if (error.code === AI_UPGRADE_CODE) {
      return NextResponse.json({ success: false, code: error.code, message: error.message }, { status: 403 });
    }
    if (error.code === AI_ALLOWANCE_UNAVAILABLE_CODE) {
      return NextResponse.json({ success: false, code: error.code, message: error.message }, { status: 503 });
    }
    return NextResponse.json({ success: false, code: error.code, kind: error.kind, message: error.message, resetsAt: error.resetsAt }, { status: 429 });
  }
  if (error instanceof AiRequestTooLargeError) {
    return NextResponse.json({ success: false, code: "ai_request_too_large", message: error.message }, { status: 413 });
  }
  return null;
}
