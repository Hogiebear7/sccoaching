import { classStartDate } from "@/lib/class-time";
import { findBookingsByUserId, findClassById, findUserById } from "./db";
import { isCancellationEarly } from "./scheduling";

export interface ResolvedBooking {
  bookingId: string;
  classId: string;
  title: string;
  category: string;
  date: string;
  startTime: string;
  durationMins: number;
  imageUrl: string | null;
  imageAlt: string | null;
  coachEmail: string;
  attended: boolean;
  isPast: boolean;
  willRestoreSession: boolean;
}

// Resolves a member's bookings into the fully display-ready shape both the
// standalone Bookings page and Schedule's "My bookings" tab need — sets and
// duration, coach email, attendance, and whether cancelling now would
// restore the session credit. Previously duplicated (and already drifting:
// see the Schedule/Bookings trace in memory) as two separately-written
// mappings in bookings/page.tsx and schedule/page.tsx; now a single source
// of truth for both. Pure read/derivation only — bookings are still
// created/cancelled exclusively through the existing API routes.
export function resolveBookingsForUser(userId: string, now: number = Date.now()): ResolvedBooking[] {
  return findBookingsByUserId(userId)
    .map((booking): ResolvedBooking | null => {
      const classRecord = findClassById(booking.classId);
      if (!classRecord) return null;

      const classDateTime = classStartDate(classRecord.date, classRecord.startTime);

      return {
        bookingId: booking.id,
        classId: classRecord.id,
        title: classRecord.title,
        category: classRecord.category,
        date: classRecord.date,
        startTime: classRecord.startTime,
        durationMins: classRecord.durationMins,
        imageUrl: classRecord.imageUrl ?? null,
        imageAlt: classRecord.imageAlt ?? null,
        coachEmail: findUserById(classRecord.coachUserId)?.email ?? "Unknown coach",
        attended: booking.attendedAt !== null,
        isPast: classDateTime.getTime() < now,
        willRestoreSession: isCancellationEarly(classDateTime),
      };
    })
    .filter((booking): booking is ResolvedBooking => booking !== null);
}
