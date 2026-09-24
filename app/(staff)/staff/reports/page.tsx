import { buildClassReportRows, buildMemberSignupRows, buildSubscriptionRows } from "@/lib/reports";
import { requireStaffPage } from "@/lib/staff-auth";
import { ReportsView } from "./ReportsView";

export default async function StaffReportsPage() {
  const staff = await requireStaffPage("reports.view");

  // Scoped to the acting staff member's own gym (see lib/reports.ts).
  const members = buildMemberSignupRows(staff);
  const subscriptions = buildSubscriptionRows(staff);
  const classes = buildClassReportRows(staff);

  return <ReportsView members={members} subscriptions={subscriptions} classes={classes} />;
}
