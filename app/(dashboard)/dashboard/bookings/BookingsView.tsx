"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ResolvedBooking } from "@/lib/bookings";
import { BookingCard } from "./BookingCard";

// Bookings — same IA-first standard as Workouts/Nutrition/Recovery/
// Notifications: the soonest upcoming booking gets a real "Next up" hero
// instead of sitting in an undifferentiated stack, the rest of what's
// booked sits below it at normal weight, and past bookings stay visible
// (this is the member's own attendance record, not disposable reference
// material — same reasoning as Workouts' History) but read visually
// calmer. The booking row itself now lives in the shared BookingCard —
// Schedule's "My bookings" tab renders the exact same component, so the
// two surfaces can't drift the way the old separately-written copies did.
// Cancellation/booking logic and the /api/bookings/cancel call are
// unchanged.
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

  const [heroBooking, ...restUpcoming] = upcomingBookings;

  return (
    <section className="anim-rise space-y-10">
      <div>
        <p className="text-mono text-[11px] uppercase tracking-[0.24em] text-gold">Club</p>
        <h1 className="text-editorial mt-2 text-[32px] leading-[1.05] text-zinc-50 sm:text-[36px]">
          Your training, booked and on record.
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Cancelling at least {cancellationCutoffHours}h before a class restores your session —
          cancelling later doesn&apos;t.
        </p>
      </div>

      {successMessage ? (
        <p className="rounded-lg border border-[var(--success)]/30 bg-[var(--success-weak)] px-4 py-3 text-sm text-[var(--success)]">
          {successMessage}
        </p>
      ) : null}

      {/* Next up — the single most useful fact this screen can answer at a
          glance: what's my very next commitment. Gold accent here means
          "look at this one first," not a status — the Confirmed badge
          inside carries the actual state. */}
      {heroBooking ? (
        <div>
          <p className="mb-3 px-1 label-caps">Next up</p>
          <BookingCard
            booking={heroBooking}
            cancellable
            hero
            isCancelling={cancellingId === heroBooking.bookingId}
            error={errorByBookingId[heroBooking.bookingId]}
            onCancel={() => handleCancel(heroBooking.bookingId)}
          />
        </div>
      ) : (
        <div className="empty-state">
          <p className="text-sm font-medium">No upcoming bookings</p>
          <p className="mt-1 text-xs text-muted-foreground">
            <Link href="/dashboard/schedule" className="text-gold transition hover:text-gold/80">
              Browse the schedule
            </Link>{" "}
            to book a class.
          </p>
        </div>
      )}

      {restUpcoming.length > 0 && (
        <div>
          <p className="mb-3 px-1 label-caps">Also booked</p>
          <div className="space-y-3">
            {restUpcoming.map((booking) => (
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
        </div>
      )}

      {pastBookings.length > 0 && (
        <div>
          <p className="mb-3 px-1 label-caps">Past</p>
          <div className="space-y-3">
            {pastBookings.map((booking) => (
              <BookingCard key={booking.bookingId} booking={booking} cancellable={false} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
