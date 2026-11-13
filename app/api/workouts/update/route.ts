import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findUserById,
  findWorkoutSessionById,
  saveWorkoutSession,
} from "@/lib/db";
import { parseExerciseEntries, parseRunEntries } from "@/lib/workout-entries";
import { verifyRequestSession } from "@/lib/mobile-auth";

// Member correction for class-synced workouts: coaches often don't get
// around to filling in weights/adjustments for everyone in a class, so
// members can correct their own exercises/notes here at any time (not just
// same-day — coaches don't always fill these in promptly). Self-logged
// sessions are not editable here; those use /api/workouts/edit instead.
// Staff can always overwrite by re-syncing from the class workout screen —
// see lib/class-workout-sync.ts's "existing wins" merge, which means a
// member's own edits are never silently clobbered by a staff re-sync either.
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

  // runs, sessionRpe and feelingNotes are optional and new: an older app sends only exercises and notes and nothing else changes for it.
  const { sessionId, exercises, notes, runs, sessionRpe, feelingNotes } = (body ?? {}) as Record<string, unknown>;

  if (typeof sessionId !== "string" || !sessionId.trim()) {
    return NextResponse.json(
      { success: false, message: "A workout session is required." },
      { status: 400 }
    );
  }

  const session = findWorkoutSessionById(sessionId.trim());

  if (!session || session.userId !== user.id) {
    return NextResponse.json(
      { success: false, message: "This workout doesn't exist." },
      { status: 404 }
    );
  }

  if (!session.classId) {
    return NextResponse.json(
      { success: false, message: "Only class workouts can be corrected here." },
      { status: 403 }
    );
  }

  const parsedExercises = parseExerciseEntries(exercises);
  const sendsRuns = Array.isArray(runs);
  const parsedRuns = sendsRuns ? parseRunEntries(runs) : session.runs;

  if (parsedExercises.length === 0 && parsedRuns.length === 0) {
    return NextResponse.json(
      { success: false, message: "A workout needs at least one exercise." },
      { status: 400 }
    );
  }

  // How hard the session felt (1 to 10, half steps allowed) and a few words about it. Left as they were when the app does not send them.
  let nextRpe = session.sessionRpe ?? null;
  if (sessionRpe !== undefined) {
    if (sessionRpe === null) nextRpe = null;
    else if (typeof sessionRpe === "number" && Number.isFinite(sessionRpe) && sessionRpe >= 1 && sessionRpe <= 10) nextRpe = sessionRpe;
    else return NextResponse.json({ success: false, message: "Effort must be between 1 and 10." }, { status: 400 });
  }
  const nextFeeling =
    feelingNotes === undefined
      ? session.feelingNotes ?? null
      : typeof feelingNotes === "string" && feelingNotes.trim()
        ? feelingNotes.trim().slice(0, 1000)
        : null;

  saveWorkoutSession({
    ...session,
    exercises: parsedExercises,
    runs: parsedRuns,
    sessionRpe: nextRpe,
    feelingNotes: nextFeeling,
    notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json({ success: true, message: "Workout updated." }, { status: 200 });
}
