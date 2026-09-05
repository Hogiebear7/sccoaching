import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findTrainingProgramById,
  findUserById,
  findWorkoutSessionsByUserId,
  saveTrainingProgram,
  type TrainingProgramRecord,
} from "@/lib/db";
import { getExerciseLibraryClient } from "@/lib/exercise-library/admin-client";
import { mapExerciseRow } from "@/lib/exercise-library/mappers";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { applyExerciseRefresh, applyProgrammeAdjustment } from "@/lib/training-programs";
import { trimSyncedProgrammeSessionsToWeeks } from "@/lib/programme-weekly-sync";

// POST /api/mobile/programs/[id]/apply-adjustment
// Body: { cycleIndex: number, kind?: "adjustment" | "refresh", decision: "accept" | "decline" }
// kind defaults to "adjustment" for older clients that predate the
// exercise-refresh proposal — the two are independent decisions (a check-in
// can offer both the same cycle), each with its own idempotent
// accepted/declined flag on the stored check-in entry.
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
  const kind = (body as Record<string, unknown>).kind === "refresh" ? "refresh" : "adjustment";
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

  if (kind === "refresh") {
    if (entry.exerciseRefreshDecision !== null) {
      return NextResponse.json({ success: true, message: "Already decided.", data: { program } });
    }
    if (decision === "accept" && !entry.exerciseRefreshProposal) {
      return NextResponse.json({ success: false, message: "This check-in has no refresh to accept." }, { status: 400 });
    }

    const updatedCheckIns = [...checkIns];
    updatedCheckIns[entryIndex] = { ...entry, exerciseRefreshDecision: decision === "accept" ? "accepted" : "declined" };
    let updatedProgram: TrainingProgramRecord = { ...program, checkIns: updatedCheckIns };

    if (decision === "accept") {
      const { data, error } = await getExerciseLibraryClient().from("exercises").select("*").eq("approved", true).limit(500);
      if (error) {
        console.error("[apply-adjustment] exercise library fetch failed:", error);
        return NextResponse.json({ success: false, message: "Could not load the exercise library." }, { status: 500 });
      }
      const libraryExercises = (data ?? []).map(mapExerciseRow);
      const sessions = findWorkoutSessionsByUserId(user.id);
      updatedProgram = applyExerciseRefresh(updatedProgram, libraryExercises, program.aiMeta?.equipmentSlugs ?? [], sessions);
    }

    saveTrainingProgram({ ...updatedProgram, updatedAt: new Date().toISOString() });
    return NextResponse.json({ success: true, message: "Done.", data: { program: updatedProgram } });
  }

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
