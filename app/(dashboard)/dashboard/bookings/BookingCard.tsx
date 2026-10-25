import { formatFriendlyClassDate } from "@/lib/dates";
import type { ResolvedBooking } from "@/lib/bookings";
import { StatusBadge } from "@/components/member/ListGroup";

// Day + date together (friendly weekday format with Today/Tomorrow
// prefixes), matching Schedule's own date-group headings.
const formatDayDate = formatFriendlyClassDate;

// Shared booking row — used by the standalone Bookings page (upcoming +
// past, with a "hero" variant for the soonest booking) and Schedule's "My
// bookings" tab (upcoming only, plain). One implementation, one set of
// token semantics, so the two surfaces can no longer drift the way the
// old separately-written copies did.
//
// Member-app layout (DESIGN.md "Member app"): a typographic time rail (Teko
// time, duration) like Home's next-session card, then title, date, coach and
// a semantic status. Past rows are quieter (muted rail) so upcoming reads
// first.
export function BookingCard({
  booking,
  cancellable,
  hero = false,
  isCancelling,
  error,
  onCancel,
}: {
  booking: ResolvedBooking;
  cancellable: boolean;
  hero?: boolean;
  isCancelling?: boolean;
  error?: string;
  onCancel?: () => void;
}) {
  return (
    <div className={hero ? "surface-card surface-card--accent overflow-hidden" : "surface-card overflow-hidden"}>
      <div className="flex items-stretch">
        <div
          className={`flex shrink-0 flex-col items-center justify-center border-r border-white/[0.06] bg-[var(--bg-0)] px-2 py-4 ${
            hero ? "w-[96px] sm:w-[112px]" : "w-[84px] sm:w-[96px]"
          }`}
        >
          <span className={`text-headline tabular-nums ${cancellable ? "text-zinc-50" : "text-zinc-400"} ${hero ? "text-[34px]" : "text-[28px]"}`}>
            {booking.startTime}
          </span>
          <span className="mt-1 text-xs font-medium text-zinc-400 tabular-nums">{booking.durationMins} min</span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">{formatDayDate(booking.date)}</p>
            <h3 className={`mt-1 truncate font-semibold text-zinc-50 ${hero ? "text-lg" : "text-base"}`}>{booking.title}</h3>
            <p className="mt-1 truncate text-sm text-zinc-400">Coach: {booking.coachEmail}</p>
          </div>

          <div className="flex shrink-0 flex-row flex-wrap items-center gap-2 sm:flex-col sm:items-end">
            {cancellable ? (
              <StatusBadge tone="good">Confirmed</StatusBadge>
            ) : booking.attended ? (
              <StatusBadge tone="good">Attended</StatusBadge>
            ) : (
              <StatusBadge tone="neutral">Not checked in</StatusBadge>
            )}

            {cancellable ? (
              <button
                type="button"
                onClick={onCancel}
                disabled={isCancelling}
                className="inline-flex min-h-10 items-center rounded-[3px] border border-white/[0.14] px-3.5 text-sm font-medium text-zinc-200 transition-colors duration-150 hover:border-white/[0.3] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isCancelling ? "Cancelling…" : "Cancel booking"}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {cancellable ? (
        <p
          className={`border-t border-white/[0.06] px-4 py-3 text-sm sm:px-5 ${
            booking.willRestoreSession ? "text-zinc-400" : "text-[var(--warning)]"
          }`}
        >
          {booking.willRestoreSession
            ? "Cancelling now will restore your session credit."
            : "Cancelling now will not restore your session credit — too close to the class start."}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mx-4 mb-4 rounded-[3px] border-l-2 border-[var(--danger)] bg-[var(--danger-weak)] px-3 py-2 text-sm text-red-200 sm:mx-5">
          {error}
        </p>
      ) : null}
    </div>
  );
}
