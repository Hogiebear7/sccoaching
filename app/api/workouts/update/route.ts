import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findUserById,
  findWorkoutSessionById,
  saveWorkoutSession,
} from "@/lib/db";
import { parseExerciseEntries } from "@/lib/workout-entries";
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

  const { sessionId, exercises, notes } = (body ?? {}) as Record<string, unknown>;

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

  if (parsedExercises.length === 0) {
    return NextResponse.json(
      { success: false, message: "A workout needs at least one exercise." },
      { status: 400 }
    );
  }

  saveWorkoutSession({
    ...session,
    exercises: parsedExercises,
    notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json({ success: true, message: "Workout updated." }, { status: 200 });
}
