import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { generateProgrammeCheckIn, isAiConfigured } from "@/lib/ai";
import { aiAllowanceRefusal, aiFailureResponse } from "@/lib/ai-allowance-response";
import { requireAiConsent } from "@/lib/ai-consent";
import { findTrainingProgramById, findUserById, findWorkoutSessionsByUserId, updateTrainingProgram } from "@/lib/db";
import { buildProgrammeCheckInData, formatProgrammeCheckInContext } from "@/lib/programme-checkin";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { isExerciseRefreshEligible } from "@/lib/training-programs";

// GET /api/mobile/programs/[id]/checkin/[cycle]
// Same lazy-generate-and-cache shape as workout-review/[id] — the check-in
// for a given completed cycle is generated once, on first open, then read
// from the stored record on every later open (no repeat AI calls for the
// same cycle).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; cycle: string }> }) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const { id, cycle } = await params;
  const cycleIndex = Number(cycle);
  if (!Number.isInteger(cycleIndex) || cycleIndex < 0) {
    return NextResponse.json({ success: false, message: "Invalid cycle." }, { status: 400 });
  }

  const program = findTrainingProgramById(id);
  if (!program || program.userId !== user.id) {
    return NextResponse.json({ success: false, message: "Programme not found." }, { status: 404 });
  }
  if ((program.completedCycles ?? 0) <= cycleIndex) {
    return NextResponse.json({ success: false, message: "That cycle hasn't completed yet." }, { status: 400 });
  }

  const existing = (program.checkIns ?? []).find((c) => c.cycleIndex === cycleIndex);
  if (existing) {
    return NextResponse.json({ success: true, configured: true, data: existing });
  }

  if (!isAiConfigured()) {
    return NextResponse.json(
      { success: false, configured: false, message: "Check-ins aren't available right now." },
      { status: 503 }
    );
  }

  // Nothing is read from the request or sent to the AI provider until this member has allowed it (lib/ai-consent.ts).
  const consentRequired = requireAiConsent(user.id);
  if (consentRequired) return consentRequired;

  // Each AI call is metered against the member's allowance (lib/ai-allowance.ts); this is the friendly early answer, before any work is done.
  const allowanceRefusal = aiAllowanceRefusal(user.id);
  if (allowanceRefusal) return allowanceRefusal;

  try {
    const sessions = findWorkoutSessionsByUserId(user.id);
    const checkInData = buildProgrammeCheckInData(program, sessions, cycleIndex);
    const refreshEligible = isExerciseRefreshEligible(cycleIndex + 1, program.totalWeeks ?? null);
    const result = await generateProgrammeCheckIn(
      formatProgrammeCheckInContext(checkInData),
      program.totalWeeks ?? null,
      user.id,
      refreshEligible
    );

    if (!result) {
      return NextResponse.json(
        { success: false, configured: true, message: "Couldn't generate your check-in right now. Please try again." },
        { status: 502 }
      );
    }

    const entry = {
      cycleIndex,
      generatedAt: new Date().toISOString(),
      feedbackText: result.feedbackText,
      adjustmentProposal: result.adjustmentProposal,
      adjustmentDecision: null as "accepted" | "declined" | null,
      exerciseRefreshProposal: result.exerciseRefreshProposal,
      exerciseRefreshDecision: null as "accepted" | "declined" | null,
    };

    // Generating took a while (AI call): append to the programme as it is NOW, and if another request already stored this cycle's check-in, return that one.
    let stored: typeof entry = entry;
    updateTrainingProgram(program.id, (current) => {
      const already = (current.checkIns ?? []).find((ci) => ci.cycleIndex === cycleIndex);
      if (already) {
        stored = already as typeof entry;
        return null;
      }
      return { ...current, checkIns: [...(current.checkIns ?? []), entry], updatedAt: new Date().toISOString() };
    });

    return NextResponse.json({ success: true, configured: true, data: stored });
  } catch (err) {
    const refused = aiFailureResponse(err);
    if (refused) return refused;
    console.error(`[programs/checkin] generation failed for user ${user.id}, program ${id}, cycle ${cycleIndex}:`, err);
    return NextResponse.json(
      { success: false, configured: true, message: "Couldn't generate your check-in right now. Please try again." },
      { status: 502 }
    );
  }
}
