import { findClassCategories, findDeletedCategoryLabels, findMembershipPlans } from "@/lib/db";
import { getBillingConfigurationStatus } from "@/lib/billing";
import { PlansView } from "./PlansView";

export default async function StaffPlansPage() {
  const plans = findMembershipPlans();
  const categories = findClassCategories();
  const deletedLabels = findDeletedCategoryLabels();

  return <PlansView plans={plans} categories={categories} deletedLabels={deletedLabels} billingStatus={getBillingConfigurationStatus()} />;
}
