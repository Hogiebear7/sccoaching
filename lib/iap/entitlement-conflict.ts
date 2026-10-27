// Rules for writes to the member's SubscriptionRecord (the GYM Membership row).
//
// History: this module used to decide whether a gym Membership and the App Subscription could overlap, because both lived in
// the one SubscriptionRecord. Owner decision D1 (2026-10-15) made them separate products: a gym Membership does not include
// digital features, and the digital plan is a store subscription kept in the digital entitlement store (lib/digital-entitlement.ts),
// never in this row. So the overlap rules are gone, and two things remain:
//
//   1. NOTHING may write the app-only package into a SubscriptionRecord any more (staff activation, staff override, web
//      checkout). The digital plan is bought in Google Play or the App Store; staff can only grant a COMPLIMENTARY digital
//      entitlement through lib/tier-grant.ts. Writing the app-only package here would create a row that grants nothing
//      (lib/membership-entitlement.ts does not read it as a Membership) while looking like a subscription, so it is refused.
//   2. Cross-provider rules between the PAID providers of a gym Membership (Stripe and Revolut): see the bottom of the file.
//
// The functions below are pure. The datastore-backed entry point is findEntitlementConflict.

import {
  findMembershipPackageById,
  findSubscriptionByUserId,
  type BillingProvider,
  type MembershipPackageRecord,
  type SubscriptionRecord,
} from "@/lib/db";

export type EntitlementScope = "membership" | "app_subscription";

export type EntitlementConflictCode = "app_plan_not_assignable" | "other_provider_active";

// Stable and non-sensitive on purpose: no ids, no provider detail, no dates. The code is the contract; the message is a
// default a route may show as-is.
export const ENTITLEMENT_CONFLICT_MESSAGE: Record<EntitlementConflictCode, string> = {
  app_plan_not_assignable:
    "The App-only digital plan is bought by the member in Google Play or the App Store and can't be assigned as a gym Membership. Use complimentary digital access instead.",
  other_provider_active: "This account already has an active subscription billed through a different payment provider. The incoming payment was not applied.",
};

// The same outcomes worded for the member themselves (web checkout, invite redemption), who is not "this member".
export const ENTITLEMENT_CONFLICT_MEMBER_MESSAGE: Record<EntitlementConflictCode, string> = {
  app_plan_not_assignable: "The App-only digital plan can only be bought in the Google Play or App Store app. It isn't available on the website.",
  other_provider_active: "You already have an active subscription billed through a different payment provider, so this payment was not applied. Contact support.",
};

export interface EntitlementConflict {
  code: EntitlementConflictCode;
  message: string;
}

export type ScopeResolver = (packageId: string) => EntitlementScope | null;

export function scopeOfPackage(pkg: Pick<MembershipPackageRecord, "deliveryChannel"> | undefined): EntitlementScope | null {
  if (!pkg) return null;
  // deliveryChannel === "app_only" is the single marker for the platform-global App-only package
  // (lib/gym-scope.ts isGlobalCatalogPackage). Never the slug, never billingChannel.
  return pkg.deliveryChannel === "app_only" ? "app_subscription" : "membership";
}

export const packageScopeResolver: ScopeResolver = (packageId) => scopeOfPackage(findMembershipPackageById(packageId));

export type EntitlementWriteIntent =
  /** A staff, invite, admin or web-checkout write. scope is the package being written (null for Free). */
  { kind: "staff_write"; scope: EntitlementScope | null; entitling: boolean };

// `existing` and `scopeOf` are kept in the signature because every caller already passes them; only the INCOMING scope decides now.
export function evaluateEntitlementConflict(
  _existing: Pick<SubscriptionRecord, "packageId" | "status" | "currentPeriodEnd" | "provider"> | undefined | null,
  intent: EntitlementWriteIntent,
  _scopeOf: ScopeResolver,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept so every existing caller and test can still pass the clock
  _nowMs: number = Date.now()
): EntitlementConflict | null {
  if (intent.scope === "app_subscription") {
    return { code: "app_plan_not_assignable", message: ENTITLEMENT_CONFLICT_MESSAGE.app_plan_not_assignable };
  }
  return null;
}

// Datastore-backed entry point for routes.
export function findEntitlementConflict(userId: string, intent: EntitlementWriteIntent, nowMs: number = Date.now()): EntitlementConflict | null {
  return evaluateEntitlementConflict(findSubscriptionByUserId(userId), intent, packageScopeResolver, nowMs);
}

// ── Cross-provider rules for incoming PROVIDER events (Stripe and Revolut webhooks) ──────────────────────────────────
//
// A gym Membership row is billed through exactly one provider, named by SubscriptionRecord.provider. A provider event
// (a checkout completion, an invoice) is the provider telling us something happened. It is NOT the member or staff choosing
// to move the account to that provider, so a webhook may never infer that consent:
//
//   - while the row holds an ENTITLED subscription (active, past_due or paused, and for "active" not past its paid
//     period; a cancelled-but-still-paid subscription is "active" until its paid-through date, so it counts) billed by
//     provider A, a completion from provider B is REJECTED and the row is left exactly as it is;
//   - once the entitlement has ended (cancelled, expired, lapsed) or never started (pending), a completion from
//     another provider may take the row over, because nothing is being replaced;
//   - the same provider is always allowed (renewals, duplicates and re-subscribes are that provider's own business);
//   - a manual row (provider "none") is not a paid provider: the existing member-initiated web switch still applies.

const LIVE_STATUSES: ReadonlySet<SubscriptionRecord["status"]> = new Set(["active", "past_due", "paused"]);

const PAID_PROVIDERS: ReadonlySet<BillingProvider> = new Set<BillingProvider>(["stripe", "revolut", "google_play"]);

export const isPaidProvider = (provider: BillingProvider | undefined | null): boolean => !!provider && PAID_PROVIDERS.has(provider);

// Entitled right now, WITHOUT resolving the package (a row whose package was deleted is still being paid for, so it is
// treated as entitled here: the conservative answer when deciding whether to refuse a write).
export function isProviderEntitled(
  subscription: Pick<SubscriptionRecord, "status" | "currentPeriodEnd"> | undefined | null,
  nowMs: number = Date.now()
): boolean {
  if (!subscription || !LIVE_STATUSES.has(subscription.status)) return false;
  if (subscription.status === "active" && subscription.currentPeriodEnd && new Date(subscription.currentPeriodEnd).getTime() < nowMs) return false;
  return true;
}

// A checkout completion from `incoming` that would activate this row. Null means allowed.
export function evaluateProviderTransition(
  existing: Pick<SubscriptionRecord, "provider" | "status" | "currentPeriodEnd"> | undefined | null,
  incoming: BillingProvider,
  nowMs: number = Date.now()
): EntitlementConflict | null {
  if (!existing || !isPaidProvider(existing.provider) || !isPaidProvider(incoming)) return null;
  if (existing.provider === incoming) return null;
  if (!isProviderEntitled(existing, nowMs)) return null;
  return { code: "other_provider_active", message: ENTITLEMENT_CONFLICT_MESSAGE.other_provider_active };
}

// An event that found its row by the PROVIDER'S OWN REFERENCE (an invoice, a cancellation or a status update carrying a
// subscription id). If that row is billed through a different paid provider the reference cannot legitimately belong
// to it, so the event is refused whether or not the row is currently entitled.
export function evaluateReferenceMismatch(
  existing: Pick<SubscriptionRecord, "provider"> | undefined | null,
  incoming: BillingProvider
): EntitlementConflict | null {
  if (!existing || !isPaidProvider(existing.provider) || !isPaidProvider(incoming) || existing.provider === incoming) return null;
  return { code: "other_provider_active", message: ENTITLEMENT_CONFLICT_MESSAGE.other_provider_active };
}
