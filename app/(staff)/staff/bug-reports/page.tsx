// TRIAL-ONLY — see docs/bug-reports.md for the full removal checklist.
import { findAllBugReports, findProfileByUserId, findUserById } from "@/lib/db";
import { requireStaffPage } from "@/lib/staff-auth";
import { BugReportsView } from "./BugReportsView";

export default async function StaffBugReportsPage() {
  await requireStaffPage("bugReports.manage");

  const reports = findAllBugReports().map((r) => {
    const user = findUserById(r.userId);
    const profile = findProfileByUserId(r.userId);
    return {
      ...r,
      reporterEmail: user?.email ?? "Unknown member",
      reporterName: profile?.fullName ?? null,
    };
  });

  return <BugReportsView reports={reports} />;
}
