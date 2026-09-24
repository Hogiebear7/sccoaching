// TRIAL-ONLY — see docs/bug-reports.md for the full removal checklist.
import { findAllBugReports, findProfileByUserId, findUserById } from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { requireStaffPage } from "@/lib/staff-auth";
import { BugReportsView } from "./BugReportsView";

export default async function StaffBugReportsPage() {
  const staff = await requireStaffPage("bugReports.manage");

  // A report belongs to its reporter's gym (report -> userId -> gym). Only the
  // acting staff member's own gym's reports are listed (gymId null = primary
  // gym); a report whose reporter can't be resolved is excluded (fail closed),
  // before the reporter's profile is read.
  const reports = findAllBugReports()
    .map((r) => ({ report: r, user: findUserById(r.userId) }))
    .filter(({ user }) => !!user && sameGym(staff, user))
    .map(({ report: r, user }) => {
      const profile = findProfileByUserId(r.userId);
      return {
        ...r,
        reporterEmail: user?.email ?? "Unknown member",
        reporterName: profile?.fullName ?? null,
      };
    });

  return <BugReportsView reports={reports} />;
}
