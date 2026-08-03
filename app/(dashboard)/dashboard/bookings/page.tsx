import { cookies } from "next/headers";

import { findProfileByUserId, findUserById } from "@/lib/db";
import { resolveBookingsForUser } from "@/lib/bookings";
import { getCancellationCutoffHours } from "@/lib/scheduling";
import { verifySession } from "@/lib/session";
import { BookingsView } from "./BookingsView";

export default async function DashboardBookingsPage() {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  const profile = user ? findProfileByUserId(user.id) : undefined;

  if (!user || !profile) {
    return (
      <section>
        <p className="label-caps">
          Bookings
        </p>
        <h2 className="text-display mt-1 text-[28px] leading-tight text-zinc-50">
          No bookings available
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
          We couldn&apos;t load profile data for this account. Try logging out and
          back in.
        </p>
      </section>
    );
  }

  const now = Date.now();

  const resolvedBookings = resolveBookingsForUser(user.id, now);

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
