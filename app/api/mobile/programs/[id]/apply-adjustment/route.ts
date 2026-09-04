import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findTrainingProgramById, findUserById, saveTrainingProgram, type TrainingProgramRecord } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { applyProgrammeAdjustment } from "@/lib/training-programs";
import { trimSyncedProgrammeSessionsToWeeks } from "@/lib/programme-weekly-sync";

// POST /api/mobile/programs/[id]/apply-adjustment
// Body: { cycleIndex: number, decision: "accept" | "decline" }
// Idempotent — once a check-in entry's adjustmentDecision is set, a second
// call for the same cycle is a no-op (never re-applies or reverses it).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { cycleIndex, decision } = (body ?? {}) as Record<string, unknown>;
  if (!Number.isInteger(cycleIndex) || (decision !== "accept" && decision !== "decline")) {
    return NextResponse.json({ success: false, message: "cycleIndex and decision are required." }, { status: 400 });
  }

  const program = findTrainingProgramById(id);
  if (!program || program.userId !== user.id) {
    return NextResponse.json({ success: false, message: "Programme not found." }, { status: 404 });
  }

  const checkIns = program.checkIns ?? [];
  const entryIndex = checkIns.findIndex((c) => c.cycleIndex === cycleIndex);
  if (entryIndex === -1) {
    return NextResponse.json({ success: false, message: "Check-in not found." }, { status: 404 });
  }

  const entry = checkIns[entryIndex];
  if (entry.adjustmentDecision !== null) {
    // Already decided — return the programme untouched rather than
    // re-applying or reversing a prior decision.
    return NextResponse.json({ success: true, message: "Already decided.", data: { program } });
  }
  if (decision === "accept" && !entry.adjustmentProposal) {
    return NextResponse.json({ success: false, message: "This check-in has no proposal to accept." }, { status: 400 });
  }

  const updatedCheckIns = [...checkIns];
  updatedCheckIns[entryIndex] = { ...entry, adjustmentDecision: decision === "accept" ? "accepted" : "declined" };

  let updatedProgram: TrainingProgramRecord = { ...program, checkIns: updatedCheckIns };

  if (decision === "accept" && entry.adjustmentProposal) {
    updatedProgram = applyProgrammeAdjustment(
      updatedProgram,
      entry.adjustmentProposal.type,
      entry.adjustmentProposal.proposedTotalWeeks
    );
    if (entry.adjustmentProposal.type === "expedite_timeline" && updatedProgram.totalWeeks) {
      trimSyncedProgrammeSessionsToWeeks(user.id, program.id, updatedProgram.totalWeeks);
    }
  }

  saveTrainingProgram({ ...updatedProgram, updatedAt: new Date().toISOString() });

  return NextResponse.json({ success: true, message: "Done.", data: { program: updatedProgram } });
}
