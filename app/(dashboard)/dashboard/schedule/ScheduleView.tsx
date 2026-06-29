"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ClassCategoryRecord, ClassRecord } from "@/lib/db";
import { classCategoryLabel } from "@/lib/scheduling-status";

type ScheduleClass = ClassRecord & {
  coachEmail: string;
  bookedCount: number;
  isBookedByMe: boolean;
  isWaitlistedByMe: boolean;
  waitlistPosition: number | null;
  isFull: boolean;
  blockReason: string | null;
};

type UpcomingBooking = {
  bookingId: string;
  classId: string;
  title: string;
  date: string;
  startTime: string;
  durationMins: number;
  coachEmail: string;
  willRestoreSession: boolean;
};

function formatGroupDate(isoDate: string): string {
  return new Date(isoDate + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function ScheduleView({
  classes,
  categories,
  deletedLabels,
  remainingSessions,
  noActiveMembership,
  upcomingBookings,
  cancellationCutoffHours,
}: {
  classes: ScheduleClass[];
  categories: ClassCategoryRecord[];
  deletedLabels: Record<string, string>;
  remainingSessions: number | null;
  noActiveMembership: boolean;
  upcomingBookings: UpcomingBooking[];
  cancellationCutoffHours: number;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"browse" | "bookings">("browse");
  const [submittingClassId, setSubmittingClassId] = useState<string | null>(null);
  const [errorByClassId, setErrorByClassId] = useState<Record<string, string>>({});
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [cancellingBookingId, setCancellingBookingId] = useState<string | null>(null);
  const [cancelBookingError, setCancelBookingError] = useState<Record<string, string>>({});

  async function handleBook(classId: string) {
    setSubmittingClassId(classId);
    setErrorByClassId((prev) => ({ ...prev, [classId]: "" }));
    setSuccessMessage(null);

    try {
      const res = await fetch("/api/bookings/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setErrorByClassId((prev) => ({
          ...prev,
          [classId]: data?.message ?? "Could not book this class.",
        }));
        return;
      }

      setSuccessMessage(data?.message ?? "Class booked.");
      router.refresh();
    } catch {
      setErrorByClassId((prev) => ({
        ...prev,
        [classId]: "Something went wrong. Please try again.",
      }));
    } finally {
      setSubmittingClassId(null);
    }
  }

  async function handleWaitlist(classId: string, action: "join" | "leave") {
    setSubmittingClassId(classId);
    setErrorByClassId((prev) => ({ ...prev, [classId]: "" }));
    setSuccessMessage(null);

    try {
      const res = await fetch(`/api/bookings/waitlist/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setErrorByClassId((prev) => ({
          ...prev,
          [classId]: data?.message ?? "Could not update the waitlist.",
        }));
        return;
      }

      setSuccessMessage(data?.message ?? (action === "join" ? "Added to the waitlist." : "Removed from the waitlist."));
      router.refresh();
    } catch {
      setErrorByClassId((prev) => ({
        ...prev,
        [classId]: "Something went wrong. Please try again.",
      }));
    } finally {
      setSubmittingClassId(null);
    }
  }

  async function handleCancelBooking(bookingId: string) {
    setCancellingBookingId(bookingId);
    setCancelBookingError((prev) => ({ ...prev, [bookingId]: "" }));
    setSuccessMessage(null);

    try {
      const res = await fetch("/api/bookings/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setCancelBookingError((prev) => ({
          ...prev,
          [bookingId]: data?.message ?? "Could not cancel this booking.",
        }));
        return;
      }

      setSuccessMessage(data?.message ?? "Booking cancelled.");
      router.refresh();
    } catch {
      setCancelBookingError((prev) => ({
        ...prev,
        [bookingId]: "Something went wrong. Please try again.",
      }));
    } finally {
      setCancellingBookingId(null);
    }
  }

  const classesByDate = classes.reduce<Record<string, ScheduleClass[]>>((acc, cls) => {
    if (!acc[cls.date]) acc[cls.date] = [];
    acc[cls.date].push(cls);
    return acc;
  }, {});
  const sortedDates = Object.keys(classesByDate).sort();

  return (
    <section className="space-y-5 pt-2">

      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse upcoming classes and book your spot.
          {remainingSessions !== null && (
            <>
              {" "}·{" "}
              <span className="font-medium text-foreground">{remainingSessions}</span>{" "}
              session{remainingSessions === 1 ? "" : "s"} remaining.
            </>
          )}
        </p>
      </div>

      {/* No membership alert */}
      {noActiveMembership && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-400">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 mt-px">
            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>
            No active membership — booking is blocked.{" "}
            <Link href="/dashboard/membership" className="font-medium underline underline-offset-2">
              Select a plan
            </Link>{" "}
            to unlock.
          </span>
        </div>
      )}

      {/* Success message */}
      {successMessage && (
        <p className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
          {successMessage}
        </p>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl bg-muted p-1">
        <button
          type="button"
          onClick={() => setTab("browse")}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
            tab === "browse"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Browse
        </button>
        <button
          type="button"
          onClick={() => setTab("bookings")}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
            tab === "bookings"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          My bookings{upcomingBookings.length > 0 ? ` (${upcomingBookings.length})` : ""}
        </button>
      </div>

      {/* Browse tab */}
      {tab === "browse" && (
        classes.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-card p-8 text-center">
            <p className="text-sm font-medium">No classes scheduled yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Check back soon.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {sortedDates.map((date) => (
              <section key={date}>
                <p className="mb-2 px-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  {formatGroupDate(date)}
                </p>
                <div className="space-y-3">
                  {classesByDate[date].map((classRecord) => {
                    const isSubmitting = submittingClassId === classRecord.id;
                    const cardError = errorByClassId[classRecord.id];

                    return (
                      <div
                        key={classRecord.id}
                        className="rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-xs text-muted-foreground">
                              {classRecord.startTime}
                            </p>
                            <h4 className="mt-1 text-base font-semibold">
                              {classRecord.title}
                            </h4>
                            <p className="mt-1 text-sm text-muted-foreground">
                              Coach: {classRecord.coachEmail}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <span className="rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground">
                                {classCategoryLabel(categories, classRecord.category, deletedLabels)}
                              </span>
                              <span className="rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground">
                                {classRecord.durationMins} min · {classRecord.bookedCount}/{classRecord.capacity}
                              </span>
                            </div>
                          </div>

                          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                            <span
                              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusStyle(classRecord)}`}
                            >
                              {statusLabel(classRecord)}
                            </span>

                            {classRecord.isBookedByMe ? null : classRecord.isWaitlistedByMe ? (
                              <button
                                type="button"
                                onClick={() => handleWaitlist(classRecord.id, "leave")}
                                disabled={isSubmitting}
                                className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {isSubmitting ? "Updating…" : "Leave waitlist"}
                              </button>
                            ) : classRecord.blockReason ? null : classRecord.isFull ? (
                              <button
                                type="button"
                                onClick={() => handleWaitlist(classRecord.id, "join")}
                                disabled={isSubmitting}
                                className="rounded-xl border border-border bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {isSubmitting ? "Joining…" : "Join waitlist"}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleBook(classRecord.id)}
                                disabled={isSubmitting}
                                className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {isSubmitting ? "Booking…" : "Book"}
                              </button>
                            )}
                          </div>
                        </div>

                        {classRecord.blockReason && (
                          <p className="mt-3 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
                            Not bookable: {classRecord.blockReason}
                          </p>
                        )}

                        {cardError && (
                          <p className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                            {cardError}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )
      )}

      {/* My bookings tab */}
      {tab === "bookings" && (
        upcomingBookings.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-card p-8 text-center">
            <p className="text-sm font-medium">No upcoming bookings</p>
            <p className="mt-1 text-xs text-muted-foreground">Browse the schedule to book a session.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {upcomingBookings.map((booking) => (
              <div key={booking.bookingId} className="rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {booking.date} · {booking.startTime}
                    </p>
                    <h4 className="mt-1 text-sm font-semibold">{booking.title}</h4>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {booking.durationMins} min · {booking.coachEmail}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className="rounded-full border border-emerald-500/20 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-400">
                      Booked
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCancelBooking(booking.bookingId)}
                      disabled={cancellingBookingId === booking.bookingId}
                      className="rounded-xl border border-border px-3 py-1 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {cancellingBookingId === booking.bookingId ? "Cancelling…" : "Cancel"}
                    </button>
                  </div>
                </div>
                <p className={`mt-2 text-xs ${booking.willRestoreSession ? "text-muted-foreground" : "text-amber-400"}`}>
                  {booking.willRestoreSession
                    ? "Cancelling now will restore your session credit."
                    : "Cancelling now will not restore your session credit — too close to the class start."}
                </p>
                {cancelBookingError[booking.bookingId] && (
                  <p className="mt-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {cancelBookingError[booking.bookingId]}
                  </p>
                )}
              </div>
            ))}
            {cancellationCutoffHours > 0 && (
              <p className="px-1 text-[11px] text-muted-foreground">
                Cancel at least {cancellationCutoffHours}h before a class to restore your session credit.
              </p>
            )}
          </div>
        )
      )}

    </section>
  );
}

function statusLabel(classRecord: ScheduleClass): string {
  if (classRecord.isBookedByMe) return "Booked";
  if (classRecord.isWaitlistedByMe) return `Waitlisted #${classRecord.waitlistPosition}`;
  if (classRecord.blockReason) return "Not eligible";
  if (classRecord.isFull) return "Full";
  return "Available";
}

function statusStyle(classRecord: ScheduleClass): string {
  if (classRecord.isBookedByMe) return "bg-emerald-500/15 text-emerald-400 border-emerald-500/20";
  if (classRecord.isWaitlistedByMe) return "bg-amber-500/15 text-amber-400 border-amber-500/20";
  if (classRecord.blockReason) return "bg-muted text-muted-foreground border-border";
  if (classRecord.isFull) return "bg-amber-500/15 text-amber-400 border-amber-500/20";
  return "bg-primary/10 text-primary border-primary/20";
}
