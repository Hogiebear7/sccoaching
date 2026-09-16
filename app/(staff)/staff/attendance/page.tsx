import { findAllBookings, findAttendanceWatchlist, findMembers, findProfileByUserId } from "@/lib/db";
import { staffCanViewMemberData } from "@/lib/member-tier-wall";
import { requireStaffPage } from "@/lib/staff-auth";
import { can } from "@/lib/permissions";
import { AttendanceView } from "./AttendanceView";

export default async function StaffAttendancePage() {
  const staffUser = await requireStaffPage("members.view");
  const canManageWatchlist = can(staffUser.role, "classes.manage");

  const allMembers = findMembers();
  // Attendance is coaching insight into a member's own activity — walled the
  // same as everything else in lib/member-tier-wall.ts.
  const activeMembers = allMembers.filter((m) => !m.archivedAt && staffCanViewMemberData(m.id));
  const bookings = findAllBookings();

  const attendedCounts = new Map<string, number>();
  for (const booking of bookings) {
    if (booking.attendedAt === null) continue;
    attendedCounts.set(booking.userId, (attendedCounts.get(booking.userId) ?? 0) + 1);
  }

  const leaderboard = activeMembers
    .map((member) => {
      const profile = findProfileByUserId(member.id);
      return {
        userId: member.id,
        name: profile?.fullName ?? member.email,
        email: member.email,
        classesAttended: attendedCounts.get(member.id) ?? 0,
      };
    })
    .sort((a, b) => b.classesAttended - a.classesAttended || a.name.localeCompare(b.name));

  const watchlist = findAttendanceWatchlist()
    .filter((entry) => staffCanViewMemberData(entry.userId))
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
