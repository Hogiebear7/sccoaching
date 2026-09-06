import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findTrainingProgramById, findUserById, saveTrainingProgram } from "@/lib/db";
import { exerciseMatchesEquipmentSlugs } from "@/lib/equipment-matching";
import { getExerciseLibraryClient } from "@/lib/exercise-library/admin-client";
import { mapExerciseRow } from "@/lib/exercise-library/mappers";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { replaceProgramDayExercise } from "@/lib/training-programs";

// POST /api/mobile/programs/[id]/exercises/[exerciseId]/swap
// Body: { dayId: string, newExerciseId: string }
// Commits a swap the member picked from the alternatives route above —
// re-validates newExerciseId against the real, approved exercise library and
// the programme's own equipment rather than trusting the client's earlier
// alternatives response, since a client-supplied id is never trusted as-is.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; exerciseId: string }> }) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const { id, exerciseId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { dayId, newExerciseId } = (body ?? {}) as Record<string, unknown>;
  if (typeof dayId !== "string" || !dayId.trim() || typeof newExerciseId !== "string" || !newExerciseId.trim()) {
    return NextResponse.json({ success: false, message: "dayId and newExerciseId are required." }, { status: 400 });
  }

  const program = findTrainingProgramById(id);
  if (!program || program.userId !== user.id) {
    return NextResponse.json({ success: false, message: "Programme not found." }, { status: 404 });
  }
  if (program.status !== "active" || (program.source ?? "staff") !== "ai") {
    return NextResponse.json(
      { success: false, message: "Exercise swaps are only available on an active AI programme." },
      { status: 400 }
    );
  }

  const { data, error } = await getExerciseLibraryClient()
    .from("exercises")
    .select("*")
    .eq("id", newExerciseId)
    .eq("approved", true)
    .limit(1);
  if (error) {
    console.error("[exercise-swap] exercise library fetch failed:", error);
    return NextResponse.json({ success: false, message: "Could not load the exercise library." }, { status: 500 });
  }
  const newExercise = (data ?? []).map(mapExerciseRow)[0];
  if (!newExercise || !exerciseMatchesEquipmentSlugs(newExercise.equipment, program.aiMeta?.equipmentSlugs ?? [])) {
    return NextResponse.json({ success: false, message: "That exercise isn't available for this programme." }, { status: 400 });
  }

  const updated = replaceProgramDayExercise(program, dayId, exerciseId, newExercise);
  if (updated === program) {
    return NextResponse.json({ success: false, message: "Exercise not found." }, { status: 404 });
  }

  saveTrainingProgram(updated);
  return NextResponse.json({ success: true, message: "Done.", data: { program: updated } });
}
