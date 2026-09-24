import {
  findBookingsByClassId,
  findClasses,
  findProfileByUserId,
  findUserById,
  type ClassRecord,
} from "./db";
import { ensureSeriesOccurrences } from "./class-series";
import { sameGym } from "./gym-scope";

export interface StaffClassRosterEntry {
  bookingId: string;
  userId: string;
  email: string;
  fullName: string | null;
  attendedAt: string | null;
}

export interface StaffClassSummary extends ClassRecord {
  coachEmail: string;
  bookedCount: number;
  roster: StaffClassRosterEntry[];
}

// Mobile-first staff classes view: today onward only, capped to a rolling
// window — the web app's /staff/classes page loads every class ever
// created (it also handles creation/editing/series management, which is a
// separate, larger mobile build). Waitlist and past-class history aren't
// included here for the same reason.
//
// Scoped to the acting staff member's own gym: a class belongs to the gym of
// its coach (class -> coachUserId -> gym), and a class whose coach can't be
// resolved is excluded (fail closed). The gym filter runs BEFORE any booking,
// attendee-user, or profile lookup, so no other gym's member email or name is
// ever loaded. `staff` is the server-resolved session user, never a client
// value. (Its only caller is the mobile staff classes route.)
export function getStaffClassesData(staff: { gymId?: string | null }, daysAhead = 14): StaffClassSummary[] {
  ensureSeriesOccurrences();

  const todayISO = new Date().toISOString().slice(0, 10);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + daysAhead);
  const cutoffISO = cutoff.toISOString().slice(0, 10);

  return findClasses()
    .filter((c) => c.date >= todayISO && c.date <= cutoffISO)
    .map((classRecord) => ({ classRecord, coach: findUserById(classRecord.coachUserId) }))
    .filter(({ coach }) => !!coach && sameGym(staff, coach))
    .sort((a, b) =>
      `${a.classRecord.date}T${a.classRecord.startTime}`.localeCompare(`${b.classRecord.date}T${b.classRecord.startTime}`)
    )
    .map(({ classRecord, coach }) => {
      const bookings = findBookingsByClassId(classRecord.id);
      const roster: StaffClassRosterEntry[] = bookings.map((booking) => {
        const bookedUser = findUserById(booking.userId);
        const bookedProfile = bookedUser ? findProfileByUserId(bookedUser.id) : undefined;
        return {
          bookingId: booking.id,
          userId: booking.userId,
          email: bookedUser?.email ?? "Unknown member",
          fullName: bookedProfile?.fullName ?? null,
          attendedAt: booking.attendedAt,
        };
      });

      return {
        ...classRecord,
        coachEmail: coach?.email ?? "Unknown coach",
        bookedCount: bookings.length,
        roster,
      };
    });
}
