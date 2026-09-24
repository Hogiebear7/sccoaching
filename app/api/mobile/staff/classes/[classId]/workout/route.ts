import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findBookingsByClassId,
  findClassById,
  findClassWorkoutByClassId,
  findExercises,
  findProfileByUserId,
  findUserById,
  findWorkoutSessionByUserAndClass,
} from "@/lib/db";
import { sameGym, sameGymAsStaff } from "@/lib/gym-scope";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";

// Read-side counterpart to /api/staff/classes/[classId]/workout (POST,
// already Bearer-compatible and reused as-is for saving). Mirrors the
// server-side data-fetching in app/(staff)/staff/classes/[classId]/workout/
// page.tsx so mobile's class-workout-builder screen has the same starting
// state: the saved template (if any) and each checked-in member's existing
// synced results.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;
  const staffUser = sessionUserId ? findUserById(sessionUserId) : undefined;

  if (!staffUser) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  if (!can(staffUser.role, "classes.manage")) {
    return NextResponse.json({ success: false, message: "Staff access required." }, { status: 403 });
  }

  const { classId } = await params;
  const classRecord = findClassById(classId);

  // Ownership: class -> coach -> gym. A cross-gym class (or one whose coach
  // can't be resolved) gets the same not-found response as a missing one, and
  // this runs before any attendee/profile/session lookup below.
  if (!classRecord || !classRecord.coachUserId || !sameGymAsStaff(staffUser, classRecord.coachUserId)) {
    return NextResponse.json({ success: false, message: "This class no longer exists." }, { status: 404 });
  }

  // Attendees are gym-checked individually (member.gymId) before their profile
  // or workout session is read; a legacy cross-gym attendee on this in-gym class
  // is left out. A member that no longer exists keeps the "Unknown member" row.
  const checkedIn = findBookingsByClassId(classRecord.id)
    .filter((b) => b.attendedAt !== null)
    .filter((b) => {
      const member = findUserById(b.userId);
      return !member || sameGym(staffUser, member);
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

  return NextResponse.json({
    success: true,
    data: {
      classId: classRecord.id,
      classTitle: classRecord.title,
      classDate: classRecord.date,
      startTime: classRecord.startTime,
      existingWorkout: findClassWorkoutByClassId(classRecord.id) ?? null,
      checkedIn,
      libraryExercises: findExercises(),
    },
  });
}
