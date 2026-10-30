import { findAllBookings, findAttendanceWatchlist, findMembers, findProfileByUserId } from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { staffCanViewMemberData } from "@/lib/member-tier-wall";
import { requireStaffPage } from "@/lib/staff-auth";
import { can } from "@/lib/permissions";
import { AttendanceView } from "./AttendanceView";

// Classes attended per member: all time, in the last 30 days, and the date of the latest.
function attendanceByMember(bookings: ReturnType<typeof findAllBookings>) {
  const since30 = Date.now() - 30 * 86_400_000;
  const attended = new Map<string, { total: number; last30: number; last: string | null }>();
  for (const booking of bookings) {
    if (booking.attendedAt === null) continue;
    const t = attended.get(booking.userId) ?? { total: 0, last30: 0, last: null };
    t.total++;
    if (new Date(booking.attendedAt).getTime() >= since30) t.last30++;
    if (!t.last || booking.attendedAt > t.last) t.last = booking.attendedAt;
    attended.set(booking.userId, t);
  }
  return attended;
}

export default async function StaffAttendancePage() {
  const staffUser = await requireStaffPage("members.view");
  const canManageWatchlist = can(staffUser.role, "classes.manage");

  const allMembers = findMembers().filter((m) => sameGym(staffUser, m));
  // Attendance is coaching insight into a member's own activity — walled the
  // same as everything else in lib/member-tier-wall.ts.
  const activeMembers = allMembers.filter((m) => !m.archivedAt && staffCanViewMemberData(m.id));
  const bookings = findAllBookings();

  const attended = attendanceByMember(bookings);

  const leaderboard = activeMembers
    .map((member) => {
      const profile = findProfileByUserId(member.id);
      return {
        userId: member.id,
        name: profile?.fullName ?? member.email,
        email: member.email,
        classesAttended: attended.get(member.id)?.total ?? 0,
        last30Days: attended.get(member.id)?.last30 ?? 0,
        lastAttended: attended.get(member.id)?.last?.slice(0, 10) ?? null,
      };
    })
    .sort((a, b) => b.classesAttended - a.classesAttended || a.name.localeCompare(b.name));

  const watchlist = findAttendanceWatchlist()
    // allMembers is already gym-scoped, so checking membership there covers
    // the gym check; staffCanViewMemberData covers the tier wall.
    .filter((entry) => allMembers.some((m) => m.id === entry.userId) && staffCanViewMemberData(entry.userId))
    .map((entry) => {
      const member = allMembers.find((m) => m.id === entry.userId);
      const profile = findProfileByUserId(entry.userId);
      return {
        id: entry.id,
        userId: entry.userId,
        name: profile?.fullName ?? member?.email ?? "Unknown member",
        email: member?.email ?? null,
        monthKey: entry.monthKey,
        missCount: entry.missCount,
        addedAt: entry.addedAt,
      };
    });

  return <AttendanceView leaderboard={leaderboard} watchlist={watchlist} canManageWatchlist={canManageWatchlist} />;
}
