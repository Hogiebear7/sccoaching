"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ResolvedBooking } from "@/lib/bookings";
import { ScreenHeader } from "@/components/member/ScreenHeader";
import { SegmentedControl } from "@/components/member/SegmentedControl";
import { ScheduleCalendar } from "../schedule/ScheduleCalendar";
import { BookingCard } from "./BookingCard";

// Past bookings shown before "Show all".
const PAST_PREVIEW = 5;

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
  const [view, setView] = useState<"list" | "calendar">("list");
  const [showAllPast, setShowAllPast] = useState(false);

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
  const visiblePast = showAllPast ? pastBookings : pastBookings.slice(0, PAST_PREVIEW);

  const bookingsByDate: Record<string, ResolvedBooking[]> = {};
  for (const b of [...upcomingBookings, ...pastBookings]) {
    (bookingsByDate[b.date] ??= []).push(b);
  }
  for (const list of Object.values(bookingsByDate)) list.sort((a, b) => a.startTime.localeCompare(b.startTime));

  function renderBooking(booking: ResolvedBooking) {
    return booking.isPast ? (
      <BookingCard key={booking.bookingId} booking={booking} cancellable={false} />
    ) : (
      <BookingCard
        key={booking.bookingId}
        booking={booking}
        cancellable
        isCancelling={cancellingId === booking.bookingId}
        error={errorByBookingId[booking.bookingId]}
        onCancel={() => handleCancel(booking.bookingId)}
      />
    );
  }

  return (
    <section className="anim-rise space-y-10">
      <ScreenHeader
        section="Club"
        title="Bookings"
        subtitle={
          <>
                Cancelling at least {cancellationCutoffHours}h before a class restores your session —
                cancelling later doesn&apos;t.
              </>
            }
          />

          {successMessage ? (
            <p className="rounded-lg border border-[var(--success)]/30 bg-[var(--success-weak)] px-4 py-3 text-sm text-[var(--success)]">
              {successMessage}
            </p>
          ) : null}

          <SegmentedControl
            label="Bookings view"
            options={[
              { value: "list", label: "List" },
              { value: "calendar", label: "Calendar" },
            ]}
            value={view}
            onChange={setView}
          />

          {view === "calendar" ? (
            <ScheduleCalendar classesByDate={bookingsByDate} renderClass={renderBooking} emptyText="No bookings on this day." />
          ) : (
            <>
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
              <p className="mt-1 text-xs text-muted-foreground">Book a class and it shows up here, with the option to cancel.</p>
              <p className="mt-4">
                <Link href="/dashboard/schedule" className="inline-flex min-h-11 items-center justify-center rounded-[3px] border border-white/[0.16] px-5 text-sm font-semibold text-zinc-100 transition-colors duration-150 hover:border-primary/50">
                  Browse the schedule
                </Link>
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
                {visiblePast.map((booking) => (
                  <BookingCard key={booking.bookingId} booking={booking} cancellable={false} />
                ))}
              </div>
              {pastBookings.length > PAST_PREVIEW ? (
                <button
                  type="button"
                  onClick={() => setShowAllPast((v) => !v)}
                  className="mt-3 inline-flex min-h-11 items-center px-1 text-sm font-semibold text-primary transition-colors duration-150 hover:text-[var(--primary-hover)]"
                >
                  {showAllPast ? "Show fewer" : `Show all (${pastBookings.length})`}
                </button>
              ) : null}
            </div>
          )}
        </>
      )}
    </section>
  );
}
