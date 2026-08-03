"use client";

import { formatFriendlyClassDate } from "@/lib/dates";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ClassCategoryRecord, ClassRecord } from "@/lib/db";
import type { ResolvedBooking } from "@/lib/bookings";
import { classCategoryLabel } from "@/lib/scheduling-status";
import { ClassImageSlot } from "@/components/ui/ClassImageSlot";
import { WorkoutTypeIcon, workoutTypeFromLabel } from "@/components/graphics/WorkoutTypeIcon";
import { BookingCard } from "../bookings/BookingCard";
import { ScheduleCalendar } from "./ScheduleCalendar";

export type ScheduleClass = ClassRecord & {
  coachEmail: string;
  bookedCount: number;
  isBookedByMe: boolean;
  isWaitlistedByMe: boolean;
  waitlistPosition: number | null;
  waitlistOfferState: "queued" | "offered" | null;
  waitlistEntryId: string | null;
  offerExpiresAt: string | null;
  isFull: boolean;
  blockReason: string | null;
};

// Shared friendly format (adds Today/Tomorrow prefixes) keeps the group
// headings and booking rows reading the same way.
const formatGroupDate = formatFriendlyClassDate;

// Schedule — same IA-first standard as Workouts/Nutrition/Recovery/
// Notifications/Bookings, built on top of the Phase 1 shared bookings
// extraction. Browse (discovery/booking/waitlist/live availability) and My
// bookings (in-context confirmation of what you're already committed to)
// stay two distinct jobs within one screen, exactly as they were — this
// pass doesn't merge them, it makes each one legible on its own terms.
// Booking/waitlist transaction logic (handleBook/handleWaitlist/
// handleRespond/handleCancelBooking) and every API call are unchanged.
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
  upcomingBookings: ResolvedBooking[];
  cancellationCutoffHours: number;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"browse" | "calendar" | "bookings">("browse");
  const [submittingClassId, setSubmittingClassId] = useState<string | null>(null);
  const [errorByClassId, setErrorByClassId] = useState<Record<string, string>>({});
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [cancellingBookingId, setCancellingBookingId] = useState<string | null>(null);
  const [cancelBookingError, setCancelBookingError] = useState<Record<string, string>>({});
  const [respondingEntryId, setRespondingEntryId] = useState<string | null>(null);
  const [respondError, setRespondError] = useState<Record<string, string>>({});

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

  async function handleRespond(entryId: string, action: "accept" | "reject") {
    setRespondingEntryId(entryId);
    setRespondError((prev) => ({ ...prev, [entryId]: "" }));
    setSuccessMessage(null);

    try {
      const res = await fetch("/api/bookings/waitlist/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId, action }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setRespondError((prev) => ({
          ...prev,
          [entryId]: data?.message ?? "Could not respond to this offer.",
        }));
        return;
      }

      setSuccessMessage(data?.message ?? (action === "accept" ? "Booking confirmed!" : "Offer declined."));
      router.refresh();
    } catch {
      setRespondError((prev) => ({
        ...prev,
        [entryId]: "Something went wrong. Please try again.",
      }));
    } finally {
      setRespondingEntryId(null);
    }
  }

  const classesByDate = classes.reduce<Record<string, ScheduleClass[]>>((acc, cls) => {
    if (!acc[cls.date]) acc[cls.date] = [];
    acc[cls.date].push(cls);
    return acc;
  }, {});
  const sortedDates = Object.keys(classesByDate).sort();

  // Surfaced above the calendar so a time-sensitive offer doesn't depend on
  // scrolling to whatever date it happens to fall on — same reasoning as
  // Notifications' "Needs a response" group.
  const pendingOffers = classes.filter((c) => c.waitlistOfferState === "offered" && c.waitlistEntryId);

  // Extracted so the Calendar tab's day-detail panel can render the exact
  // same card — with the same booking/waitlist logic and state — as the
  // Browse list, rather than a second, divergent copy.
  function renderClassCard(classRecord: ScheduleClass) {
    const isSubmitting = submittingClassId === classRecord.id;
    const cardError = errorByClassId[classRecord.id];

    const categoryText = classCategoryLabel(categories, classRecord.category, deletedLabels);
    const spotsLeft = Math.max(0, classRecord.capacity - classRecord.bookedCount);
    const status = classStatus(classRecord);

    return (
      <article
        key={classRecord.id}
        className="surface-card relative overflow-hidden transition-colors duration-200 hover:border-white/[0.18]"
      >
        <div className="flex items-stretch gap-0">
          {/* Image-forward accent rail with the time overlaid */}
          <div className="relative w-[84px] shrink-0 sm:w-[104px]">
            <ClassImageSlot
              seed={classRecord.category || classRecord.id}
              label={categoryText}
              imageUrl={classRecord.imageUrl}
              alt={classRecord.imageAlt}
              className="absolute inset-0"
            />
            <div className="relative flex h-full flex-col justify-between p-2.5">
              <span className="text-condensed text-[22px] leading-none text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.7)] tabular-nums">
                {classRecord.startTime}
              </span>
              <span className="text-[10px] font-medium uppercase tracking-wide text-white/75">
                {classRecord.durationMins} min
              </span>
            </div>
          </div>

          {/* Details + actions */}
          <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.09] bg-white/[0.05] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                <WorkoutTypeIcon type={workoutTypeFromLabel(categoryText)} className="h-2.5 w-2.5" />
                {categoryText}
              </span>
              <h4 className="text-condensed mt-1.5 truncate text-lg uppercase leading-tight text-foreground">
                {classRecord.title}
              </h4>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                Coach · {classRecord.coachEmail}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span className="tabular-nums">
                  {classRecord.bookedCount}/{classRecord.capacity} booked
                </span>
                {!classRecord.isFull && spotsLeft <= 3 ? (
                  <span className="font-medium text-[var(--warning)]">
                    {spotsLeft} spot{spotsLeft === 1 ? "" : "s"} left
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
              <StatusBadge status={status} />

              {classRecord.isBookedByMe ? null
                : classRecord.waitlistOfferState === "offered" && classRecord.waitlistEntryId ? (
                <div className="flex flex-col items-start gap-1 sm:items-end">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleRespond(classRecord.waitlistEntryId!, "accept")}
                      disabled={respondingEntryId === classRecord.waitlistEntryId}
                      className="btn-primary px-4 py-2 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {respondingEntryId === classRecord.waitlistEntryId ? "Confirming…" : "Accept"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRespond(classRecord.waitlistEntryId!, "reject")}
                      disabled={respondingEntryId === classRecord.waitlistEntryId}
                      className="rounded-lg border border-white/[0.09] px-4 py-2 text-sm font-medium text-zinc-300 transition hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Decline
                    </button>
                  </div>
                  {classRecord.offerExpiresAt && (
                    <p className="text-[11px] text-gold">
                      Expires {formatExpiry(classRecord.offerExpiresAt)}
                    </p>
                  )}
                </div>
              ) : classRecord.isWaitlistedByMe ? (
                <button
                  type="button"
                  onClick={() => handleWaitlist(classRecord.id, "leave")}
                  disabled={isSubmitting}
                  className="rounded-lg border border-white/[0.09] px-4 py-2 text-sm font-medium text-zinc-300 transition hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? "Updating…" : "Leave waitlist"}
                </button>
              ) : classRecord.blockReason ? null : classRecord.isFull ? (
                <button
                  type="button"
                  onClick={() => handleWaitlist(classRecord.id, "join")}
                  disabled={isSubmitting}
                  className="rounded-lg border border-white/[0.09] bg-white/[0.05] px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? "Joining…" : "Join waitlist"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleBook(classRecord.id)}
                  disabled={isSubmitting}
                  className="btn-primary px-4 py-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? "Booking…" : "Book"}
                </button>
              )}
            </div>
          </div>
        </div>

        {(classRecord.blockReason ||
          cardError ||
          (classRecord.waitlistEntryId && respondError[classRecord.waitlistEntryId])) && (
          <div className="space-y-2 px-4 pb-4">
            {classRecord.blockReason && (
              <p className="rounded-lg bg-white/[0.04] px-3 py-2 text-xs text-muted-foreground">
                Not bookable: {classRecord.blockReason}
              </p>
            )}

            {cardError && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {cardError}
              </p>
            )}

            {classRecord.waitlistEntryId && respondError[classRecord.waitlistEntryId] && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {respondError[classRecord.waitlistEntryId]}
              </p>
            )}
          </div>
        )}
      </article>
    );
  }

  return (
    <section className="anim-rise space-y-8">
      <div>
        <p className="text-mono text-[11px] uppercase tracking-[0.24em] text-gold">Club</p>
        <h1 className="text-editorial mt-2 text-[32px] leading-[1.05] text-zinc-50 sm:text-[36px]">
          Claim your spot, then show up.
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Browse upcoming classes and book your spot.
          {remainingSessions !== null && (
            <>
              {" "}·{" "}
              <span className="font-medium text-zinc-200">{remainingSessions}</span>{" "}
              session{remainingSessions === 1 ? "" : "s"} remaining.
            </>
          )}
        </p>
      </div>

      {noActiveMembership && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--warning)]/25 bg-[var(--warning-weak)] p-3 text-sm text-[var(--warning)]">
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

      {successMessage && (
        <p className="rounded-lg border border-[var(--success)]/30 bg-[var(--success-weak)] px-4 py-3 text-sm text-[var(--success)]">
          {successMessage}
        </p>
      )}

      <div className="inline-flex rounded-full border border-white/[0.1] bg-white/[0.03] p-1">
        <button
          type="button"
          onClick={() => setTab("browse")}
          className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition ${
            tab === "browse" ? "bg-primary text-primary-foreground" : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Browse
        </button>
        <button
          type="button"
          onClick={() => setTab("calendar")}
          className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition ${
            tab === "calendar" ? "bg-primary text-primary-foreground" : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Calendar
        </button>
        <button
          type="button"
          onClick={() => setTab("bookings")}
          className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition ${
            tab === "bookings" ? "bg-primary text-primary-foreground" : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          My bookings{upcomingBookings.length > 0 ? ` (${upcomingBookings.length})` : ""}
        </button>
      </div>

      {tab === "browse" && (
        <>
          {pendingOffers.length > 0 && (
            <div className="surface-card surface-card--accent overflow-hidden">
              <div className="p-4 sm:p-5">
                <p className="label-caps text-[9px] text-gold">Needs a response</p>
                <div className="mt-3 space-y-2.5">
                  {pendingOffers.map((c) => (
                    <div
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gold/20 bg-gold/[0.05] px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{c.title}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatGroupDate(c.date)} · {c.startTime}
                          {c.offerExpiresAt ? ` · Expires ${formatExpiry(c.offerExpiresAt)}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => handleRespond(c.waitlistEntryId!, "accept")}
                          disabled={respondingEntryId === c.waitlistEntryId}
                          className="btn-primary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {respondingEntryId === c.waitlistEntryId ? "Confirming…" : "Accept"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRespond(c.waitlistEntryId!, "reject")}
                          disabled={respondingEntryId === c.waitlistEntryId}
                          className="rounded-lg border border-white/[0.09] px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {classes.length === 0 ? (
            <div className="empty-state">
              <p className="text-sm font-medium">No classes scheduled yet</p>
              <p className="mt-1 text-xs text-muted-foreground">Check back soon.</p>
            </div>
          ) : (
            <div className="space-y-5">
              {sortedDates.map((date) => (
                <section key={date}>
                  <p className="mb-2 px-1 label-caps">{formatGroupDate(date)}</p>
                  <div className="space-y-3">
                    {classesByDate[date].map((classRecord) => renderClassCard(classRecord))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "calendar" && (
        <ScheduleCalendar classesByDate={classesByDate} renderClass={renderClassCard} />
      )}

      {/* My bookings tab — quick, in-context confirmation of what you're
          already committed to, upcoming only. Renders the exact same
          BookingCard the standalone Bookings page uses (Phase 1), so
          "Confirmed", success tokens, and cancel behavior can't drift
          between the two surfaces again. */}
      {tab === "bookings" && (
        upcomingBookings.length === 0 ? (
          <div className="empty-state">
            <p className="text-sm font-medium">No upcoming bookings</p>
            <p className="mt-1 text-xs text-muted-foreground">Browse the schedule to book a session.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {upcomingBookings.map((booking) => (
              <BookingCard
                key={booking.bookingId}
                booking={booking}
                cancellable
                isCancelling={cancellingBookingId === booking.bookingId}
                error={cancelBookingError[booking.bookingId]}
                onCancel={() => handleCancelBooking(booking.bookingId)}
              />
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

type StatusKind = "booked" | "offered" | "waitlisted" | "ineligible" | "full" | "available";

// The six Browse states can't each get their own distinct color in this
// palette — --primary, --gold, and --warning all sit in the same amber hue
// family (see the palette-semantics audit in memory), and forcing six
// unique hues would just recreate that collision with different tokens.
// Instead: three states that are genuinely distinct in meaning get three
// genuinely distinct tokens (success/gold/data); the two "not bookable
// right now" states (ineligible, full) share one neutral treatment and are
// told apart by icon + label instead; "available" — the calm, unremarkable
// default — deliberately carries the least visual weight, since the Book
// button next to it is the real call to action.
function classStatus(classRecord: ScheduleClass): { kind: StatusKind; label: string } {
  if (classRecord.isBookedByMe) return { kind: "booked", label: "Booked" };
  if (classRecord.waitlistOfferState === "offered") return { kind: "offered", label: "Offer pending" };
  if (classRecord.isWaitlistedByMe) return { kind: "waitlisted", label: `Waitlisted #${classRecord.waitlistPosition}` };
  if (classRecord.blockReason) return { kind: "ineligible", label: "Not eligible" };
  if (classRecord.isFull) return { kind: "full", label: "Full" };
  return { kind: "available", label: "Available" };
}

const STATUS_STYLE: Record<StatusKind, string> = {
  booked: "border-[var(--success)]/25 bg-[var(--success-weak)] text-[var(--success)]",
  // Reuses the exact star glyph and gold treatment Notifications uses for
  // "waitlist_offer" — the same real-world event should look the same
  // wherever it surfaces.
  offered: "border-gold/25 bg-gold/15 text-gold",
  waitlisted: "border-data/25 bg-data/15 text-data",
  ineligible: "border-white/[0.09] bg-white/[0.05] text-zinc-500",
  full: "border-white/[0.09] bg-white/[0.05] text-zinc-400",
  available: "border-white/[0.09] text-zinc-400",
};

const STATUS_ICON: Record<StatusKind, string> = {
  booked: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  offered:
    "M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z",
  waitlisted: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  ineligible: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z",
  full: "M18.364 5.636L5.636 18.364M12 21a9 9 0 100-18 9 9 0 000 18z",
  available: "M12 4v16m8-8H4",
};

function StatusBadge({ status }: { status: { kind: StatusKind; label: string } }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLE[status.kind]}`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 shrink-0">
        <path d={STATUS_ICON[status.kind]} />
      </svg>
      {status.label}
    </span>
  );
}

function formatExpiry(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return "expired";
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 60) return `in ${diffMins} min`;
  const diffHrs = Math.floor(diffMins / 60);
  const remMins = diffMins % 60;
  return remMins > 0 ? `in ${diffHrs}h ${remMins}m` : `in ${diffHrs}h`;
}
