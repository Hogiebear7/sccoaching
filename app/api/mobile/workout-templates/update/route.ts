import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById, findWorkoutTemplateById, saveWorkoutTemplate, type WorkoutTemplateRecord } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { parsePrescribedExercises } from "@/lib/training-programs";

// Also used to archive/restore a template — pass archived: true/false with
// the unchanged name/exercises to flip archivedAt without touching content.
export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { id, name, exercises, archived } = (body ?? {}) as Record<string, unknown>;

  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ success: false, message: "id is required." }, { status: 400 });
  }
  const existing = findWorkoutTemplateById(id);
  if (!existing || existing.userId !== user.id) {
    return NextResponse.json({ success: false, message: "Template not found." }, { status: 404 });
  }

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ success: false, message: "Template name is required." }, { status: 400 });
  }

  const parsedExercises = parsePrescribedExercises(Array.isArray(exercises) ? exercises.slice(0, 40) : []);
  if (parsedExercises.length === 0) {
    return NextResponse.json({ success: false, message: "Add at least one exercise." }, { status: 400 });
  }

  const updated: WorkoutTemplateRecord = {
    ...existing,
    name: name.trim(),
    exercises: parsedExercises,
    archivedAt: typeof archived === "boolean" ? (archived ? new Date().toISOString() : null) : existing.archivedAt,
    updatedAt: new Date().toISOString(),
  };

  saveWorkoutTemplate(updated);

  return NextResponse.json({ success: true, message: "Template updated.", data: updated }, { status: 200 });
}
