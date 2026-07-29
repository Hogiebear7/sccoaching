import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findBookingsByClassId,
  findClassById,
  findUserById,
  findWorkoutSessionByUserAndClass,
  saveClassWorkout,
  saveWorkoutSession,
  type ClassWorkoutRecord,
  type WorkoutSessionRecord,
} from "@/lib/db";
import { parseExerciseEntries } from "@/lib/workout-entries";
import { verifySession } from "@/lib/session";
import { can } from "@/lib/permissions";

// Staff record the workout for a class: a shared template (what the class
// did) plus per-member performed results for CHECKED-IN members only —
// attendance is the participation signal, not the booking. Results sync
// into each member's own workout history as an ordinary session keyed by
// (classId, userId), so a re-sync updates the same session instead of
// duplicating, and the member's tab shows it automatically.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to record class workouts." },
      { status: 401 }
    );
  }

  if (!can(user.role, "classes.manage")) {
    return NextResponse.json(
      { success: false, message: "Only staff can record class workouts." },
      { status: 403 }
    );
  }

  const { classId } = await params;
  const classRecord = findClassById(classId);

  if (!classRecord) {
    return NextResponse.json(
      { success: false, message: "This class no longer exists." },
      { status: 404 }
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

  const { notes, exercises, results } = (body ?? {}) as Record<string, unknown>;

  const templateExercises = parseExerciseEntries(exercises);

  if (templateExercises.length === 0) {
    return NextResponse.json(
      { success: false, message: "Add at least one exercise to the class workout." },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();

  const workout: ClassWorkoutRecord = {
    classId: classRecord.id,
    notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
    exercises: templateExercises,
    updatedByStaffId: user.id,
    createdAt: now,
    updatedAt: now,
  };
  saveClassWorkout(workout);

  // Per-member results are only accepted for members with a checked-in
  // booking on this class — the roster is the allow-list.
  const checkedInUserIds = new Set(
    findBookingsByClassId(classRecord.id)
      .filter((b) => b.attendedAt !== null)
      .map((b) => b.userId)
  );

  let synced = 0;
  let skipped = 0;

  if (Array.isArray(results)) {
    for (const raw of results) {
      const r = (raw ?? {}) as Record<string, unknown>;
      const memberId = typeof r.userId === "string" ? r.userId : null;

      if (!memberId || !checkedInUserIds.has(memberId)) {
        skipped += 1;
        continue;
      }

      const memberExercises = parseExerciseEntries(r.exercises);
      if (memberExercises.length === 0) {
        skipped += 1;
        continue;
      }

      const existing = findWorkoutSessionByUserAndClass(memberId, classRecord.id);

      const session: WorkoutSessionRecord = {
        id: existing?.id ?? randomUUID(),
        userId: memberId,
        date: classRecord.date,
        title: classRecord.title,
        durationMins: classRecord.durationMins,
        notes: typeof r.notes === "string" && r.notes.trim() ? r.notes.trim() : existing?.notes ?? null,
        exercises: memberExercises,
        runs: existing?.runs ?? [],
        classId: classRecord.id,
        recordedByStaffId: user.id,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      saveWorkoutSession(session);
      synced += 1;
    }
  }

  const parts = ["Class workout saved."];
  if (synced > 0) parts.push(`Synced to ${synced} member${synced === 1 ? "" : "s"}.`);
  if (skipped > 0) parts.push(`${skipped} entr${skipped === 1 ? "y" : "ies"} skipped (not checked in or empty).`);

  return NextResponse.json({ success: true, message: parts.join(" ") }, { status: 200 });
}
