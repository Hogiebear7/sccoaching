import {
  findMembershipBillingOptionById,
  findMembershipPackageById,
  findMembershipPlanById,
  type BillingInterval,
  type MembershipBillingOptionRecord,
  type MembershipPackageRecord,
  type MembershipPlanRecord,
  type SubscriptionRecord,
} from "./db";

// Single resolver for "what is this subscription entitled to?".
//
// The entitlement engine (allowance math, booking consumption, waitlist
// eligibility, webhook renewal, member/staff views) is deep and tested and
// reads a MembershipPlanRecord-shaped object. Rather than teach every
// call-site about the new catalog, we return that same shape here — derived
// from the catalog PACKAGE when the subscription is catalog-backed, or from
// the legacy plan otherwise. Downstream code never changes.

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

// The one call-site replacement: `sub?.planId ? findMembershipPlanById(...) : undefined`
// becomes `resolveSubscriptionEntitlement(sub)`.
export function resolveSubscriptionEntitlement(
  subscription: SubscriptionRecord | undefined | null
): MembershipPlanRecord | undefined {
  if (!subscription) return undefined;

  if (subscription.packageId) {
    const pkg = findMembershipPackageById(subscription.packageId);
    if (pkg) {
      const option = subscription.billingOptionId
        ? findMembershipBillingOptionById(subscription.billingOptionId)
        : undefined;
      return planShapeForPackage(pkg, option);
    }
    // Package vanished — fall through to any legacy plan link.
  }

  return subscription.planId ? findMembershipPlanById(subscription.planId) : undefined;
}
