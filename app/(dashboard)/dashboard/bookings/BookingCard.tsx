import { formatFriendlyClassDate } from "@/lib/dates";
import type { ResolvedBooking } from "@/lib/bookings";
import { ClassImageSlot } from "@/components/ui/ClassImageSlot";

// Day + date together (friendly weekday format with Today/Tomorrow
// prefixes), matching Schedule's own date-group headings.
const formatDayDate = formatFriendlyClassDate;

// Shared booking row — used by the standalone Bookings page (upcoming +
// past, with a "hero" variant for the soonest booking) and Schedule's "My
// bookings" tab (upcoming only, plain). One implementation, one set of
// token semantics, so the two surfaces can no longer drift the way the
// old separately-written copies did.
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
        {/* Image rail — real class cover or on-brand placeholder — with the
            time overlaid (matches Home + Schedule). */}
        <div className={`relative shrink-0 ${hero ? "w-[104px] sm:w-[140px]" : "w-[84px] sm:w-[104px]"}`}>
          <ClassImageSlot
            seed={booking.category || booking.classId}
            label={booking.title}
            imageUrl={booking.imageUrl}
            alt={booking.imageAlt}
            // Past bookings: subtly mute the cover/placeholder (desaturate +
            // slightly dim) so completed items read as calmer at a glance,
            // independent of the status badge's color — a shape/texture
            // cue, not just a color one. The filter only touches this image
            // layer — the white time overlay sits in a sibling layer and
            // stays fully legible.
            className={`absolute inset-0 ${cancellable ? "" : "grayscale-[0.7] brightness-95"}`}
          />
          <div className="relative flex h-full flex-col justify-between p-2.5">
            <span className={`text-condensed leading-none text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.7)] tabular-nums ${hero ? "text-[26px]" : "text-[22px]"}`}>
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
            <h4 className={`mt-1 truncate font-semibold text-foreground ${hero ? "text-lg" : "text-base"}`}>
              {booking.title}
            </h4>
            <p className="mt-1 truncate text-sm text-muted-foreground">Coach: {booking.coachEmail}</p>
          </div>

          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            {cancellable ? (
              <span className="rounded-full border border-[var(--success)]/25 bg-[var(--success-weak)] px-3 py-1 text-xs font-semibold text-[var(--success)]">
                Confirmed
              </span>
            ) : (
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  booking.attended
                    ? "border border-[var(--success)]/25 bg-[var(--success-weak)] text-[var(--success)]"
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
                className="rounded-lg border border-white/[0.09] px-3 py-1 text-xs font-medium text-zinc-300 transition hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-60"
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
            booking.willRestoreSession ? "text-muted-foreground" : "text-[var(--warning)]"
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
