import { findClassCategories, findDeletedCategoryLabels, findRecentJobRuns } from "@/lib/db";
import { buildMemberOperationalSummaries, buildUpcomingClassPressureSummaries } from "@/lib/staff-operations";
import { OperationsView } from "./OperationsView";

export default async function StaffOperationsPage() {
  const members = buildMemberOperationalSummaries();
  const classes = buildUpcomingClassPressureSummaries();
  const jobRuns = findRecentJobRuns(20);
  const categories = findClassCategories();
  const deletedLabels = findDeletedCategoryLabels();

  return <OperationsView members={members} classes={classes} jobRuns={jobRuns} categories={categories} deletedLabels={deletedLabels} />;
}
