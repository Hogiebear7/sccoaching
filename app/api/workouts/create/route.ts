import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findUserById,
  saveWorkoutSession,
  type WorkoutRunEntry,
  type WorkoutSessionRecord,
} from "@/lib/db";
import { parseExerciseEntries } from "@/lib/workout-entries";
import { verifySession } from "@/lib/session";

function parseOptionalNonNegativeInt(
  value: unknown
): { ok: true; value: number | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  if (value.trim() === "") return { ok: true, value: null };

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return { ok: false };

  return { ok: true, value: parsed };
}

export async function POST(request: NextRequest) {
  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

  if (!userId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to log a workout." },
      { status: 401 }
    );
  }

  const user = findUserById(userId);

  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to log a workout." },
      { status: 401 }
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

  const { title, date, durationMins, notes, exercises, runs } = (body ?? {}) as Record<string, unknown>;

  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json(
      { success: false, message: "Title is required." },
      { status: 400 }
    );
  }

  if (typeof date !== "string" || !date.trim()) {
    return NextResponse.json(
      { success: false, message: "Date is required." },
      { status: 400 }
    );
  }

  const durationResult = parseOptionalNonNegativeInt(durationMins);

  if (!durationResult.ok) {
    return NextResponse.json(
      { success: false, message: "Duration must be a whole number." },
      { status: 400 }
    );
  }

  // Shared parser (lib/workout-entries.ts) — also handles per-set details
  // and RPE; rows with an empty name are dropped.
  const parsedExercises = parseExerciseEntries(exercises);

  // Parse run rows. Rows with neither distance nor duration are silently dropped.
  const parsedRuns: WorkoutRunEntry[] = Array.isArray(runs)
    ? runs.flatMap((entry) => {
        const r = (entry ?? {}) as Record<string, unknown>;
        const distance =
          typeof r.distance === "number" && Number.isFinite(r.distance) && r.distance > 0
            ? r.distance
            : null;
        const durationSecs =
          typeof r.durationSecs === "number" &&
          Number.isInteger(r.durationSecs) &&
          r.durationSecs > 0
            ? r.durationSecs
            : null;
        if (distance === null && durationSecs === null) return [];
        const repsRaw = typeof r.reps === "number" ? r.reps : null;
        const setsRaw = typeof r.sets === "number" ? r.sets : null;
        return [
          {
            distance,
            distanceUnit: "km" as const,
            durationSecs,
            reps: repsRaw !== null && Number.isFinite(repsRaw) && repsRaw >= 0 ? Math.floor(repsRaw) : null,
            sets: setsRaw !== null && Number.isFinite(setsRaw) && setsRaw >= 0 ? Math.floor(setsRaw) : null,
            notes: typeof r.notes === "string" && r.notes.trim() ? r.notes.trim() : null,
          } satisfies WorkoutRunEntry,
        ];
      })
    : [];

  const now = new Date().toISOString();

  const session: WorkoutSessionRecord = {
    id: randomUUID(),
    userId: user.id,
    date: date.trim(),
    title: title.trim(),
    durationMins: durationResult.value,
    notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
    exercises: parsedExercises,
    runs: parsedRuns,
    createdAt: now,
    updatedAt: now,
  };

  saveWorkoutSession(session);

  return NextResponse.json(
    { success: true, message: "Workout logged." },
    { status: 201 }
  );
}
