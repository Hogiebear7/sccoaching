import { findSubscriptionByUserId, findUserById } from "./db";
import { isBillingProviderConfigured } from "./billing";
import { isPeriodLapsed } from "./membership-status";
import { resolveSubscriptionEntitlement } from "./membership-entitlement";
import { expiringPassSummary, purchasedPassBalance } from "./payments";
import { classPassBalance } from "./scheduling-status";

export interface MembershipData {
  currentPlanName: string | null;
  subscriptionStatus: string | null;
  isPeriodLapsed: boolean;
  subscriptionCurrentPeriodEnd: string | null;
  subscriptionPausedUntil: string | null;
  // Distinct from "unlimited" (hasActivePassAllowance=true, remaining=null):
  // this is false when there's no active plan to have a balance under at all.
  hasActivePassAllowance: boolean;
  passBalanceRemaining: number | null; // meaningful only when hasActivePassAllowance; null there = unlimited
  purchasedPasses: number;
  expiringPassesCount: number;
  expiringPassesSoonestAt: string | null;
  billingConfigured: boolean;
}

// Mobile-first read-only membership status view: current plan, pass
// balance, expiring passes. The web MembershipView additionally has the
// full purchasable catalog (categories/packages/billing options) and the
// Stripe checkout flow — deliberately not rushed onto mobile tonight (real
// payments deserve careful, dedicated design, not a 2am build); see the
// "Sports Performance Drink calculator" — style follow-up task for that.
export function getMembershipData(userId: string | undefined): MembershipData | null {
  const user = userId ? findUserById(userId) : undefined;
  if (!user) return null;

  const subscription = findSubscriptionByUserId(user.id);
  const currentPlan = resolveSubscriptionEntitlement(subscription);
  const lapsed = subscription ? isPeriodLapsed({ status: subscription.status, currentPeriodEnd: subscription.currentPeriodEnd ?? null }) : false;
  const expiring = expiringPassSummary(user.id, 30);
  const hasActivePassAllowance = !!(currentPlan && subscription && subscription.status === "active" && !lapsed);

  return {
    currentPlanName: currentPlan?.name ?? null,
    subscriptionStatus: subscription?.status ?? null,
    isPeriodLapsed: lapsed,
    subscriptionCurrentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    subscriptionPausedUntil: subscription?.pausedUntil ?? null,
    hasActivePassAllowance,
    passBalanceRemaining: hasActivePassAllowance ? classPassBalance(currentPlan!, subscription!).remaining : null,
    purchasedPasses: purchasedPassBalance(user.id),
    expiringPassesCount: expiring?.count ?? 0,
    expiringPassesSoonestAt: expiring?.soonestExpiresAt ?? null,
    billingConfigured: isBillingProviderConfigured(),
  };
}
