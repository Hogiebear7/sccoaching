import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { generateExerciseAlternatives, isAiConfigured } from "@/lib/ai";
import { findTrainingProgramById, findUserById } from "@/lib/db";
import { getExerciseLibraryClient } from "@/lib/exercise-library/admin-client";
import { mapExerciseRow } from "@/lib/exercise-library/mappers";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { buildExerciseAlternativeCandidates } from "@/lib/training-programs";

// POST /api/mobile/programs/[id]/exercises/[exerciseId]/alternatives
// Body: { dayId: string, reason?: string }
// Member-facing "I can't do / don't like this exercise" — returns AI-ranked
// alternatives from the real exercise library (never hallucinated names),
// scoped to AI-generated programmes only. Staff-assigned programmes aren't
// covered here — staff already edit those directly in staff-program-builder.
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

  const { dayId, reason } = (body ?? {}) as Record<string, unknown>;
  if (typeof dayId !== "string" || !dayId.trim()) {
    return NextResponse.json({ success: false, message: "dayId is required." }, { status: 400 });
  }
  const cleanReason = typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 200) : null;

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

  const day = program.days.find((d) => d.id === dayId);
  const exercise = day?.exercises.find((e) => e.id === exerciseId);
  if (!day || !exercise) {
    return NextResponse.json({ success: false, message: "Exercise not found." }, { status: 404 });
  }

  const { data, error } = await getExerciseLibraryClient().from("exercises").select("*").eq("approved", true).limit(500);
  if (error) {
    console.error("[exercise-alternatives] exercise library fetch failed:", error);
    return NextResponse.json({ success: false, message: "Could not load the exercise library." }, { status: 500 });
  }
  const libraryExercises = (data ?? []).map(mapExerciseRow);

  const candidates = buildExerciseAlternativeCandidates(
    program,
    dayId,
    exerciseId,
    libraryExercises,
    program.aiMeta?.equipmentSlugs ?? []
  );
  if (candidates.length === 0) {
    return NextResponse.json({ success: true, message: "No alternatives found.", data: { alternatives: [] } });
  }

  let suggestions: { id: string; rationale: string }[] = [];
  if (isAiConfigured()) {
    try {
      const result = await generateExerciseAlternatives({
        exerciseName: exercise.name,
        muscleTags: exercise.muscleTags,
        reason: cleanReason,
        candidates: candidates.map((c) => ({ id: c.id, name: c.name })),
        userId: user.id,
      });
      if (result) suggestions = result;
    } catch (err) {
      console.error("[exercise-alternatives] AI call failed, falling back to deterministic candidates:", err);
    }
  }

  // No AI configured, or it failed/returned nothing usable — fall back to a
  // handful of the deterministic candidates rather than hard-failing.
  if (suggestions.length === 0) {
    suggestions = candidates
      .slice(0, 4)
      .map((c) => ({ id: c.id, rationale: "Similar movement, works with your equipment." }));
  }

  const libraryById = new Map(libraryExercises.map((e) => [e.id, e]));
  const alternatives = suggestions
    .map((s) => {
      const rec = libraryById.get(s.id);
      if (!rec) return null;
      return { exerciseId: rec.id, name: rec.name, muscleTags: rec.bodyPart ? [rec.bodyPart] : [], rationale: s.rationale };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null);

  return NextResponse.json({ success: true, message: "Done.", data: { alternatives } });
}
