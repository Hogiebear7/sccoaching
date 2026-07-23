import { cookies } from "next/headers";

import {
  findMembershipBillingOptions,
  findMembershipCategories,
  findMembershipPackages,
  findSubscriptionByUserId,
  findUserById,
} from "@/lib/db";
import { isBillingProviderConfigured } from "@/lib/billing";
import { isPeriodLapsed } from "@/lib/membership-status";
import { resolveSubscriptionEntitlement } from "@/lib/membership-entitlement";
import { expiringPassSummary, purchasedPassBalance } from "@/lib/payments";
import { classPassBalance } from "@/lib/scheduling-status";
import { verifySession } from "@/lib/session";
import { MembershipView } from "./MembershipView";

export default async function DashboardMembershipPage({
  searchParams,
}: {
  searchParams: Promise<{ passes?: string; membership?: string }>;
}) {
  // Return-from-Stripe banner state; informational only — entitlements come
  // from the webhook, never from this redirect. Accept both param names.
  const { passes, membership } = await searchParams;
  const raw = membership ?? passes;
  const passCheckoutStatus = raw === "pending" ? "pending" : raw === "cancelled" ? "cancelled" : null;

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

  const subscription = findSubscriptionByUserId(user.id);
  const currentPlan = resolveSubscriptionEntitlement(subscription);

  // "Your plan" awareness in the catalog: only mark the catalog package/option
  // a member is ACTIVELY on (active + not lapsed). A lapsed/past-due/canceled
  // member should be free to re-subscribe, so we don't mark or block those.
  // Legacy subscriptions (planId, no packageId) leave both null — nothing in
  // the catalog matches, so the browser shows no "Your plan" marker and the
  // status card above still names their plan. Graceful, documented fallback.
  const activeUnlapsed =
    subscription?.status === "active" &&
    !isPeriodLapsed({ status: subscription.status, currentPeriodEnd: subscription.currentPeriodEnd ?? null });
  const currentPackageId = activeUnlapsed ? subscription?.packageId ?? null : null;
  const currentBillingOptionId = activeUnlapsed ? subscription?.billingOptionId ?? null : null;

  // Only visible catalog rows reach members; entitlement stays on the package.
  const categories = findMembershipCategories().filter((c) => c.visible);
  const packages = findMembershipPackages().filter((p) => p.visible);
  const billingOptions = findMembershipBillingOptions().filter((o) => o.visible);

  return (
    <MembershipView
      categories={categories}
      packages={packages}
      billingOptions={billingOptions}
      currentPackageId={currentPackageId}
      currentBillingOptionId={currentBillingOptionId}
      currentPlanId={subscription?.packageId ?? subscription?.planId ?? null}
      currentPlanName={currentPlan?.name ?? null}
      subscriptionStatus={subscription?.status ?? null}
      subscriptionUpdatedAt={subscription?.updatedAt ?? null}
      subscriptionCurrentPeriodEnd={subscription?.currentPeriodEnd ?? null}
      passBalance={currentPlan && subscription ? classPassBalance(currentPlan, subscription) : null}
      purchasedPasses={purchasedPassBalance(user.id)}
      expiringPasses={expiringPassSummary(user.id, 30)}
      passCheckoutStatus={passCheckoutStatus}
      billingConfigured={isBillingProviderConfigured()}
    />
  );
}
