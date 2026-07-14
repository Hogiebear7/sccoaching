"use client";

import { formatFriendlyClassDate } from "@/lib/dates";
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

// Day + date together, matching the Schedule tab's presentation (friendly
// weekday format with Today/Tomorrow prefixes; locale pinned inside).
const formatDayDate = formatFriendlyClassDate;

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
      <div>
        <p className="label-caps">Club</p>
        <h2 className="text-display mt-1 text-[28px] leading-tight">
          My bookings
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Classes you&apos;ve booked, in one place. Cancelling at least{" "}
          {cancellationCutoffHours}h before a class restores your session — cancelling
          later doesn&apos;t.
        </p>
      </div>

      {successMessage ? (
        <p className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
          {successMessage}
        </p>
      ) : null}

      <div className="rounded-xl border border-border bg-card p-6">
        <h3 className="text-lg font-semibold">Upcoming</h3>

        {upcomingBookings.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            You don&apos;t have any upcoming bookings.{" "}
            <Link
              href="/dashboard/schedule"
              className="text-gold transition hover:text-gold/80"
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
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="text-lg font-semibold">Past</h3>
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
    <div className="well p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {formatDayDate(booking.date)} · {booking.startTime}
          </p>
          <h4 className="mt-1 text-base font-semibold text-foreground">
            {booking.title}
          </h4>
          <p className="mt-2 text-sm text-muted-foreground">Coach: {booking.coachEmail}</p>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          {cancellable ? (
            <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
              Confirmed
            </span>
          ) : (
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                booking.attended
                  ? "bg-primary/15 text-primary"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {booking.attended ? "Attended" : "Not checked in"}
            </span>
          )}
          <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
            {booking.durationMins} min
          </span>

          {cancellable ? (
            <button
              type="button"
              onClick={onCancel}
              disabled={isCancelling}
              className="rounded-lg border border-border px-3 py-1 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isCancelling ? "Cancelling…" : "Cancel"}
            </button>
          ) : null}
        </div>
      </div>

      {cancellable ? (
        <p
          className={`mt-3 text-xs ${
            booking.willRestoreSession ? "text-muted-foreground" : "text-amber-400"
          }`}
        >
          {booking.willRestoreSession
            ? "Cancelling now will restore your session credit."
            : "Cancelling now will not restore your session credit — too close to the class start."}
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
