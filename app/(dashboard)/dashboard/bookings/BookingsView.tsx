"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type ResolvedBooking = {
  bookingId: string;
  classId: string;
  title: string;
  date: string;
  startTime: string;
  durationMins: number;
  coachEmail: string;
  attended: boolean;
  willRestoreSession: boolean;
};

export function BookingsView({
  upcomingBookings,
  pastBookings,
  cancellationCutoffHours,
}: {
  upcomingBookings: ResolvedBooking[];
  pastBookings: ResolvedBooking[];
  cancellationCutoffHours: number;
}) {
  const router = useRouter();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [errorByBookingId, setErrorByBookingId] = useState<Record<string, string>>({});
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleCancel(bookingId: string) {
    setCancellingId(bookingId);
    setErrorByBookingId((prev) => ({ ...prev, [bookingId]: "" }));
    setSuccessMessage(null);

    try {
      const res = await fetch("/api/bookings/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setErrorByBookingId((prev) => ({
          ...prev,
          [bookingId]: data?.message ?? "Could not cancel this booking.",
        }));
        return;
      }

      setSuccessMessage(data?.message ?? "Booking cancelled.");
      router.refresh();
    } catch {
      setErrorByBookingId((prev) => ({
        ...prev,
        [bookingId]: "Something went wrong. Please try again.",
      }));
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
        <p className="text-sm uppercase tracking-[0.24em] text-teal-400">
          Bookings
        </p>
        <h2 className="mt-2 text-3xl font-semibold text-zinc-50">
          My bookings
        </h2>
        <p className="mt-3 max-w-2xl text-sm text-zinc-400">
          Classes you&apos;ve booked, in one place. Cancelling at least{" "}
          {cancellationCutoffHours}h before a class restores your session — cancelling
          later doesn&apos;t.
        </p>
      </div>

      {successMessage ? (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {successMessage}
        </p>
      ) : null}

      <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
        <h3 className="text-lg font-semibold text-zinc-50">Upcoming</h3>

        {upcomingBookings.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-400">
            You don&apos;t have any upcoming bookings.{" "}
            <Link
              href="/dashboard/schedule"
              className="text-teal-400 transition hover:text-teal-300"
            >
              Browse the schedule
            </Link>{" "}
            to book a class.
          </p>
        ) : (
          <div className="mt-5 space-y-3">
            {upcomingBookings.map((booking) => (
              <BookingCard
                key={booking.bookingId}
                booking={booking}
                cancellable
                isCancelling={cancellingId === booking.bookingId}
                error={errorByBookingId[booking.bookingId]}
                onCancel={() => handleCancel(booking.bookingId)}
              />
            ))}
          </div>
        )}
      </div>

      {pastBookings.length > 0 ? (
        <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
          <h3 className="text-lg font-semibold text-zinc-50">Past</h3>
          <div className="mt-5 space-y-3">
            {pastBookings.map((booking) => (
              <BookingCard key={booking.bookingId} booking={booking} cancellable={false} />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function BookingCard({
  booking,
  cancellable,
  isCancelling,
  error,
  onCancel,
}: {
  booking: ResolvedBooking;
  cancellable: boolean;
  isCancelling?: boolean;
  error?: string;
  onCancel?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-zinc-500">
            {booking.date} · {booking.startTime}
          </p>
          <h4 className="mt-1 text-base font-semibold text-zinc-100">
            {booking.title}
          </h4>
          <p className="mt-2 text-sm text-zinc-400">Coach: {booking.coachEmail}</p>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          {cancellable ? (
            <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300">
              Confirmed
            </span>
          ) : (
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                booking.attended
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-zinc-800 text-zinc-400"
              }`}
            >
              {booking.attended ? "Attended" : "Not checked in"}
            </span>
          )}
          <span className="rounded-full bg-zinc-950 px-3 py-1 text-xs font-medium text-zinc-300">
            {booking.durationMins} min
          </span>

          {cancellable ? (
            <button
              type="button"
              onClick={onCancel}
              disabled={isCancelling}
              className="rounded-xl border border-zinc-700 px-3 py-1 text-xs font-medium text-zinc-200 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isCancelling ? "Cancelling…" : "Cancel"}
            </button>
          ) : null}
        </div>
      </div>

      {cancellable ? (
        <p
          className={`mt-3 text-xs ${
            booking.willRestoreSession ? "text-zinc-500" : "text-amber-400"
          }`}
        >
          {booking.willRestoreSession
            ? "Cancelling now will restore your session credit."
            : "Cancelling now will not restore your session credit — too close to the class start."}
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
