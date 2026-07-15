import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findExerciseById,
  findExercises,
  saveExercise,
  findUserById,
  type ExerciseRecord,
  type ExerciseSection,
} from "@/lib/db";
import { verifySession } from "@/lib/session";

const VALID_SECTIONS: ExerciseSection[] = ["upper_push", "upper_pull", "lower_push", "lower_pull", "core", "cardio"];

export async function POST(request: NextRequest) {
  const sessionUserId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage exercises." },
      { status: 401 }
    );
  }

  const staffUser = findUserById(sessionUserId);

  if (!staffUser || staffUser.role !== "staff") {
    return NextResponse.json(
      { success: false, message: "Only staff can manage exercises." },
      { status: 403 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const { id, name, section } = (body ?? {}) as Record<string, unknown>;

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json(
      { success: false, message: "Exercise name is required." },
      { status: 400 }
    );
  }

  if (typeof section !== "string" || !VALID_SECTIONS.includes(section as ExerciseSection)) {
    return NextResponse.json(
      { success: false, message: "A valid section is required." },
      { status: 400 }
    );
  }

  const cleanName = name.trim();
  const existing = typeof id === "string" && id.trim() ? findExerciseById(id) : undefined;

  // Prevent duplicate names within the same section (ignoring case).
  const duplicate = findExercises().find(
    (e) =>
      e.id !== (existing?.id ?? "") &&
      e.section === section &&
      e.name.toLowerCase() === cleanName.toLowerCase()
  );
  if (duplicate) {
    return NextResponse.json(
      { success: false, message: `An exercise named "${cleanName}" already exists in that section.` },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();

  const exercise: ExerciseRecord = {
    id: existing?.id ?? randomUUID(),
    name: cleanName,
    section: section as ExerciseSection,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  saveExercise(exercise);

  return NextResponse.json(
    { success: true, message: existing ? "Exercise updated." : "Exercise added." },
    { status: 200 }
  );
}
