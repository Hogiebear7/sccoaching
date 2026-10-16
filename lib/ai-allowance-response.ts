import { NextResponse } from "next/server";

import { AI_ALLOWANCE_CODE, checkAiAllowance } from "@/lib/ai-allowance";

// The one line each AI route adds after its tier check: null to carry on, or the 429 to return. The provider is never called when this refuses.
export function aiAllowanceRefusal(userId: string): NextResponse | null {
  const result = checkAiAllowance(userId);
  if (result.ok) return null;
  return NextResponse.json({ success: false, code: AI_ALLOWANCE_CODE, message: result.message, resetsAt: result.resetsAt }, { status: 429 });
}
