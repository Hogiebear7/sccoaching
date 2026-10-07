import {
  appendIapEvent,
  findMembershipCategories,
  findMembershipPackageById,
  findMembershipPackages,
  findSubscriptionByUserId,
  findUserById,
  saveSubscription,
  type MembershipPackageRecord,
  type MoneyRecordOwnerGym,
  type StoredUser,
  type SubscriptionRecord,
} from "@/lib/db";
import { ownerGymForCatalogPackage, sameGym } from "@/lib/gym-scope";
import type { MemberTier } from "@/lib/member-access";
import { resolveMemberTier } from "@/lib/membership-entitlement";
import { cancelProviderSubscription } from "@/lib/billing";
import { evaluateEntitlementConflict, packageScopeResolver, type EntitlementConflictCode } from "@/lib/iap/entitlement-conflict";

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
  /** Set when the grant was refused because it would replace a live entitlement of the other
      kind or a live Google Play subscription. Stable; see lib/iap/entitlement-conflict.ts. */
  code?: EntitlementConflictCode;
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
  // Only computed when a row might not already exist (app_subscription and
  // membership branches) — the "free" branch always has an existing row
  // (guaranteed by its own early return below), so it never needs one.
  let freshOwnerGym: MoneyRecordOwnerGym | undefined;

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
    freshOwnerGym = { scope: "platform" };
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
    // pkg is never app_only here (checked above / excluded by
    // defaultMembershipPackage's own filter), so this always resolves "gym",
    // never "platform" — consistent with ownerGymForCatalogPackage's own logic.
    freshOwnerGym = ownerGymForCatalogPackage(pkg, findMembershipCategories().find((c) => c.id === pkg.categoryId));
  }

  // No overlap and no silent replacement (owner defaults D1 and D2). A staff, invite or other
  // manual grant may not replace a live entitlement of the other kind, nor any live Google Play
  // subscription. Grants that ARE a verified Play purchase (provider "google_play") are applied by
  // the Play verify and notification paths, which enforce their own rules (lib/iap).
  if ((options?.provider ?? "none") !== "google_play") {
    const entitling = tier !== "free" && (resolvedStatus === "active" || resolvedStatus === "past_due");
    const conflict = evaluateEntitlementConflict(
      existingSubscription,
      { kind: "staff_write", scope: tier === "free" ? null : tier === "app_subscription" ? "app_subscription" : "membership", entitling },
      packageScopeResolver
    );
    if (conflict) {
      appendIapEvent({ type: "staff_write_rejected", userId, actor: "staff", detail: { code: conflict.code, tier, source: "grantMemberTier" } });
      return { ok: false, message: conflict.message, code: conflict.code };
    }
  }

  // Walking away from a Google Play row (it has ended, or the conflict rules above would have refused) must not carry
  // the old Play purchase token, billing option or paid period over to a row that is no longer billed through Play.
  // An inherited past period end would make a freshly granted Membership look lapsed, and an inherited token is stale.
  const leavingPlay = existingSubscription?.provider === "google_play" && (options?.provider ?? "none") !== "google_play";

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
      options?.billingOptionId !== undefined ? options.billingOptionId : leavingPlay ? null : existingSubscription?.billingOptionId ?? null,
    status: resolvedStatus,
    pausedUntil: null,
    statusBeforePause: null,
    provider: options?.provider ?? "none",
    providerCustomerId: existingSubscription?.providerCustomerId ?? null,
    providerSubscriptionId:
      options?.providerSubscriptionId !== undefined
        ? options.providerSubscriptionId
        : leavingPlay
          ? null
          : existingSubscription?.providerSubscriptionId ?? null,
    providerSetupOrderId: existingSubscription?.providerSetupOrderId ?? null,
    currentPeriodEnd:
      options?.currentPeriodEnd !== undefined ? options.currentPeriodEnd : leavingPlay ? null : existingSubscription?.currentPeriodEnd ?? null,
    lastWebhookEventAt: existingSubscription?.lastWebhookEventAt ?? null,
    sessionsUsedThisPeriod: isEnteringFreshActivePeriod ? 0 : existingSubscription?.sessionsUsedThisPeriod ?? 0,
    extraSessionGrants: isEnteringFreshActivePeriod ? [] : existingSubscription?.extraSessionGrants ?? [],
    periodLapsedNotifiedAt: isEnteringFreshActivePeriod ? null : existingSubscription?.periodLapsedNotifiedAt ?? null,
    // Immutable historical provenance: if a row already exists, its ownerGym
    // wins EXACTLY as stored — falling back to explicit "unresolved" (never
    // silently recomputed) for a row that predates this field — even across
    // a tier CHANGE (e.g. Membership <-> App Subscription; see
    // SubscriptionRecord.ownerGym's own "known open question" comment in
    // lib/db.ts). Fresh ownership is only ever stamped the first time this
    // user gets a subscription row at all.
    ownerGym: existingSubscription ? existingSubscription.ownerGym ?? { scope: "unresolved" } : freshOwnerGym,
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
