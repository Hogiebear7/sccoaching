import { findMembershipPlans, findSubscriptionByUserId } from "./db";
import { isPeriodLapsed } from "./membership-status";

// Whether this gym currently has any plan a member could subscribe to.
// Booking gating only kicks in once this is true — so existing demo data
// with no plans configured keeps behaving exactly as before.
export function membershipIsRequired(): boolean {
  return findMembershipPlans().some((plan) => plan.isActive);
}

export function hasActiveMembership(userId: string): boolean {
  const subscription = findSubscriptionByUserId(userId);
  if (!subscription || subscription.status !== "active") return false;
  return !isPeriodLapsed(subscription);
}
