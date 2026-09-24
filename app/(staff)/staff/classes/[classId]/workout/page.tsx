import Link from "next/link";

import { sameGym, sameGymAsStaff } from "@/lib/gym-scope";
import { requireStaffPage } from "@/lib/staff-auth";
import {
  findBookingsByClassId,
  findClassById,
  findClassWorkoutByClassId,
  findClassWorkoutTemplates,
  findExercises,
  findProfileByUserId,
  findUserById,
  findWorkoutSessionByUserAndClass,
} from "@/lib/db";
import { ClassWorkoutView } from "./ClassWorkoutView";

export default async function StaffClassWorkoutPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const staff = await requireStaffPage("classes.manage");
  const { classId } = await params;
  const classRecord = findClassById(classId);

  // Ownership: class -> coachUserId -> gym, compared with the acting staff
  // member's gym. A cross-gym class (or one whose coach can't be resolved) gets
  // the same "Class not found" state as a missing one, before any attendee,
  // profile, workout-session, template or exercise-library lookup.
  if (!classRecord || !classRecord.coachUserId || !sameGymAsStaff(staff, classRecord.coachUserId)) {
    return (
      <section className="space-y-6">
        <Link href="/staff/classes" className="text-sm text-gold transition hover:text-gold/80">
          ← Back to classes
        </Link>
        <div>
          <p className="label-caps">Class workout</p>
          <h2 className="text-display mt-1 text-[28px] leading-tight">Class not found</h2>
        </div>
      </section>
    );
  }

  // Attendance is the participation signal: only checked-in members appear
  // in the recording flow. Existing synced sessions prefill their rows.
  // Attendees are gym-checked individually (member.gymId) before their profile
  // or workout session is read; a legacy cross-gym attendee on this in-gym class
  // is left out. A member that no longer exists keeps the "Unknown member" row.
  const checkedIn = findBookingsByClassId(classRecord.id)
    .filter((b) => b.attendedAt !== null)
    .filter((b) => {
      const member = findUserById(b.userId);
      return !member || sameGym(staff, member);
    })
    .map((booking) => {
      const member = findUserById(booking.userId);
      const profile = member ? findProfileByUserId(member.id) : undefined;
      const existingSession = findWorkoutSessionByUserAndClass(booking.userId, classRecord.id);
      return {
        userId: booking.userId,
        name: profile?.fullName ?? member?.email ?? "Unknown member",
        existingExercises: existingSession?.exercises ?? null,
        existingNotes: existingSession?.notes ?? null,
      };
    });

  const templates = findClassWorkoutTemplates().filter((t) => t.categories.includes(classRecord.category));

  return (
    <ClassWorkoutView
      classId={classRecord.id}
      classTitle={classRecord.title}
      classDate={classRecord.date}
      startTime={classRecord.startTime}
      existingWorkout={findClassWorkoutByClassId(classRecord.id) ?? null}
      checkedIn={checkedIn}
      libraryExercises={findExercises()}
      templates={templates}
    />
  );
}
