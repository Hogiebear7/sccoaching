import {
  findDigitalEntitlementsByUserId,
  findMembershipBillingOptionById,
  findMembershipPackageById,
  findSubscriptionByUserId,
  findUserById,
  type BillingInterval,
  type DigitalEntitlementRecord,
  type MembershipBillingOptionRecord,
  type MembershipPackageRecord,
  type MembershipPlanRecord,
  type SubscriptionRecord,
} from "./db";
import { liveDigitalEntitlements } from "./digital-entitlement";
import type { MemberAccess } from "./member-access";
import { hasOwnerAccess } from "./permissions";

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

// The two independent access facts for one member (see lib/member-access.ts for what each unlocks).
//
//   gymMembership: a catalog package that is NOT the app-only package, with status active or past_due. Derived from the
//     subscription row, never a stored flag, so it cannot drift out of sync with the real subscription state.
//   digital:       any live DigitalEntitlementRecord (lib/digital-entitlement.ts): a verified store subscription inside its
//     paid period, or a complimentary staff grant. A gym Membership contributes NOTHING to this (owner decision D1).
//
// Legacy rows: before the digital entitlement store existed, a complimentary App Subscription was a SubscriptionRecord on the
// app-only package with provider "none". Those rows keep granting digital access (they are the staff comps the owner already
// gave), read through legacyManualDigitalGrant below, until they are converted. A legacy row billed through Google Play is NOT
// honoured: in-app purchases were never switched on in any deployment, so no such row can be a real, paid subscription.
function legacyManualDigitalGrant(subscription: SubscriptionRecord | undefined | null, nowMs: number): boolean {
  if (!subscription?.packageId || subscription.provider !== "none") return false;
  if (subscription.status !== "active" && subscription.status !== "past_due") return false;
  const pkg = findMembershipPackageById(subscription.packageId);
  if (pkg?.deliveryChannel !== "app_only") return false;
  return !subscription.currentPeriodEnd || new Date(subscription.currentPeriodEnd).getTime() > nowMs;
}

function hasGymMembershipRow(subscription: SubscriptionRecord | undefined | null): boolean {
  if (!subscription?.packageId) return false;
  if (subscription.status !== "active" && subscription.status !== "past_due") return false;
  const pkg = findMembershipPackageById(subscription.packageId);
  return !!pkg && pkg.deliveryChannel !== "app_only";
}

export function computeMemberAccess(
  subscription: SubscriptionRecord | undefined | null,
  entitlements: readonly DigitalEntitlementRecord[],
  nowMs: number = Date.now()
): MemberAccess {
  return {
    gymMembership: hasGymMembershipRow(subscription),
    digital: liveDigitalEntitlements(entitlements, nowMs).length > 0 || legacyManualDigitalGrant(subscription, nowMs),
  };
}

// The shape every /api/mobile/* route and gated web route actually wants (they have a userId, not records in hand).
// Admin managers and the platform operator hold everything without a plan (lib/permissions.ts hasOwnerAccess).
export function resolveMemberAccessForUser(userId: string, nowMs: number = Date.now()): MemberAccess {
  const user = findUserById(userId);
  if (user && !user.archivedAt && hasOwnerAccess(user.role)) return { gymMembership: true, digital: true };
  return computeMemberAccess(findSubscriptionByUserId(userId), findDigitalEntitlementsByUserId(userId), nowMs);
}
