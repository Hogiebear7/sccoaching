import Link from "next/link";

import {
  findBookingsByClassId,
  findClassById,
  findClassWorkoutByClassId,
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
  const { classId } = await params;
  const classRecord = findClassById(classId);

  if (!classRecord) {
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
  const checkedIn = findBookingsByClassId(classRecord.id)
    .filter((b) => b.attendedAt !== null)
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

  return (
    <ClassWorkoutView
      classId={classRecord.id}
      classTitle={classRecord.title}
      classDate={classRecord.date}
      startTime={classRecord.startTime}
      existingWorkout={findClassWorkoutByClassId(classRecord.id) ?? null}
      checkedIn={checkedIn}
      libraryExercises={findExercises()}
    />
  );
}
