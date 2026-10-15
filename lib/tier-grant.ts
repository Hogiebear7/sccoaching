import {
  findDigitalEntitlement,
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
import { grantStaffDigitalEntitlement, revokeStaffDigitalEntitlement } from "@/lib/digital-entitlement";
import { ownerGymForCatalogPackage, sameGym } from "@/lib/gym-scope";
import type { MemberAccess } from "@/lib/member-access";
import { resolveMemberAccessForUser } from "@/lib/membership-entitlement";
import { cancelProviderSubscription } from "@/lib/billing";

// The one catalog package the App-only digital plan's store products are mapped to (see
// scripts/seed-app-subscription-package.mjs). It carries the price/period catalog for the store products only. Since owner
// decision D1 (2026-10-15) it is NOT something a gym Membership grants, and no member's SubscriptionRecord points at it.
export const APP_SUBSCRIPTION_PACKAGE_SLUG = "app-subscription-tier-2";

// What a staff member or an invite can grant. The three names are kept because stored invites and the staff API already use
// them, but they no longer form a ladder (owner decision D1): "membership" is the paid gym Membership (a SubscriptionRecord),
// "app_subscription" is a COMPLIMENTARY digital entitlement (a staff_grant DigitalEntitlementRecord, never a paid one), and
// "free" ends the gym Membership. Granting one never changes the other.
export type GrantTier = "free" | "app_subscription" | "membership";

// A Membership-tier package belongs to the gym of its category (package ->
// categoryId -> gymId; gymId null = primary gym, lib/gym-scope.ts). A grant may
// only ever attach a package owned by the RECEIVING member's own gym — the
// default pick and an explicitly requested packageId alike — so no gym's
// package can be assigned to another gym's member.
function packageInMemberGym(pkg: MembershipPackageRecord, member: Pick<StoredUser, "gymId">): boolean {
  const category = findMembershipCategories().find((c) => c.id === pkg.categoryId);
  return !!category && sameGym(member, category);
}

function defaultMembershipPackage(member: Pick<StoredUser, "gymId">): MembershipPackageRecord | undefined {
  return findMembershipPackages()
    .filter((p) => p.deliveryChannel !== "app_only" && packageInMemberGym(p, member))
    .sort((a, b) => a.sortOrder - b.sortOrder)[0];
}

// A SubscriptionRecord on the app-only package with provider "none": how a complimentary App Subscription was recorded before
// the digital entitlement store existed. lib/membership-entitlement.ts still reads such a row as digital access.
export function isLegacyDigitalCompRow(subscription: SubscriptionRecord | undefined | null): boolean {
  if (!subscription?.packageId || subscription.provider !== "none") return false;
  if (subscription.status !== "active" && subscription.status !== "past_due") return false;
  return findMembershipPackageById(subscription.packageId)?.deliveryChannel === "app_only";
}

export interface GrantTierResult {
  ok: boolean;
  message: string;
  warning?: string | null;
  /** The member's access after the grant. */
  access?: MemberAccess;
}

// Shared by the staff "grant" routes and invite redemption.
export async function grantMemberTier(
  userId: string,
  tier: GrantTier,
  options?: {
    packageId?: string;
    /** Staff grant: the staff member's user id, for the audit trail. Null for an invite redemption. */
    grantedByUserId?: string | null;
    note?: string | null;
  }
): Promise<GrantTierResult> {
  const member = findUserById(userId);
  if (!member) return { ok: false, message: "Member not found." };

  // Complimentary digital access: a separate row in the digital entitlement store. It never touches the gym Membership
  // row, never cancels a provider subscription, and is shown to staff as complimentary, not as a paid subscription.
  if (tier === "app_subscription") {
    grantStaffDigitalEntitlement({ userId, grantedByUserId: options?.grantedByUserId ?? null, note: options?.note ?? null });
    return { ok: true, message: "Complimentary digital access granted.", access: resolveMemberAccessForUser(userId) };
  }

  const existingSubscription = findSubscriptionByUserId(userId);

  // A legacy complimentary App Subscription row is the digital access the owner already gave this member. Writing a gym
  // Membership over that row would silently end it, so it is carried into the digital entitlement store first. Not applied
  // to a free change: that leaves the row exactly as it is.
  const legacyDigitalComp = (): boolean => isLegacyDigitalCompRow(existingSubscription);

  let resolvedPackageId: string | null;
  let resolvedStatus: SubscriptionRecord["status"];
  let freshOwnerGym: MoneyRecordOwnerGym | undefined;

  if (tier === "free") {
    // Ends the gym Membership. A complimentary digital grant is a separate thing and is left alone (revoke it explicitly).
    if (!existingSubscription || existingSubscription.status === "canceled" || legacyDigitalComp()) {
      return { ok: true, message: "This member has no gym Membership to end.", access: resolveMemberAccessForUser(userId) };
    }
    resolvedPackageId = existingSubscription.packageId ?? null;
    resolvedStatus = "canceled";
  } else {
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
    // pkg is never app_only here, so this always resolves "gym", never "platform".
    freshOwnerGym = ownerGymForCatalogPackage(pkg, findMembershipCategories().find((c) => c.id === pkg.categoryId));

    // The Membership grant replaces the legacy digital comp row; keep the comp as a digital grant so access is not lost.
    if (legacyDigitalComp() && !findDigitalEntitlement(userId, "staff_grant")) {
      grantStaffDigitalEntitlement({ userId, grantedByUserId: null, note: "Carried over from a legacy complimentary App Subscription." });
    }
  }

  const now = new Date().toISOString();
  const replacingLegacyRow = tier === "membership" && !!existingSubscription && legacyDigitalComp();
  const base = replacingLegacyRow ? undefined : existingSubscription;
  const isEnteringFreshActivePeriod = resolvedStatus === "active" && (base?.status !== "active" || base?.packageId !== resolvedPackageId);

  // A manual/invite grant walking away from a live Stripe subscription needs to cancel it at the provider too, or Stripe
  // keeps billing with nothing surfacing the mismatch.
  let providerCancelWarning: string | null = null;

  if (existingSubscription?.provider === "stripe" && existingSubscription.providerSubscriptionId) {
    const result = await cancelProviderSubscription({
      provider: "stripe",
      providerSubscriptionId: existingSubscription.providerSubscriptionId,
    });

    if (!result.ok) {
      providerCancelWarning = `Membership updated, but the live Stripe subscription could not be cancelled automatically (${result.message ?? "unknown error"}). Cancel it manually in the Stripe dashboard.`;
    }
  }

  const subscription: SubscriptionRecord = {
    userId,
    packageId: resolvedPackageId,
    billingOptionId: base?.billingOptionId ?? null,
    status: resolvedStatus,
    pausedUntil: null,
    statusBeforePause: null,
    provider: "none",
    providerCustomerId: base?.providerCustomerId ?? null,
    providerSubscriptionId: base?.providerSubscriptionId ?? null,
    providerSetupOrderId: base?.providerSetupOrderId ?? null,
    currentPeriodEnd: base?.currentPeriodEnd ?? null,
    lastWebhookEventAt: base?.lastWebhookEventAt ?? null,
    sessionsUsedThisPeriod: isEnteringFreshActivePeriod ? 0 : base?.sessionsUsedThisPeriod ?? 0,
    extraSessionGrants: isEnteringFreshActivePeriod ? [] : base?.extraSessionGrants ?? [],
    periodLapsedNotifiedAt: isEnteringFreshActivePeriod ? null : base?.periodLapsedNotifiedAt ?? null,
    // Immutable historical provenance: if a row already exists, its ownerGym wins EXACTLY as stored — falling back to
    // explicit "unresolved" (never silently recomputed) for a row that predates this field. A legacy digital-comp row is
    // being replaced by a gym Membership, so the Membership's own gym is stamped. Fresh ownership is only ever stamped the
    // first time this user gets a subscription row at all.
    ownerGym: base ? base.ownerGym ?? { scope: "unresolved" } : freshOwnerGym,
    createdAt: base?.createdAt ?? now,
    updatedAt: now,
  };

  saveSubscription(subscription);

  return {
    ok: true,
    message: providerCancelWarning ?? (tier === "free" ? "Gym Membership ended." : "Gym Membership updated."),
    warning: providerCancelWarning,
    access: resolveMemberAccessForUser(userId),
  };
}

// Withdraws a complimentary digital grant. A paid store subscription is never touched here: it can only be ended in the store.
export function revokeDigitalGrant(userId: string): GrantTierResult {
  if (!findUserById(userId)) return { ok: false, message: "Member not found." };
  let revoked = revokeStaffDigitalEntitlement(userId);
  // A legacy complimentary row is ended by cancelling it; it is not a gym Membership and carries no provider billing.
  const legacy = findSubscriptionByUserId(userId);
  if (legacy && isLegacyDigitalCompRow(legacy)) {
    saveSubscription({ ...legacy, status: "canceled", updatedAt: new Date().toISOString() });
    revoked = true;
  }
  return {
    ok: true,
    message: revoked ? "Complimentary digital access withdrawn." : "This member has no complimentary digital access to withdraw.",
    access: resolveMemberAccessForUser(userId),
  };
}
