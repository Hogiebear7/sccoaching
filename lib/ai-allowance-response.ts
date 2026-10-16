import { NextResponse } from "next/server";

import { AI_ALLOWANCE_CODE, AI_ALLOWANCE_UNAVAILABLE_CODE, checkAiAllowance } from "@/lib/ai-allowance";
import { AiAllowanceError, AiRequestTooLargeError } from "@/lib/ai-metering";

// The one line each member-facing AI route adds: null to carry on, or the response to return. The provider is never called when this refuses. It is the
// friendly answer; the atomic reservation in lib/ai-metering.ts is the guarantee.
export function aiAllowanceRefusal(userId: string): NextResponse | null {
  const result = checkAiAllowance(userId);
  if (result.ok) return null;
  if (result.reason === "unavailable") {
    return NextResponse.json({ success: false, code: AI_ALLOWANCE_UNAVAILABLE_CODE, message: result.message }, { status: 503 });
  }
  return NextResponse.json({ success: false, code: AI_ALLOWANCE_CODE, kind: result.kind, message: result.message, resetsAt: result.resetsAt }, { status: 429 });
}

// For a route's catch block. The pre-check above is the friendly answer, but the atomic reservation inside the AI call is the guarantee, so when two requests
// race past the pre-check one of them is refused there. This turns that refusal (or an oversized request) into the same response instead of a generic failure.
export function aiFailureResponse(error: unknown): NextResponse | null {
  if (error instanceof AiAllowanceError) {
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
