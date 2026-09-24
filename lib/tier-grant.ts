import {
  findMembershipCategories,
  findMembershipPackageById,
  findMembershipPackages,
  findSubscriptionByUserId,
  findUserById,
  saveSubscription,
  type MembershipPackageRecord,
  type StoredUser,
  type SubscriptionRecord,
} from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import type { MemberTier } from "@/lib/member-access";
import { resolveMemberTier } from "@/lib/membership-entitlement";
import { cancelProviderSubscription } from "@/lib/billing";

// The one catalog package Tier 2 grants are backed by (see
// scripts/seed-app-subscription-package.mjs) — billingChannel "manual",
// not visible in any self-serve list.
export const APP_SUBSCRIPTION_PACKAGE_SLUG = "app-subscription-tier-2";

// A Membership-tier package belongs to the gym of its category (package ->
// categoryId -> gymId; gymId null = primary gym, lib/gym-scope.ts). A grant may
// only ever attach a package owned by the RECEIVING member's own gym — the
// default pick and an explicitly requested packageId alike — so no gym's
// package can be assigned to another gym's member. (App Subscription is the
// platform-wide app-only package and is resolved separately, unchanged.)
function packageInMemberGym(pkg: MembershipPackageRecord, member: Pick<StoredUser, "gymId">): boolean {
  const category = findMembershipCategories().find((c) => c.id === pkg.categoryId);
  return !!category && sameGym(member, category);
}

function defaultMembershipPackage(member: Pick<StoredUser, "gymId">): MembershipPackageRecord | undefined {
  return findMembershipPackages()
    .filter((p) => p.deliveryChannel !== "app_only" && packageInMemberGym(p, member))
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
  options?: {
    packageId?: string;
    billingOptionId?: string | null;
    /** Defaults to "none" (manual/invite grant). Pass "google_play" when this
        grant is the result of a verified Play Billing purchase. */
    provider?: SubscriptionRecord["provider"];
    providerSubscriptionId?: string | null;
    currentPeriodEnd?: string | null;
    /** Overrides the tier's normal resolved status — used to grant
        "past_due" (Play grace period, member keeps access) or "paused"
        rather than the default "active". */
    status?: SubscriptionRecord["status"];
  }
): Promise<GrantTierResult> {
  const existingSubscription = findSubscriptionByUserId(userId);

  let resolvedPackageId: string | null;
  let resolvedStatus: SubscriptionRecord["status"];

  if (tier === "free") {
    if (!existingSubscription || existingSubscription.status === "canceled") {
      return { ok: true, message: "This member is already on the Free tier.", tier: "free" };
    }
    resolvedPackageId = existingSubscription.packageId ?? null;
    resolvedStatus = options?.status ?? "canceled";
  } else if (tier === "app_subscription") {
    const pkg = findMembershipPackages().find((p) => p.slug === APP_SUBSCRIPTION_PACKAGE_SLUG);
    if (!pkg) {
      return {
        ok: false,
        message: "The App Subscription package hasn't been set up yet. Run `npm run seed:app-subscription-package -- --confirm`.",
      };
    }
    resolvedPackageId = pkg.id;
    resolvedStatus = options?.status ?? "active";
  } else {
    // The receiving member's gym decides which packages are eligible.
    const member = findUserById(userId);
    if (!member) {
      return { ok: false, message: "Member not found." };
    }

    let pkg: MembershipPackageRecord | undefined;
    if (options?.packageId) {
      pkg = findMembershipPackageById(options.packageId);
      // A package from another gym reads exactly like an invalid one.
      if (!pkg || pkg.deliveryChannel === "app_only" || !packageInMemberGym(pkg, member)) {
        return { ok: false, message: "That package isn't a Membership-tier package." };
      }
    } else {
      pkg = defaultMembershipPackage(member);
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

  // A manual/invite grant (the default, provider: "none") walking away from
  // a live Stripe subscription needs to cancel it at the provider too, or
  // Stripe keeps billing with nothing surfacing the mismatch.
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
    billingOptionId:
      options?.billingOptionId !== undefined ? options.billingOptionId : existingSubscription?.billingOptionId ?? null,
    status: resolvedStatus,
    pausedUntil: null,
    statusBeforePause: null,
    provider: options?.provider ?? "none",
    providerCustomerId: existingSubscription?.providerCustomerId ?? null,
    providerSubscriptionId:
      options?.providerSubscriptionId !== undefined
        ? options.providerSubscriptionId
        : existingSubscription?.providerSubscriptionId ?? null,
    providerSetupOrderId: existingSubscription?.providerSetupOrderId ?? null,
    currentPeriodEnd:
      options?.currentPeriodEnd !== undefined ? options.currentPeriodEnd : existingSubscription?.currentPeriodEnd ?? null,
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
