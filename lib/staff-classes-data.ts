import {
  findBookingsByClassId,
  findClasses,
  findProfileByUserId,
  findUserById,
  type ClassRecord,
} from "./db";
import { ensureSeriesOccurrences } from "./class-series";

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
export function getStaffClassesData(daysAhead = 14): StaffClassSummary[] {
  ensureSeriesOccurrences();

  const todayISO = new Date().toISOString().slice(0, 10);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + daysAhead);
  const cutoffISO = cutoff.toISOString().slice(0, 10);

  return findClasses()
    .filter((c) => c.date >= todayISO && c.date <= cutoffISO)
    .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`))
    .map((classRecord) => {
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
        coachEmail: findUserById(classRecord.coachUserId)?.email ?? "Unknown coach",
        bookedCount: bookings.length,
        roster,
      };
    });
}
