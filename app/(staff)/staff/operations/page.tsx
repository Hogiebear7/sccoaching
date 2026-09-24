import {
  countClassesByCategorySlug,
  countPackagesByEligibleClassType,
  findClassCategories,
  findDeletedCategoryLabels,
  findRecentJobRuns,
  getReadinessAlertSettings,
  getTransactionalEmailSettings,
} from "@/lib/db";
import { requireStaffPage } from "@/lib/staff-auth";
import { buildMemberOperationalSummaries, buildUpcomingClassPressureSummaries } from "@/lib/staff-operations";
import { OperationsView } from "./OperationsView";

export default async function StaffOperationsPage() {
  const staff = await requireStaffPage("operations.view");
  // Members and classes are scoped to the acting staff member's own gym (see
  // lib/staff-operations.ts). The remaining props are platform-global by
  // current design (job runs, class types, email/readiness settings).
  const members = buildMemberOperationalSummaries(staff);
  const classes = buildUpcomingClassPressureSummaries(staff);
  const jobRuns = findRecentJobRuns(20);
  const deletedLabels = findDeletedCategoryLabels();

  // Class types with live usage counts so staff can see what's safe to delete.
  const classTypes = findClassCategories().map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    classCount: countClassesByCategorySlug(c.slug),
    packageCount: countPackagesByEligibleClassType(c.slug),
  }));

  return (
    <OperationsView
      members={members}
      classes={classes}
      jobRuns={jobRuns}
      categories={findClassCategories()}
      deletedLabels={deletedLabels}
      classTypes={classTypes}
      emailSettings={getTransactionalEmailSettings()}
      readinessAlertSettings={getReadinessAlertSettings()}
    />
  );
}
