import { buildClassReportRows, buildMemberSignupRows, buildSubscriptionRows } from "@/lib/reports";
import { requireStaffPage } from "@/lib/staff-auth";
import { ReportsView } from "./ReportsView";

export default async function StaffReportsPage() {
  await requireStaffPage("reports.view");

  const members = buildMemberSignupRows();
  const subscriptions = buildSubscriptionRows();
  const classes = buildClassReportRows();

  return <ReportsView members={members} subscriptions={subscriptions} classes={classes} />;
}
