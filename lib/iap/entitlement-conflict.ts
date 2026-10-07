// One rule set for "may this write replace the member's current subscription row?".
//
// A member has exactly ONE SubscriptionRecord, so a Membership and an App Subscription can never
// both be stored. The danger is a write that silently REPLACES a live entitlement of the other
// kind (or a live Google Play subscription) and leaves the member either paying twice or with
// billing that nothing tracks. Owner defaults D1 and D2 (docs/iap-multitenant-implementation-plan-
// 2026-10.md) say: no overlap, no automatic conversion, nothing cancelled or refunded for the
// member. So every conflicting write is REJECTED with a stable code, and staff or the member take
// the two steps explicitly.
//
// Interpretations (plan section 2, owner to confirm):
//  I1  entitling a Membership over a live App Subscription is rejected.
//  I2  a staff write over a live Google Play subscription is rejected. The member cancels in Google
//      Play and access ends at the paid expiry.
//  I3  an "active Membership" is a Membership-scope row whose status is active, past_due or paused,
//      and which has not lapsed. pending, inactive, canceled and a lapsed active row are not active.
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

export type EntitlementConflictCode = "membership_active" | "app_subscription_active" | "play_billing_active" | "other_provider_active";

// Stable and non-sensitive on purpose: no ids, no provider detail, no dates. The code is the
// contract; the message is a default a route may show as-is.
export const ENTITLEMENT_CONFLICT_MESSAGE: Record<EntitlementConflictCode, string> = {
  membership_active: "This member already has an active gym Membership, so an App Subscription can't be added while it is active.",
  app_subscription_active: "This member already has an active App Subscription. End it first, then add the Membership.",
  play_billing_active: "This App Subscription is billed through Google Play. It can only be cancelled there, and access continues until the paid period ends.",
  other_provider_active: "This account already has an active subscription billed through a different payment provider. The incoming payment was not applied.",
};

// The same three outcomes worded for the member themselves (web checkout, invite redemption), who
// is not "this member". Same stability rule: no ids, no provider detail, no dates.
export const ENTITLEMENT_CONFLICT_MEMBER_MESSAGE: Record<EntitlementConflictCode, string> = {
  membership_active: "You already have an active gym Membership, so an App Subscription can't be added while it is active.",
  app_subscription_active: "You already have an active App Subscription. Let it end before starting a Membership.",
  play_billing_active: "Your App Subscription is billed through Google Play. Cancel it in Google Play and you can start a Membership once it has ended.",
  other_provider_active: "You already have an active subscription billed through a different payment provider, so this payment was not applied. Contact support.",
};

export interface EntitlementConflict {
  code: EntitlementConflictCode;
  message: string;
}

export type ScopeResolver = (packageId: string) => EntitlementScope | null;

export function scopeOfPackage(pkg: Pick<MembershipPackageRecord, "deliveryChannel"> | undefined): EntitlementScope | null {
  if (!pkg) return null;
  // deliveryChannel === "app_only" is the single marker for the platform-global App Subscription
  // (lib/gym-scope.ts isGlobalCatalogPackage). Never the slug, never billingChannel.
  return pkg.deliveryChannel === "app_only" ? "app_subscription" : "membership";
}

export const packageScopeResolver: ScopeResolver = (packageId) => scopeOfPackage(findMembershipPackageById(packageId));

export interface LiveEntitlement {
  scope: EntitlementScope;
  provider: BillingProvider;
}

const LIVE_STATUSES: ReadonlySet<SubscriptionRecord["status"]> = new Set(["active", "past_due", "paused"]);

// The member's current entitlement, or null when the row grants nothing right now. A package that
// no longer resolves grants nothing (resolveMemberTier reads it as Free), so it cannot conflict.
export function liveEntitlement(
  subscription: Pick<SubscriptionRecord, "packageId" | "status" | "currentPeriodEnd" | "provider"> | undefined | null,
  scopeOf: ScopeResolver,
  nowMs: number = Date.now()
): LiveEntitlement | null {
  if (!subscription?.packageId) return null;
  if (!LIVE_STATUSES.has(subscription.status)) return null;
  // Only an "active" row can lapse: past_due is a grace state and paused is a hold.
  if (subscription.status === "active" && subscription.currentPeriodEnd && new Date(subscription.currentPeriodEnd).getTime() < nowMs) {
    return null;
  }
  const scope = scopeOf(subscription.packageId);
  return scope ? { scope, provider: subscription.provider } : null;
}

export type EntitlementWriteIntent =
  /** A staff, invite, admin or web-checkout write. scope is the package being written (null for Free).
      entitling is true when the new row would grant access now (active, past_due). */
  | { kind: "staff_write"; scope: EntitlementScope | null; entitling: boolean }
  /** A verified Google Play purchase being applied as the member's App Subscription. */
  | { kind: "play_claim" };

export function evaluateEntitlementConflict(
  existing: Pick<SubscriptionRecord, "packageId" | "status" | "currentPeriodEnd" | "provider"> | undefined | null,
  intent: EntitlementWriteIntent,
  scopeOf: ScopeResolver,
  nowMs: number = Date.now()
): EntitlementConflict | null {
  const live = liveEntitlement(existing, scopeOf, nowMs);
  if (!live) return null;

  const conflict = (code: EntitlementConflictCode): EntitlementConflict => ({ code, message: ENTITLEMENT_CONFLICT_MESSAGE[code] });

  if (intent.kind === "play_claim") {
    if (live.scope === "membership") return conflict("membership_active");
    // A live subscription billed by Stripe or Revolut is never replaced by a Play purchase (the member would be
    // billed twice and one provider reference would be lost).
    return live.provider === "stripe" || live.provider === "revolut" ? conflict("other_provider_active") : null;
  }

  // I2: nothing a staff member does may overwrite a live Google Play subscription, whatever it
  // would be replaced with. Doing so would orphan billing that only Google can stop.
  if (live.scope === "app_subscription" && live.provider === "google_play") return conflict("play_billing_active");

  if (intent.entitling && intent.scope === "membership" && live.scope === "app_subscription") return conflict("app_subscription_active");
  if (intent.entitling && intent.scope === "app_subscription" && live.scope === "membership") return conflict("membership_active");
  return null;
}

// Datastore-backed entry point for routes and grantMemberTier.
export function findEntitlementConflict(userId: string, intent: EntitlementWriteIntent, nowMs: number = Date.now()): EntitlementConflict | null {
  return evaluateEntitlementConflict(findSubscriptionByUserId(userId), intent, packageScopeResolver, nowMs);
}

// True when `token` is the Google Play purchase this row is currently billed through. A provider
// notification or reconciliation pass for any OTHER token is stale and must not rewrite the row.
export function isCurrentPlayToken(
  subscription: Pick<SubscriptionRecord, "provider" | "providerSubscriptionId"> | undefined | null,
  purchaseToken: string
): boolean {
  return !!subscription && subscription.provider === "google_play" && subscription.providerSubscriptionId === purchaseToken;
}

// ── Cross-provider rules for incoming PROVIDER events (Stripe and Revolut webhooks, the Play claim) ──────────────
//
// A subscription row is billed through exactly one provider, named by SubscriptionRecord.provider. A provider event
// (a checkout completion, an invoice, a Play claim) is the provider telling us something happened. It is NOT the
// member or staff choosing to move the account to that provider, so a webhook may never infer that consent:
//
//   - while the row holds an ENTITLED subscription (active, past_due or paused, and for "active" not past its paid
//     period; a cancelled-but-still-paid subscription is "active" until its paid-through date, so it counts) billed by
//     provider A, a completion from provider B is REJECTED and the row is left exactly as it is;
//   - once the entitlement has ended (cancelled, expired, lapsed) or never started (pending), a completion from
//     another provider may take the row over, because nothing is being replaced;
//   - the same provider is always allowed (renewals, duplicates and re-subscribes are that provider's own business);
//   - a manual row (provider "none") is not a paid provider: the existing member-initiated web switch still applies.
//
// Moving a paying member from one provider to another is a policy decision (cancel at the old provider first, refund or
// not, who consents). No transition API exists for it yet, so this module offers none: see the follow-up in
// docs/iap-entitlement-schema-and-membership-conflict-2026-10.md.

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

// A checkout completion or claim from `incoming` that would activate this row. Null means allowed.
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
