import { ensureSeriesOccurrences } from "@/lib/class-series";
import { sameGym } from "@/lib/gym-scope";
import { requireStaffPage } from "@/lib/staff-auth";
import {
  findBookingsByClassId,
  findClassSeries,
  findClassCategories,
  findClasses,
  findDeletedCategoryLabels,
  findProfileByUserId,
  findStaffUsers,
  findUserById,
  findWaitlistEntriesByClassId,
} from "@/lib/db";
import { ClassesView } from "./ClassesView";

export default async function StaffClassesPage() {
  const staff = await requireStaffPage("classes.manage");
  // Top up the rolling window of recurring occurrences on every staff visit
  // (idempotent) — the cron job is the backstop, this is the fast path.
  ensureSeriesOccurrences();

  const categories = findClassCategories();
  const deletedLabels = findDeletedCategoryLabels();
  // Everything on this page is scoped to the acting staff member's own gym
  // (the session user from requireStaffPage; no client value can broaden it).
  // A class belongs to the gym of its coach (class -> coachUserId -> gym, gymId
  // null = primary gym); a class whose coach can't be resolved is excluded (fail
  // closed). The filter runs BEFORE any booking, attendee or waitlist profile
  // lookup, so other gyms' classes contribute no data to the page props.
  const ownClasses = findClasses()
    .map((classRecord) => ({ classRecord, coach: findUserById(classRecord.coachUserId) }))
    .filter(({ coach }) => !!coach && sameGym(staff, coach));
  const classes = ownClasses.map(({ classRecord, coach }) => {
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
      coachEmail: coach?.email ?? "Unknown coach",
      bookedCount: bookings.length,
      roster,
      waitlist,
    };
  });

  // The coach picker and the recurring-series list carry coach identities and
  // class schedules, so they are scoped the same way: own-gym staff only, and
  // only series whose coach resolves to the acting staff member's gym.
  const coaches = findStaffUsers()
    .filter((u) => sameGym(staff, u))
    .map((u) => ({ userId: u.id, label: findProfileByUserId(u.id)?.fullName ?? u.email }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <ClassesView
      classes={classes}
      categories={categories}
      deletedLabels={deletedLabels}
      series={findClassSeries().filter((sr) => {
        const coach = findUserById(sr.coachUserId);
        return !!coach && sameGym(staff, coach);
      })}
      coaches={coaches}
    />
  );
}
