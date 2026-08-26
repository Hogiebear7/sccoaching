import {
  findMembershipPackageById,
  findMembershipPackages,
  findSubscriptionByUserId,
  saveSubscription,
  type MembershipPackageRecord,
  type SubscriptionRecord,
} from "@/lib/db";
import type { MemberTier } from "@/lib/member-access";
import { resolveMemberTier } from "@/lib/membership-entitlement";
import { cancelProviderSubscription } from "@/lib/billing";

// The one catalog package Tier 2 grants are backed by (see
// scripts/seed-app-subscription-package.mjs) — billingChannel "manual",
// not visible in any self-serve list.
export const APP_SUBSCRIPTION_PACKAGE_SLUG = "app-subscription-tier-2";

function defaultMembershipPackage(): MembershipPackageRecord | undefined {
  return findMembershipPackages()
    .filter((p) => p.deliveryChannel !== "app_only")
    .sort((a, b) => a.sortOrder - b.sortOrder)[0];
}

export interface GrantTierResult {
  ok: boolean;
  message: string;
  warning?: string | null;
  tier?: MemberTier;
}

// Shared by the staff "change tier" route and invite redemption — both boil
// down to "grant this member this tier," resolved to a catalog package and
// saved as a SubscriptionRecord the same way POST .../subscription does its
// raw packageId+status override.
export async function grantMemberTier(
  userId: string,
  tier: MemberTier,
  options?: { packageId?: string }
): Promise<GrantTierResult> {
  const existingSubscription = findSubscriptionByUserId(userId);

  let resolvedPackageId: string | null;
  let resolvedStatus: SubscriptionRecord["status"];

  if (tier === "free") {
    if (!existingSubscription || existingSubscription.status === "canceled") {
      return { ok: true, message: "This member is already on the Free tier.", tier: "free" };
    }
    resolvedPackageId = existingSubscription.packageId ?? null;
    resolvedStatus = "canceled";
  } else if (tier === "app_subscription") {
    const pkg = findMembershipPackages().find((p) => p.slug === APP_SUBSCRIPTION_PACKAGE_SLUG);
    if (!pkg) {
      return {
        ok: false,
        message: "The App Subscription package hasn't been set up yet. Run `npm run seed:app-subscription-package -- --confirm`.",
      };
    }
    resolvedPackageId = pkg.id;
    resolvedStatus = "active";
  } else {
    let pkg: MembershipPackageRecord | undefined;
    if (options?.packageId) {
      pkg = findMembershipPackageById(options.packageId);
      if (!pkg || pkg.deliveryChannel === "app_only") {
        return { ok: false, message: "That package isn't a Membership-tier package." };
      }
    } else {
      pkg = defaultMembershipPackage();
    }
    if (!pkg) {
      return { ok: false, message: "No Membership-tier package exists to assign." };
    }
    resolvedPackageId = pkg.id;
    resolvedStatus = "active";
  }

  const now = new Date().toISOString();
  const isEnteringFreshActivePeriod =
    resolvedStatus === "active" &&
    (existingSubscription?.status !== "active" || existingSubscription?.packageId !== resolvedPackageId);

  // A manual/invite grant always records provider: "none", but a live
  // Stripe subscription being walked away from locally needs cancelling at
  // the provider too, or Stripe keeps billing with nothing surfacing the
  // mismatch.
  let providerCancelWarning: string | null = null;

  if (existingSubscription?.provider === "stripe" && existingSubscription.providerSubscriptionId) {
    const result = await cancelProviderSubscription({
      provider: "stripe",
      providerSubscriptionId: existingSubscription.providerSubscriptionId,
    });

    if (!result.ok) {
      providerCancelWarning = `Tier updated, but the live Stripe subscription could not be cancelled automatically (${result.message ?? "unknown error"}). Cancel it manually in the Stripe dashboard.`;
    }
  }

  const subscription: SubscriptionRecord = {
    userId,
    packageId: resolvedPackageId,
    billingOptionId: existingSubscription?.billingOptionId ?? null,
    status: resolvedStatus,
    pausedUntil: null,
    statusBeforePause: null,
    provider: "none",
    providerCustomerId: existingSubscription?.providerCustomerId ?? null,
    providerSubscriptionId: existingSubscription?.providerSubscriptionId ?? null,
    providerSetupOrderId: existingSubscription?.providerSetupOrderId ?? null,
    currentPeriodEnd: existingSubscription?.currentPeriodEnd ?? null,
    lastWebhookEventAt: existingSubscription?.lastWebhookEventAt ?? null,
    sessionsUsedThisPeriod: isEnteringFreshActivePeriod ? 0 : existingSubscription?.sessionsUsedThisPeriod ?? 0,
    extraSessionGrants: isEnteringFreshActivePeriod ? [] : existingSubscription?.extraSessionGrants ?? [],
    periodLapsedNotifiedAt: isEnteringFreshActivePeriod ? null : existingSubscription?.periodLapsedNotifiedAt ?? null,
    createdAt: existingSubscription?.createdAt ?? now,
    updatedAt: now,
  };

  saveSubscription(subscription);

  return {
    ok: true,
    message: providerCancelWarning ?? "Member tier updated.",
    warning: providerCancelWarning,
    tier: resolveMemberTier(subscription),
  };
}
