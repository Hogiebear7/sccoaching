import { cookies } from "next/headers";

import {
  findClassCategories,
  findDeletedCategoryLabels,
  findMembershipPlanById,
  findMembershipPlans,
  findSubscriptionByUserId,
  findUserById,
} from "@/lib/db";
import { isBillingProviderConfigured } from "@/lib/billing";
import { classPassBalance } from "@/lib/scheduling-status";
import { verifySession } from "@/lib/session";
import { MembershipView } from "./MembershipView";

export default async function DashboardMembershipPage() {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-display text-[28px]">Membership</h1>
        </div>
        <div className="panel p-5">
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t load account data. Try logging out and back in.
          </p>
        </div>
      </div>
    );
  }

  const plans = findMembershipPlans().filter((plan) => plan.isActive);
  const subscription = findSubscriptionByUserId(user.id);
  const currentPlan = subscription?.planId ? findMembershipPlanById(subscription.planId) : undefined;

  return (
    <MembershipView
      plans={plans}
      categories={findClassCategories()}
      deletedLabels={findDeletedCategoryLabels()}
      currentPlanId={subscription?.planId ?? null}
      currentPlanName={currentPlan?.name ?? null}
      subscriptionStatus={subscription?.status ?? null}
      subscriptionUpdatedAt={subscription?.updatedAt ?? null}
      subscriptionCurrentPeriodEnd={subscription?.currentPeriodEnd ?? null}
      passBalance={
        currentPlan && subscription ? classPassBalance(currentPlan, subscription) : null
      }
      subscriptionProvider={subscription?.provider ?? null}
      billingConfigured={isBillingProviderConfigured()}
    />
  );
}
