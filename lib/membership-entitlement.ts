import {
  findMembershipBillingOptionById,
  findMembershipPackageById,
  findSubscriptionByUserId,
  type BillingInterval,
  type MembershipBillingOptionRecord,
  type MembershipPackageRecord,
  type MembershipPlanRecord,
  type SubscriptionRecord,
} from "./db";
import type { MemberTier } from "./member-access";

// Single resolver for "what is this subscription entitled to?".
//
// The entitlement engine (allowance math, booking consumption, waitlist
// eligibility, webhook renewal, member/staff views) is deep and tested and
// reads a MembershipPlanRecord-shaped object. Rather than teach every
// call-site about the catalog, we return that same shape here — derived from
// the catalog PACKAGE the subscription is backed by. Downstream code never
// changes.

// A catalog billing option's cadence collapses onto the app's BillingInterval.
export function billingIntervalFromOption(
  option: Pick<MembershipBillingOptionRecord, "intervalUnit" | "intervalCount"> | undefined
): BillingInterval {
  if (!option || option.intervalUnit === null) return "monthly";
  if (option.intervalUnit === "year") return "annual";
  if (option.intervalUnit === "month" && option.intervalCount === 3) return "quarterly";
  return "monthly";
}

// Builds the plan-shaped entitlement for a catalog package. Exported so the
// checkout/webhook paths derive the same view without a subscription record.
export function planShapeForPackage(
  pkg: MembershipPackageRecord,
  option?: MembershipBillingOptionRecord
): MembershipPlanRecord {
  return {
    id: pkg.id,
    name: pkg.name,
    description: pkg.shortDescription,
    priceCents: option?.amountCents ?? 0,
    billingInterval: billingIntervalFromOption(option),
    // Entitlement lives on the package: unlimited → no cap; otherwise the
    // package's session count is the allowance.
    monthlySessionAllowance:
      pkg.sessionAllowanceType === "unlimited" ? null : pkg.sessionAllowanceCount ?? 0,
    allowedCategories: pkg.eligibleClassTypes,
    isActive: pkg.visible,
    createdAt: pkg.createdAt,
    updatedAt: pkg.updatedAt,
  };
}

// Resolves a subscription to its entitlement view. Returns undefined when the
// subscription isn't backed by a (still-present) catalog package.
export function resolveSubscriptionEntitlement(
  subscription: SubscriptionRecord | undefined | null
): MembershipPlanRecord | undefined {
  if (!subscription?.packageId) return undefined;

  const pkg = findMembershipPackageById(subscription.packageId);
  if (!pkg) return undefined;

  const option = subscription.billingOptionId
    ? findMembershipBillingOptionById(subscription.billingOptionId)
    : undefined;
  return planShapeForPackage(pkg, option);
}

// Resolves a subscription straight to one of the three member-facing access
// tiers (see lib/member-access.ts for what each tier unlocks). Reuses the
// deliveryChannel/accessType classification already on the catalog package —
// added specifically so Tier 2 app-only subscriptions could be told apart
// from Tier 1 in-person/hybrid memberships — rather than a separate stored
// field on the user, so tier can never drift out of sync with the real
// subscription state. No active subscription (or a subscription whose
// status isn't "active"/"past_due" — a lapsed/cancelled member reads the
// same as never having subscribed) is Free.
export function resolveMemberTier(subscription: SubscriptionRecord | undefined | null): MemberTier {
  if (!subscription?.packageId) return "free";
  if (subscription.status !== "active" && subscription.status !== "past_due") return "free";

  const pkg = findMembershipPackageById(subscription.packageId);
  if (!pkg) return "free";

  return pkg.deliveryChannel === "app_only" ? "app_subscription" : "membership";
}

// Convenience wrapper — the shape every /api/mobile/* route actually wants
// (they have a userId, not a SubscriptionRecord already in hand).
export function resolveMemberTierForUser(userId: string): MemberTier {
  return resolveMemberTier(findSubscriptionByUserId(userId));
}
