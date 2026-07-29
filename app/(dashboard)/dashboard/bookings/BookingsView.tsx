"use client";

import { formatFriendlyClassDate } from "@/lib/dates";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ClassImageSlot } from "@/components/ui/ClassImageSlot";

type ResolvedBooking = {
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
    <div
      className={`overflow-hidden rounded-2xl border bg-white/[0.015] ${
        cancellable ? "border-primary/20" : "border-border/70"
      }`}
    >
      <div className="flex items-stretch">
        {/* Image rail — real class cover or on-brand placeholder — with the
            time overlaid (matches Home + Schedule). */}
        <div className="relative w-[84px] shrink-0 sm:w-[104px]">
          <ClassImageSlot
            seed={booking.category || booking.classId}
            label={booking.title}
            imageUrl={booking.imageUrl}
            alt={booking.imageAlt}
            // Past bookings: subtly mute the cover/placeholder (desaturate +
            // slightly dim) so completed items read as calmer at a glance. The
            // filter only touches this image layer — the white time overlay
            // sits in a sibling layer and stays fully legible.
            className={`absolute inset-0 ${cancellable ? "" : "grayscale-[0.7] brightness-95"}`}
          />
          <div className="relative flex h-full flex-col justify-between p-2.5">
            <span className="text-condensed text-[22px] leading-none text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.7)] tabular-nums">
              {booking.startTime}
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wide text-white/75">
              {booking.durationMins} min
            </span>
          </div>
        </div>

        {/* Details + status/actions */}
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {formatDayDate(booking.date)}
            </p>
            <h4 className="mt-1 truncate text-base font-semibold text-foreground">
              {booking.title}
            </h4>
            <p className="mt-1 truncate text-sm text-muted-foreground">Coach: {booking.coachEmail}</p>
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
      </div>

      {cancellable ? (
        <p
          className={`px-4 pb-3 text-xs ${
            booking.willRestoreSession ? "text-muted-foreground" : "text-amber-400"
          }`}
        >
          {booking.willRestoreSession
            ? "Cancelling now will restore your session credit."
            : "Cancelling now will not restore your session credit — too close to the class start."}
        </p>
      ) : null}

      {error ? (
        <p className="mx-4 mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
