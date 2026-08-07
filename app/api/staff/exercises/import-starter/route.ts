import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findExercises, findUserById, saveExercise, type ExerciseRecord } from "@/lib/db";
import { STARTER_EXERCISE_LIBRARY } from "@/lib/starter-exercise-library";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";

// One-time bulk import for staff to seed an empty exercise library — same
// underlying list as scripts/seed-exercise-library.mjs, exposed here so it
// can be run from the live site without direct database access. Skips any
// name already present in the same section, so it's safe to press more than
// once (e.g. after adding a few exercises by hand).
export async function POST(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage exercises." },
      { status: 401 }
    );
  }

  const staffUser = findUserById(sessionUserId);

  if (!staffUser || !can(staffUser.role, "exercises.manage")) {
    return NextResponse.json(
      { success: false, message: "Only staff can manage exercises." },
      { status: 403 }
    );
  }

  const existing = findExercises();
  const existingKeys = new Set(
    existing.map((e) => `${e.section}:${e.name.trim().toLowerCase()}`)
  );

  const toAdd = STARTER_EXERCISE_LIBRARY.filter(
    (e) => !existingKeys.has(`${e.section}:${e.name.trim().toLowerCase()}`)
  );

  const now = new Date().toISOString();
  for (const e of toAdd) {
    const exercise: ExerciseRecord = {
      id: randomUUID(),
      name: e.name,
      section: e.section,
      description: e.description,
      cues: e.cues,
      createdAt: now,
      updatedAt: now,
    };
    saveExercise(exercise);
  }

  const skipped = STARTER_EXERCISE_LIBRARY.length - toAdd.length;

  return NextResponse.json(
    {
      success: true,
      added: toAdd.length,
      skipped,
      message:
        toAdd.length === 0
          ? "Nothing to import — all starter exercises already exist."
          : `Added ${toAdd.length} exercise${toAdd.length === 1 ? "" : "s"}.${
              skipped > 0 ? ` (${skipped} already existed and were skipped.)` : ""
            }`,
    },
    { status: 200 }
  );
}
