import { randomUUID } from "crypto";

import {
  findBookingsByClassId,
  findClassById,
  findClassWorkoutByClassId,
  findWorkoutSessionByUserAndClass,
  saveWorkoutSession,
  type WorkoutExerciseEntry,
  type WorkoutSessionRecord,
} from "@/lib/db";

// Prepopulates a booked member's Workouts tab with the class's staff-set
// workout as soon as either side of the link exists: the member books a
// class that already has a workout, or staff save/edit a workout for a
// class that already has bookings. Either path lands here.
//
// Never overwrites what a member (or staff, via the check-in flow) has
// already entered — an existing session is only extended with template
// exercises the member doesn't have yet, matched by name. This is the same
// "prior wins" merge the staff check-in screen already does, just applied
// automatically instead of requiring a manual save.
function mergeTemplateIntoExisting(
  template: WorkoutExerciseEntry[],
  existing: WorkoutExerciseEntry[]
): WorkoutExerciseEntry[] {
  const existingNames = new Set(existing.map((e) => e.name.trim().toLowerCase()));
  const additions = template.filter((t) => !existingNames.has(t.name.trim().toLowerCase()));
  return [...existing, ...additions];
}

// Upserts ONE member's session for a class workout template. No-op if the
// class has no template yet.
export function syncClassWorkoutToMember(classId: string, userId: string): void {
  const template = findClassWorkoutByClassId(classId);
  if (!template) return;

  const classRecord = findClassById(classId);
  if (!classRecord) return;

  const existing = findWorkoutSessionByUserAndClass(userId, classId);
  const now = new Date().toISOString();

  const session: WorkoutSessionRecord = {
    id: existing?.id ?? randomUUID(),
    userId,
    date: classRecord.date,
    title: classRecord.title,
    durationMins: classRecord.durationMins,
    notes: existing?.notes ?? template.notes,
    exercises: existing ? mergeTemplateIntoExisting(template.exercises, existing.exercises) : template.exercises,
    runs: existing?.runs ?? [],
    classId,
    recordedByStaffId: existing?.recordedByStaffId ?? template.updatedByStaffId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  saveWorkoutSession(session);
}

// Syncs every currently booked member for a class — used right after staff
// save/edit the class workout template, so anyone already booked gets it
// (or its edits) without staff having to check them in first.
export function syncClassWorkoutToAllBooked(classId: string): number {
  const template = findClassWorkoutByClassId(classId);
  if (!template) return 0;

  const bookings = findBookingsByClassId(classId);
  for (const booking of bookings) {
    syncClassWorkoutToMember(classId, booking.userId);
  }
  return bookings.length;
}
