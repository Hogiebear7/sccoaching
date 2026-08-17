import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findUserById,
  findWorkoutSessionById,
  saveWorkoutSession,
  type WorkoutRunEntry,
  type WorkoutSessionRecord,
} from "@/lib/db";
import { parseExerciseEntries } from "@/lib/workout-entries";
import { verifyRequestSession } from "@/lib/mobile-auth";

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

function parseOptionalRpe(value: unknown): { ok: true; value: number | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false };
  if (value < 1 || value > 10) return { ok: false };
  return { ok: true, value };
}

// General edit for a member's own previously logged, self-logged workout —
// any date, not just today. Mirrors /api/workouts/create's parsing so the
// same log form can submit here in edit mode. Class-synced sessions (see
// WorkoutSessionRecord.classId) are deliberately out of scope: those already
// have their own same-day correction path (/api/workouts/update) because
// they're coach-controlled templates, not something a member free-edits.
export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to edit a workout." },
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

  const { id, title, date, durationMins, notes, exercises, runs, sessionRpe, feelingNotes } = (body ?? {}) as Record<
    string,
    unknown
  >;

  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json(
      { success: false, message: "A workout id is required." },
      { status: 400 }
    );
  }

  const existing = findWorkoutSessionById(id.trim());

  if (!existing || existing.userId !== user.id) {
    return NextResponse.json(
      { success: false, message: "This workout doesn't exist." },
      { status: 404 }
    );
  }

  if (existing.classId) {
    return NextResponse.json(
      {
        success: false,
        message: "Class workouts are corrected from the class card, not here.",
      },
      { status: 403 }
    );
  }

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

  // sessionRpe/feelingNotes come only from the post-workout "How did that
  // feel?" prompt on the log form, not this edit path's own fields — if the
  // request doesn't include them, keep whatever was already recorded rather
  // than wiping it out.
  let updatedSessionRpe = existing.sessionRpe ?? null;
  if (sessionRpe !== undefined) {
    const rpeResult = parseOptionalRpe(sessionRpe);
    if (!rpeResult.ok) {
      return NextResponse.json(
        { success: false, message: "Session RPE must be between 1 and 10." },
        { status: 400 }
      );
    }
    updatedSessionRpe = rpeResult.value;
  }
  const updatedFeelingNotes =
    typeof feelingNotes === "string" ? (feelingNotes.trim() ? feelingNotes.trim() : null) : existing.feelingNotes ?? null;

  const parsedExercises = parseExerciseEntries(exercises);

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

  const updated: WorkoutSessionRecord = {
    ...existing,
    date: date.trim(),
    title: title.trim(),
    durationMins: durationResult.value,
    notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
    exercises: parsedExercises,
    runs: parsedRuns,
    sessionRpe: updatedSessionRpe,
    feelingNotes: updatedFeelingNotes,
    updatedAt: new Date().toISOString(),
  };

  saveWorkoutSession(updated);

  return NextResponse.json({ success: true, message: "Workout updated." }, { status: 200 });
}
