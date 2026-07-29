import { ensureSeriesOccurrences } from "@/lib/class-series";
import { requireStaffPage } from "@/lib/staff-auth";
import {
  findBookingsByClassId,
  findClassSeries,
  findClassCategories,
  findClasses,
  findDeletedCategoryLabels,
  findProfileByUserId,
  findUserById,
  findWaitlistEntriesByClassId,
} from "@/lib/db";
import { ClassesView } from "./ClassesView";

export default async function StaffClassesPage() {
  await requireStaffPage("classes.manage");
  // Top up the rolling window of recurring occurrences on every staff visit
  // (idempotent) — the cron job is the backstop, this is the fast path.
  ensureSeriesOccurrences();

  const categories = findClassCategories();
  const deletedLabels = findDeletedCategoryLabels();
  const classes = findClasses().map((classRecord) => {
    const bookings = findBookingsByClassId(classRecord.id);
    const roster = bookings.map((booking) => {
      const bookedUser = findUserById(booking.userId);
      const bookedProfile = bookedUser ? findProfileByUserId(bookedUser.id) : undefined;

      return {
        bookingId: booking.id,
        userId: booking.userId,
        email: bookedUser?.email ?? "Unknown member",
        fullName: bookedProfile?.fullName ?? null,
        attendedAt: booking.attendedAt,
      };
    });

    const waitlist = findWaitlistEntriesByClassId(classRecord.id).map((entry, index) => {
      const waitlistedUser = findUserById(entry.userId);
      const waitlistedProfile = waitlistedUser ? findProfileByUserId(waitlistedUser.id) : undefined;

      return {
        userId: entry.userId,
        email: waitlistedUser?.email ?? "Unknown member",
        fullName: waitlistedProfile?.fullName ?? null,
        position: index + 1,
      };
    });

    return {
      ...classRecord,
      coachEmail: findUserById(classRecord.coachUserId)?.email ?? "Unknown coach",
      bookedCount: bookings.length,
      roster,
      waitlist,
    };
  });

  return (
    <ClassesView
      classes={classes}
      categories={categories}
      deletedLabels={deletedLabels}
      series={findClassSeries()}
    />
  );
}
