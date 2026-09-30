import {
  countClassesByCategorySlug,
  countPackagesByEligibleClassType,
  findClassCategories,
  findDeletedCategoryLabels,
  findRecentJobRuns,
  getReadinessAlertSettings,
  getTransactionalEmailSettings,
} from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { requireStaffPage } from "@/lib/staff-auth";
import { buildMemberOperationalSummaries, buildUpcomingClassPressureSummaries } from "@/lib/staff-operations";
import { OperationsView } from "./OperationsView";

export default async function StaffOperationsPage() {
  const staff = await requireStaffPage("operations.view");
  // Members and classes are scoped to the acting staff member's own gym (see
  // lib/staff-operations.ts). Class types (below) are now gym-owned too —
  // see ClassCategoryRecord.gymId. Job runs and email/readiness settings
  // remain platform-global by current design.
  const members = buildMemberOperationalSummaries(staff);
  const classes = buildUpcomingClassPressureSummaries(staff);
  const jobRuns = findRecentJobRuns(20);
  const deletedLabels = findDeletedCategoryLabels();

  // Only the acting staff member's own gym's class types — this is the
  // create/rename/delete management surface, so it must match exactly what
  // app/api/staff/categories/route.ts and its delete route will actually
  // authorize. Usage counts stay a global slug count (see
  // countClassesByCategorySlug's own comment): the slug namespace is still
  // shared across gyms even though category MANAGEMENT is now gym-owned.
  const ownGymCategories = findClassCategories().filter((c) => sameGym(staff, c));
  const classTypes = ownGymCategories.map((c) => ({
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
