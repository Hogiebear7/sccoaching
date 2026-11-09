import { gymReportRows } from "@/lib/gym-reports-view";
import { requireStaffPage } from "@/lib/staff-auth";
import { GymCommunityReportsView } from "./GymCommunityReportsView";

// Reports of posts and comments in this gym's community, and of groups whose organiser belongs to this gym. Own gym only (the rows come from the signed-in
// staff member's gym), and only for staff who can moderate comments.
export default async function StaffGymCommunityPage() {
  const me = await requireStaffPage("comments.moderate");
  return <GymCommunityReportsView reports={gymReportRows(me.gymId ?? null)} />;
}
