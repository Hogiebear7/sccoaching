import { cookies } from "next/headers";

import {
  findBookingsByUserId,
  findClassById,
  findProfileByUserId,
  findUserById,
} from "@/lib/db";
import { getCancellationCutoffHours, isCancellationEarly } from "@/lib/scheduling";
import { verifySession } from "@/lib/session";
import { BookingsView } from "./BookingsView";

export default async function DashboardBookingsPage() {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  const profile = user ? findProfileByUserId(user.id) : undefined;

  if (!user || !profile) {
    return (
      <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
        <p className="text-sm uppercase tracking-[0.24em] text-teal-400">
          Bookings
        </p>
        <h2 className="mt-2 text-3xl font-semibold text-zinc-50">
          No bookings available
        </h2>
        <p className="mt-3 max-w-2xl text-sm text-zinc-400">
          We couldn&apos;t load profile data for this account. Try logging out and
          back in.
        </p>
      </section>
    );
  }

  const now = Date.now();

  const resolvedBookings = findBookingsByUserId(user.id)
    .map((booking) => {
      const classRecord = findClassById(booking.classId);
      if (!classRecord) return null;

      const classDateTime = new Date(`${classRecord.date}T${classRecord.startTime}`);

      return {
        bookingId: booking.id,
        classId: classRecord.id,
        title: classRecord.title,
        date: classRecord.date,
        startTime: classRecord.startTime,
        durationMins: classRecord.durationMins,
        coachEmail: findUserById(classRecord.coachUserId)?.email ?? "Unknown coach",
        attended: booking.attendedAt !== null,
        isPast: classDateTime.getTime() < now,
        willRestoreSession: isCancellationEarly(classDateTime),
      };
    })
    .filter((booking): booking is NonNullable<typeof booking> => booking !== null);

  const upcomingBookings = resolvedBookings
    .filter((booking) => !booking.isPast)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

  const pastBookings = resolvedBookings
    .filter((booking) => booking.isPast)
    .sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime));

  return (
    <BookingsView
      upcomingBookings={upcomingBookings}
      pastBookings={pastBookings}
      cancellationCutoffHours={getCancellationCutoffHours()}
    />
  );
}
