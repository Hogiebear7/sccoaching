import { countSubscriptionsByPlanId, findClassCategories, findDeletedCategoryLabels, findMembershipPlans } from "@/lib/db";
import { getBillingConfigurationStatus } from "@/lib/billing";
import { PlansView } from "./PlansView";

export default async function StaffPlansPage() {
  const plans = findMembershipPlans();
  const categories = findClassCategories();
  const deletedLabels = findDeletedCategoryLabels();
  // Any subscription reference (whatever its status) blocks hard delete.
  const memberCounts = Object.fromEntries(
    plans.map((plan) => [plan.id, countSubscriptionsByPlanId(plan.id)])
  );

  return (
    <PlansView
      plans={plans}
      categories={categories}
      deletedLabels={deletedLabels}
      memberCounts={memberCounts}
      billingStatus={getBillingConfigurationStatus()}
    />
  );
}
