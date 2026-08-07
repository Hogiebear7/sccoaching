import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findUserById,
  findWorkoutSessionById,
  saveWorkoutSession,
} from "@/lib/db";
import { parseExerciseEntries } from "@/lib/workout-entries";
import { verifyRequestSession } from "@/lib/mobile-auth";

function todayLocalISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Limited member correction for class-synced workouts: editable until the
// end of the class's calendar day, read-only afterwards (staff can always
// change it by re-syncing from the class workout screen). Self-logged
// sessions are not editable here — this window exists specifically because
// staff-entered numbers may need a same-day fix by the person who lifted.
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

  if (session.date !== todayLocalISO()) {
    return NextResponse.json(
      {
        success: false,
        message: "The edit window has closed — class workouts are read-only after the day of the class. Ask a coach to correct it.",
      },
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
