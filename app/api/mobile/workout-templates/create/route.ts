import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById, saveWorkoutTemplate, type WorkoutTemplateRecord } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { parsePrescribedExercises } from "@/lib/training-programs";

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

  const { name, exercises } = (body ?? {}) as Record<string, unknown>;

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ success: false, message: "Template name is required." }, { status: 400 });
  }

  const parsedExercises = parsePrescribedExercises(Array.isArray(exercises) ? exercises.slice(0, 40) : []);
  if (parsedExercises.length === 0) {
    return NextResponse.json({ success: false, message: "Add at least one exercise." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const template: WorkoutTemplateRecord = {
    id: randomUUID(),
    userId: user.id,
    name: name.trim(),
    exercises: parsedExercises,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  saveWorkoutTemplate(template);

  return NextResponse.json({ success: true, message: "Template saved.", data: template }, { status: 200 });
}
