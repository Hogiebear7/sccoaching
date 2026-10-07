// Google Play App Subscription service: claim, lifecycle, acknowledgement, reconciliation.
//
// Routes and jobs are thin callers of this module. Every rule from the owner defaults (plan section 1)
// is enforced HERE, in one place, against the provider-neutral adapter (./adapter):
//
//  - Entitlement is granted only after the provider is asked and answers (D5). A claim that is refused
//    never creates a purchase row, never acknowledges and never writes a subscription (D1, I5).
//  - First valid binding wins (D3): a new token must echo the session user's one-way account binding;
//    a token owned by another account is rejected and never reassigned; a duplicate by the same account
//    is idempotent.
//  - Synchronous section: after the provider call returns there is NO await until the purchase row, the
//    subscription row and the audit events are written, so no other request interleaves (the datastore is
//    one synchronous JSON file in one process; see plan section 3).
//  - Stale tokens cannot rewrite the row: a snapshot or notification for a token that is neither the one
//    the row is billed through nor its direct successor never overwrites a live entitlement.
//  - Snapshot ordering: each provider answer carries the time its call was issued; an older answer than the
//    newest applied is dropped.
//  - Lifecycle processing ignores the kill switch (I6): withdrawing access must never be switchable off.
//  - Provider errors are a closed set of codes; no provider text reaches a caller.
//
// This file performs no network call itself. See ./adapter, ./google-adapter and ./fake-adapter.

import { randomUUID } from "crypto";

import {
  appendIapEvent,
  applyGooglePlayPurchaseSnapshot,
  claimGooglePlayPurchase,
  claimIapNotification,
  completeIapNotification,
  createRevenueEvent,
  findAllGooglePlayPurchases,
  findGooglePlayPurchaseByToken,
  findMembershipBillingOptions,
  findMembershipPackages,
  findRevenueEventByProviderRef,
  findSubscriptionByUserId,
  recordGooglePlayAcknowledgement,
  saveSubscription,
  type GooglePlayPurchaseRecord,
  type GooglePlaySubscriptionStatus,
  type MembershipBillingOptionRecord,
  type SubscriptionRecord,
} from "@/lib/db";
import type { MemberTier } from "@/lib/member-access";
import { resolveMemberTier } from "@/lib/membership-entitlement";
import { googlePlayAccountBindingMatches, googlePlayObfuscatedAccountId } from "@/lib/providers/google-play";
import { APP_SUBSCRIPTION_PACKAGE_SLUG } from "@/lib/tier-grant";

import { getPlayAdapter, type PlayAdapter, type ProviderSubscriptionSnapshot } from "./adapter";
import { iapDisabledReason, iapEnvironment } from "./config";
import {
  ENTITLEMENT_CONFLICT_MEMBER_MESSAGE,
  evaluateEntitlementConflict,
  evaluateProviderTransition,
  isCurrentPlayToken,
  liveEntitlement,
  packageScopeResolver,
  type EntitlementConflictCode,
} from "./entitlement-conflict";
import { recordProviderConflict } from "./provider-guard";
import "./google-adapter";

const ENTITLING_STATUSES: ReadonlySet<string> = new Set(["active", "past_due", "paused"]);
const MAX_TOKEN_LENGTH = 4096;

// Notification retry cap. After this many deliveries without a successful provider answer we stop asking
// Pub/Sub to redeliver (a 200) and leave the purchase to the reconciliation job.
export const MAX_NOTIFICATION_ATTEMPTS = 8;
// Acknowledgement: Google refunds an unacknowledged purchase after 3 days (provider confirmation required),
// so retrying past 2.5 days is pointless, and each purchase gets a bounded number of attempts.
export const MAX_ACK_ATTEMPTS = 10;
export const ACK_RETRY_MIN_INTERVAL_MS = 15 * 60 * 1000;
export const ACK_WINDOW_MS = 2.5 * 24 * 60 * 60 * 1000;
// Reconciliation: re-check a purchase whose last provider snapshot is older than this.
export const RECONCILE_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export interface ServiceFailure {
  ok: false;
  httpStatus: number;
  /** Stable machine-readable code. The contract the mobile client depends on. */
  code: string;
  message: string;
}

const fail = (httpStatus: number, code: string, message: string): ServiceFailure => ({ ok: false, httpStatus, code, message });

const MESSAGES = {
  disabled: "In-app purchases are not available right now.",
  notConfigured: "Google Play Billing isn't configured on the server yet.",
  tokenRequired: "A purchase token is required.",
  ownedByOther: "This purchase is already linked to another account.",
  // One generic answer for a missing, malformed or mismatched binding: saying which would leak whether one was sent.
  bindingRequired: "This purchase could not be verified for your account.",
  providerUnavailable: "Google Play couldn't be reached. Try again shortly.",
  providerRejected: "This purchase could not be verified.",
  productUnknown: "This purchase doesn't match a known App Subscription product.",
  pending: "Your purchase is still being processed by Google Play. Try again shortly.",
  notSetUp: "App Subscriptions aren't set up yet.",
} as const;

function findBillingOption(productId: string | null, basePlanId: string | null): MembershipBillingOptionRecord | undefined {
  if (!productId) return undefined;
  // Several billing options can share one Play product (one product, several base plans), so match the base plan
  // too; fall back to a productId-only match only for a legacy single-plan setup with no base plan recorded.
  const options = findMembershipBillingOptions();
  return (
    options.find((o) => o.googlePlaySubscriptionId === productId && o.googlePlayBasePlanId === basePlanId) ??
    options.find((o) => o.googlePlaySubscriptionId === productId && !o.googlePlayBasePlanId)
  );
}

const isoFromMillis = (ms: number | null) => (ms ? new Date(ms).toISOString() : null);

// ── Applying one provider snapshot to a purchase and, if allowed, to the subscription row ─────────

type EntitlementOutcome =
  | { kind: "applied"; status: string }
  | { kind: "pending" }
  | { kind: "stale" }
  | { kind: "membership_conflict" }
  /** A live subscription billed through Stripe or Revolut. Never replaced by a Play purchase or notification. */
  | { kind: "provider_conflict" }
  | { kind: "package_missing" }
  | { kind: "unknown_token" }
  | { kind: "stale_snapshot" };

interface SyncInput {
  adapter: PlayAdapter;
  token: string;
  snapshot: ProviderSubscriptionSnapshot;
  /** When the provider call that produced the snapshot was ISSUED. */
  fetchedAt: string;
  actor: "user" | "provider" | "system";
  /** A voided-purchase notification matched this purchase's current order: revoke. */
  voided?: boolean;
  billingOption?: MembershipBillingOptionRecord;
}

// Synchronous: no await. Writes the purchase snapshot, the subscription row and the audit events together.
function syncPurchase(input: SyncInput): { outcome: EntitlementOutcome; purchase?: GooglePlayPurchaseRecord } {
  const { adapter, token, snapshot, fetchedAt, actor } = input;
  const current = findGooglePlayPurchaseByToken(token);
  if (!current) return { outcome: { kind: "unknown_token" } };

  const mapped = adapter.mapState(snapshot.state, snapshot.expiryTimeMillis);
  const nowIso = new Date().toISOString();
  const revokedNow = input.voided === true;

  const applied = applyGooglePlayPurchaseSnapshot(
    token,
    {
      productId: snapshot.productId ?? current.productId,
      basePlanId: snapshot.basePlanId,
      orderId: snapshot.orderId,
      linkedPurchaseToken: snapshot.linkedPurchaseToken,
      status: mapped.playStatus as GooglePlaySubscriptionStatus,
      acknowledged: current.acknowledged || snapshot.acknowledged,
      autoRenewing: snapshot.autoRenewing,
      startTimeMillis: snapshot.startTimeMillis,
      expiryTimeMillis: snapshot.expiryTimeMillis,
      acknowledgementState: current.acknowledged || snapshot.acknowledged ? "acknowledged" : current.acknowledgementState ?? "pending",
      ...(revokedNow && !current.revokedAt ? { revokedAt: nowIso, revocationReason: "voided" as const } : {}),
    },
    fetchedAt
  );
  if (applied.status === "stale") return { outcome: { kind: "stale_snapshot" } };
  if (applied.status === "unknown_token") return { outcome: { kind: "unknown_token" } };

  const purchase = applied.purchase;
  // A voided purchase stays void: no later snapshot may re-entitle it.
  const effectiveStatus = purchase.revokedAt ? "canceled" : mapped.appStatus;
  if (effectiveStatus === null) return { outcome: { kind: "pending" }, purchase };

  const option = input.billingOption ?? findBillingOption(purchase.productId, purchase.basePlanId);
  const outcome = applyEntitlement({ userId: purchase.userId, token, purchase, status: effectiveStatus, option, actor });
  return { outcome, purchase };
}

function applyEntitlement(args: {
  userId: string;
  token: string;
  purchase: GooglePlayPurchaseRecord;
  status: string;
  option: MembershipBillingOptionRecord | undefined;
  actor: "user" | "provider" | "system";
}): EntitlementOutcome {
  const { userId, token, purchase, status, option, actor } = args;
  const existing = findSubscriptionByUserId(userId);
  const entitling = ENTITLING_STATUSES.has(status);

  const isCurrent = isCurrentPlayToken(existing, token);
  const isSuccessor = !!existing && existing.provider === "google_play" && !!purchase.linkedPurchaseToken && purchase.linkedPurchaseToken === existing.providerSubscriptionId;
  const live = liveEntitlement(existing, packageScopeResolver);

  if (!isCurrent && !isSuccessor) {
    // A live Stripe or Revolut subscription is never replaced by a Play purchase or a Play notification. Audited as a
    // cross-provider refusal; the row is left exactly as it is.
    const providerConflict = evaluateProviderTransition(existing, "google_play");
    if (existing && providerConflict) {
      recordProviderConflict({
        userId,
        incoming: "google_play",
        existingProvider: existing.provider,
        conflict: providerConflict,
        source: actor === "user" ? "google_play_claim" : "google_play_notification",
        reference: token,
      });
      return { kind: "provider_conflict" };
    }

    // A purchase that is not the one the row is billed through may only take the row over when the row grants
    // nothing and this purchase does. It must never overwrite a live entitlement, and a non-entitling snapshot
    // never replaces a row that belongs to something else (history is preserved, D2).
    // The one exception: the member themselves, through a fresh verified claim, may replace a MANUAL App
    // Subscription (a comp or invite grant) with their own Play-billed one. One row, so no overlap. A provider
    // notification for an older token never does.
    const manualTakeover = actor === "user" && entitling && live?.scope === "app_subscription" && live.provider !== "google_play";
    if (live && !manualTakeover) {
      const conflict = live.scope === "membership";
      appendIapEvent({
        type: conflict ? "claim_rejected_conflict" : "notification_stale",
        userId,
        purchaseToken: token,
        actor,
        detail: { reason: conflict ? "membership_active" : "stale_token", status },
      });
      return conflict ? { kind: "membership_conflict" } : { kind: "stale" };
    }
    if (!entitling) {
      appendIapEvent({ type: "notification_stale", userId, purchaseToken: token, actor, detail: { reason: "not_current_token", status } });
      return { kind: "stale" };
    }
  }

  const appPackage = findMembershipPackages().find((p) => p.slug === APP_SUBSCRIPTION_PACKAGE_SLUG);
  if (!appPackage) return { kind: "package_missing" };

  const nowIso = new Date().toISOString();
  const pendingStripeCheckout = !!existing && existing.provider === "stripe" && existing.status === "pending" && !!existing.providerSetupOrderId;
  const keepParked = !!existing && existing.provider === "google_play";
  const fresh = status === "active" && (existing?.status !== "active" || existing?.packageId !== appPackage.id || !isCurrent);
  const row: SubscriptionRecord = {
    userId,
    packageId: appPackage.id,
    billingOptionId: option?.id ?? existing?.billingOptionId ?? null,
    status: status as SubscriptionRecord["status"],
    pausedUntil: null,
    statusBeforePause: null,
    provider: "google_play",
    providerCustomerId: existing?.providerCustomerId ?? null,
    providerSubscriptionId: token,
    // A Play-billed row has no Stripe setup order. If it replaces a PENDING Stripe checkout (nothing live, so nothing is
    // being overwritten), that checkout intent moves to the pending-switch fields instead of being lost or left where a
    // later Stripe completion could match it unguarded. The Stripe webhook then promotes it only if no Play entitlement is
    // live at that moment (see app/api/stripe/webhook/route.ts).
    providerSetupOrderId: null,
    // Later Play updates for the same row (renewal, expiry) keep that parked intent.
    pendingPackageId: pendingStripeCheckout ? existing.packageId ?? null : keepParked ? existing.pendingPackageId ?? null : null,
    pendingBillingOptionId: pendingStripeCheckout ? existing.billingOptionId ?? null : keepParked ? existing.pendingBillingOptionId ?? null : null,
    pendingSetupOrderId: pendingStripeCheckout ? existing.providerSetupOrderId ?? null : keepParked ? existing.pendingSetupOrderId ?? null : null,
    pendingStartedAt: pendingStripeCheckout ? existing.updatedAt : keepParked ? existing.pendingStartedAt ?? null : null,
    currentPeriodEnd: isoFromMillis(purchase.expiryTimeMillis),
    lastWebhookEventAt: existing?.lastWebhookEventAt ?? null,
    sessionsUsedThisPeriod: fresh ? 0 : existing?.sessionsUsedThisPeriod ?? 0,
    extraSessionGrants: fresh ? [] : existing?.extraSessionGrants ?? [],
    periodLapsedNotifiedAt: fresh ? null : existing?.periodLapsedNotifiedAt ?? null,
    // Immutable provenance: an existing row keeps its ownerGym exactly; a fresh one is platform scope.
    ownerGym: existing ? existing.ownerGym ?? { scope: "unresolved" } : { scope: "platform" },
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };
  saveSubscription(row);

  const wasEntitled = isCurrent && !!live;
  if (entitling && !wasEntitled) {
    appendIapEvent({ type: "entitlement_granted", userId, purchaseToken: token, actor, detail: { status } });
  } else if (entitling && existing?.status !== status) {
    appendIapEvent({ type: "entitlement_updated", userId, purchaseToken: token, actor, detail: { from: existing?.status ?? null, to: status } });
  } else if (!entitling && wasEntitled) {
    appendIapEvent({
      type: purchase.revokedAt ? "entitlement_revoked" : "entitlement_expired",
      userId,
      purchaseToken: token,
      actor,
      detail: { from: existing?.status ?? null, to: status },
    });
  }

  // Revenue is recorded once per Google order id, at the configured placeholder price. The amount basis is an
  // open owner and accounting decision (D8); this records technical facts only.
  if (purchase.orderId && status === "active" && option && !findRevenueEventByProviderRef("google_play", purchase.orderId)) {
    createRevenueEvent({
      id: randomUUID(),
      userId,
      packageId: appPackage.id,
      billingOptionId: option.id,
      amountCents: option.amountCents,
      currency: option.currency,
      provider: "google_play",
      providerRef: purchase.orderId,
      source: "membership_renewal",
      receivedAt: nowIso,
      ownerGym: { scope: "platform" },
    });
  }

  return { kind: "applied", status };
}

// ── Acknowledgement ──────────────────────────────────────────────────────────────────────────────

async function acknowledgeIfNeeded(adapter: PlayAdapter, token: string): Promise<boolean> {
  const purchase = findGooglePlayPurchaseByToken(token);
  if (!purchase || purchase.acknowledged || purchase.revokedAt) return !!purchase?.acknowledged;
  if (!ENTITLING_STATUSES.has(appStatusOfPlayStatus(purchase.status))) return false;

  const result = await adapter.acknowledge(token);
  recordGooglePlayAcknowledgement(token, result.ok ? { ok: true } : { ok: false, code: result.code });
  return result.ok;
}

function appStatusOfPlayStatus(status: GooglePlaySubscriptionStatus): string {
  // Mirrors mapGooglePlaySubscriptionState for the statuses that keep access.
  if (status === "active" || status === "canceled") return "active";
  if (status === "in_grace_period") return "past_due";
  if (status === "paused") return "paused";
  return "canceled";
}

// ── Purchase context: the account binding the client must set before purchase ───────────────────

export type PurchaseContextResult =
  | { ok: true; data: { obfuscatedAccountId: string; environment: string } }
  | ServiceFailure;

export function getPurchaseContext(userId: string, adapter: PlayAdapter = getPlayAdapter()): PurchaseContextResult {
  if (iapDisabledReason()) return fail(503, "iap_disabled", MESSAGES.disabled);
  if (!adapter.isConfigured()) return fail(503, "not_configured", MESSAGES.notConfigured);

  // No purchase intent for a member who cannot take one: an active Membership (D1) or a live Play subscription.
  const existing = findSubscriptionByUserId(userId);
  const conflict = evaluateEntitlementConflict(existing, { kind: "play_claim" }, packageScopeResolver);
  const live = liveEntitlement(existing, packageScopeResolver);
  const code: EntitlementConflictCode | null = conflict?.code ?? (live?.scope === "app_subscription" && live.provider === "google_play" ? "play_billing_active" : null);
  if (code) {
    appendIapEvent({ type: "claim_rejected_conflict", userId, actor: "user", detail: { code, source: "purchase_context" } });
    return fail(409, code, ENTITLEMENT_CONFLICT_MEMBER_MESSAGE[code]);
  }

  const obfuscatedAccountId = googlePlayObfuscatedAccountId(userId);
  if (!obfuscatedAccountId) return fail(503, "binding_unavailable", MESSAGES.notConfigured);
  return { ok: true, data: { obfuscatedAccountId, environment: iapEnvironment() ?? "unset" } };
}

// ── Claim: POST /api/mobile/billing/google-play/verify ───────────────────────────────────────────

export type VerifyResult =
  | { ok: true; httpStatus: 200; message: string; data: { tier: MemberTier; status: string; acknowledged: boolean } }
  | ServiceFailure;

export async function verifyAndClaimPurchase(
  userId: string,
  rawToken: unknown,
  adapter: PlayAdapter = getPlayAdapter()
): Promise<VerifyResult> {
  const disabled = iapDisabledReason();
  if (disabled) {
    appendIapEvent({ type: "claim_rejected_disabled", userId, actor: "user", detail: { reason: disabled } });
    return fail(503, "iap_disabled", MESSAGES.disabled);
  }
  if (!adapter.isConfigured()) return fail(503, "not_configured", MESSAGES.notConfigured);

  if (typeof rawToken !== "string" || !rawToken.trim() || rawToken.length > MAX_TOKEN_LENGTH) {
    return fail(400, "invalid_request", MESSAGES.tokenRequired);
  }
  const token = rawToken.trim();

  // Ownership gate before any provider call.
  const early = findGooglePlayPurchaseByToken(token);
  if (early && early.userId !== userId) {
    appendIapEvent({ type: "claim_rejected_owner", userId, purchaseToken: token, actor: "user" });
    return fail(409, "owned_by_other", MESSAGES.ownedByOther);
  }

  const fetchedAt = new Date().toISOString();
  const fetched = await adapter.fetchSubscription(token);
  if (!fetched.ok) {
    return fetched.retryable ? fail(502, "provider_unavailable", MESSAGES.providerUnavailable) : fail(400, "provider_rejected", MESSAGES.providerRejected);
  }
  const snapshot = fetched.snapshot;

  // ── Synchronous section: everything below to the end of the claim has no await. ──
  const option = findBillingOption(snapshot.productId, snapshot.basePlanId);
  if (!option) {
    appendIapEvent({ type: "claim_rejected_product", userId, purchaseToken: token, actor: "user" });
    return fail(400, "product_unknown", MESSAGES.productUnknown);
  }

  const mapped = adapter.mapState(snapshot.state, snapshot.expiryTimeMillis);
  const existing = findGooglePlayPurchaseByToken(token);
  if (existing && existing.userId !== userId) {
    appendIapEvent({ type: "claim_rejected_owner", userId, purchaseToken: token, actor: "user" });
    return fail(409, "owned_by_other", MESSAGES.ownedByOther);
  }

  // A token with no owner must echo THIS session user's account binding. Already-owned tokens stay idempotent
  // without resending one (restore purchases).
  if (!existing) {
    const expected = googlePlayObfuscatedAccountId(userId);
    if (!expected || !googlePlayAccountBindingMatches(expected, snapshot.accountBinding)) {
      appendIapEvent({ type: "claim_rejected_binding", userId, purchaseToken: token, actor: "user" });
      return fail(409, "binding_required", MESSAGES.bindingRequired);
    }
  }

  const entitlingNow = mapped.appStatus !== null && ENTITLING_STATUSES.has(mapped.appStatus);
  const subscription = findSubscriptionByUserId(userId);

  // No overlap and no silent replacement (D1, D2), decided BEFORE a purchase row exists so a refused claim leaves
  // no pending intent and the token stays unbound and unacknowledged (I5).
  const membershipConflict = evaluateEntitlementConflict(subscription, { kind: "play_claim" }, packageScopeResolver);
  const live = liveEntitlement(subscription, packageScopeResolver);
  const otherPlayLive =
    live?.scope === "app_subscription" &&
    live.provider === "google_play" &&
    subscription?.providerSubscriptionId !== token &&
    subscription?.providerSubscriptionId !== snapshot.linkedPurchaseToken;
  const conflictCode: EntitlementConflictCode | null = membershipConflict?.code ?? (otherPlayLive ? "play_billing_active" : null);
  // An already-owned purchase that grants nothing right now may still be refreshed for history (see refreshOnly below).
  if (conflictCode && (entitlingNow || !existing)) {
    // A live Stripe or Revolut subscription is also audited as a cross-provider refusal.
    const claimProviderConflict = evaluateProviderTransition(subscription, "google_play");
    if (subscription && claimProviderConflict) {
      recordProviderConflict({ userId, incoming: "google_play", existingProvider: subscription.provider, conflict: claimProviderConflict, source: "google_play_claim", reference: token });
    }
    appendIapEvent({ type: "claim_rejected_conflict", userId, purchaseToken: token, actor: "user", detail: { code: conflictCode, source: "verify" } });
    return fail(409, conflictCode, ENTITLEMENT_CONFLICT_MEMBER_MESSAGE[conflictCode]);
  }

  const claimed = claimGooglePlayPurchase(
    {
      purchaseToken: token,
      productId: snapshot.productId ?? option.googlePlaySubscriptionId ?? "",
      basePlanId: snapshot.basePlanId,
      orderId: snapshot.orderId,
      linkedPurchaseToken: snapshot.linkedPurchaseToken,
      status: mapped.playStatus as GooglePlaySubscriptionStatus,
      acknowledged: snapshot.acknowledged,
      autoRenewing: snapshot.autoRenewing,
      startTimeMillis: snapshot.startTimeMillis,
      expiryTimeMillis: snapshot.expiryTimeMillis,
      // Stored for audit only: already an opaque one-way hash, never the raw user id.
      obfuscatedExternalAccountId: snapshot.accountBinding,
      acknowledgementState: snapshot.acknowledged ? "acknowledged" : "pending",
    },
    userId
  );
  if (claimed.status === "owned_by_other") return fail(409, "owned_by_other", MESSAGES.ownedByOther);

  // An owned, non-entitling purchase refreshed while a conflicting row is live: record history, change nothing else.
  const refreshOnly = !!conflictCode && !entitlingNow;
  const synced = refreshOnly
    ? { outcome: { kind: "stale" } as EntitlementOutcome }
    : syncPurchase({ adapter, token, snapshot, fetchedAt, actor: "user", billingOption: option });
  if (refreshOnly) {
    applyGooglePlayPurchaseSnapshot(
      token,
      { status: mapped.playStatus as GooglePlaySubscriptionStatus, expiryTimeMillis: snapshot.expiryTimeMillis, autoRenewing: snapshot.autoRenewing, acknowledged: snapshot.acknowledged || (existing?.acknowledged ?? false) },
      fetchedAt
    );
  }
  // ── End of synchronous section. ──

  const outcome = synced.outcome;
  if (outcome.kind === "pending") return fail(409, "purchase_pending", MESSAGES.pending);
  if (outcome.kind === "package_missing") return fail(500, "not_set_up", MESSAGES.notSetUp);
  if (outcome.kind === "membership_conflict") return fail(409, "membership_active", ENTITLEMENT_CONFLICT_MEMBER_MESSAGE.membership_active);
  if (outcome.kind === "provider_conflict") return fail(409, "other_provider_active", ENTITLEMENT_CONFLICT_MEMBER_MESSAGE.other_provider_active);

  // Acknowledge only a purchase that was actually entitled, after the entitlement is written (D5, I5).
  let acknowledged = !!findGooglePlayPurchaseByToken(token)?.acknowledged;
  if (outcome.kind === "applied" && ENTITLING_STATUSES.has(outcome.status) && !acknowledged) {
    acknowledged = await acknowledgeIfNeeded(adapter, token);
  }

  const tier = resolveMemberTier(findSubscriptionByUserId(userId));
  const status = outcome.kind === "applied" ? outcome.status : mapped.appStatus ?? "unknown";
  return { ok: true, httpStatus: 200, message: "Purchase verified.", data: { tier, status, acknowledged } };
}

// ── Notifications (RTDN) ─────────────────────────────────────────────────────────────────────────

export interface NotificationInput {
  messageId: string;
  packageName: string | null;
  testNotification: boolean;
  /** Present for a subscription lifecycle notification. */
  subscriptionToken: string | null;
  /** Present for a voided-purchase notification. */
  voided: { purchaseToken: string; orderId: string | null; productType: number | null } | null;
}

export interface NotificationResult {
  httpStatus: number;
  body: Record<string, unknown>;
}

const ok = (message: string, extra: Record<string, unknown> = {}): NotificationResult => ({ httpStatus: 200, body: { ok: true, message, ...extra } });

export async function processGooglePlayNotification(input: NotificationInput, adapter: PlayAdapter = getPlayAdapter()): Promise<NotificationResult> {
  const claim = claimIapNotification(input.messageId);
  if (claim.status === "duplicate") return ok("Duplicate notification ignored.");

  const finish = (outcome: string, message: string, extra: Record<string, unknown> = {}) => {
    completeIapNotification(input.messageId, outcome);
    return ok(message, extra);
  };

  if (input.testNotification) return finish("test", "Test notification received.");

  const expectedPackage = adapter.expectedPackageName();
  if (expectedPackage && input.packageName !== expectedPackage) return finish("wrong_package", "Ignored: notification is for a different app.");

  const token = input.voided?.purchaseToken ?? input.subscriptionToken;
  if (!token) return finish("no_token", "Ignored: no purchase token in notification.");
  if (input.voided && input.voided.productType !== 1) return finish("not_subscription", "Ignored: voided purchase is not a subscription.");

  const purchase = findGooglePlayPurchaseByToken(token);
  if (!purchase) {
    // Not linked to a member yet (the notification beat the client's claim). The claim fetches fresh state itself.
    return finish("unknown_token", "Ignored: purchase token not yet linked to a member.");
  }

  if (claim.attempts > MAX_NOTIFICATION_ATTEMPTS) {
    appendIapEvent({ type: "notification_stale", userId: purchase.userId, purchaseToken: token, actor: "provider", detail: { reason: "gave_up", attempts: claim.attempts } });
    return finish("gave_up", "Gave up after repeated provider failures; reconciliation will re-check.");
  }

  if (!adapter.isConfigured()) return { httpStatus: 503, body: { error: "Provider is not configured." } };

  const fetchedAt = new Date().toISOString();
  const fetched = await adapter.fetchSubscription(token);
  if (!fetched.ok) {
    if (!fetched.retryable) return finish("provider_rejected", "Ignored: provider no longer recognises this purchase token.");
    // Not completed: Pub/Sub redelivers, and this message id is retried (bounded by MAX_NOTIFICATION_ATTEMPTS).
    return { httpStatus: 502, body: { error: "Could not re-check the purchase with Google Play." } };
  }

  // A voided notification revokes only when it concerns the purchase's CURRENT order. A refund of an earlier
  // period leaves the current period alone.
  const voidedMatches = !!input.voided && (!input.voided.orderId || !fetched.snapshot.orderId || input.voided.orderId === fetched.snapshot.orderId);
  if (input.voided && !voidedMatches) {
    appendIapEvent({ type: "notification_stale", userId: purchase.userId, purchaseToken: token, actor: "provider", detail: { reason: "voided_prior_order" } });
  }

  const synced = syncPurchase({ adapter, token, snapshot: fetched.snapshot, fetchedAt, actor: "provider", voided: voidedMatches });
  const outcome = synced.outcome;

  if (outcome.kind === "applied" && ENTITLING_STATUSES.has(outcome.status)) await acknowledgeIfNeeded(adapter, token);

  const tier = resolveMemberTier(findSubscriptionByUserId(purchase.userId));
  if (outcome.kind === "applied") return finish("applied", "Purchase state applied.", { tier, status: outcome.status });
  if (outcome.kind === "pending") return finish("pending", "Purchase state recorded; not confident enough to update tier yet.");
  return finish(outcome.kind, "Purchase state recorded; the subscription row was not changed.");
}

// ── Background work ──────────────────────────────────────────────────────────────────────────────

export interface JobSummary {
  considered: number;
  processed: number;
  failed: number;
  skipped?: string;
}

// Re-asks the provider about purchases whose state may have drifted (a lost notification). Ignores the kill switch.
export async function reconcileGooglePlayPurchases(
  options: { limit?: number; nowMs?: number; adapter?: PlayAdapter } = {}
): Promise<JobSummary> {
  const adapter = options.adapter ?? getPlayAdapter();
  const nowMs = options.nowMs ?? Date.now();
  const limit = options.limit ?? 25;
  if (!adapter.isConfigured()) return { considered: 0, processed: 0, failed: 0, skipped: "not_configured" };

  const due = findAllGooglePlayPurchases()
    .filter((p) => !p.revokedAt && p.status !== "expired")
    .filter((p) => {
      const last = p.lastSnapshotAt ? new Date(p.lastSnapshotAt).getTime() : 0;
      const expiredButActive = p.expiryTimeMillis !== null && p.expiryTimeMillis < nowMs && (p.status === "active" || p.status === "canceled" || p.status === "in_grace_period");
      return expiredButActive || nowMs - last > RECONCILE_STALE_AFTER_MS;
    })
    .slice(0, limit);

  const summary: JobSummary = { considered: due.length, processed: 0, failed: 0 };
  for (const purchase of due) {
    const fetchedAt = new Date(nowMs).toISOString();
    const fetched = await adapter.fetchSubscription(purchase.purchaseToken);
    if (!fetched.ok) {
      summary.failed++;
      // Credentials or configuration are wrong: every further call would fail the same way.
      if (fetched.code === "unauthorized" || fetched.code === "not_configured") break;
      continue;
    }
    syncPurchase({ adapter, token: purchase.purchaseToken, snapshot: fetched.snapshot, fetchedAt, actor: "system" });
    summary.processed++;
  }
  appendIapEvent({ type: "reconciliation_run", userId: null, actor: "system", detail: { considered: summary.considered, processed: summary.processed, failed: summary.failed } });
  return summary;
}

// Retries acknowledgement for entitled purchases that are still unacknowledged, with a minimum interval, an
// attempt cap and Google's refund window. Ignores the kill switch.
export async function retryGooglePlayAcknowledgements(
  options: { limit?: number; nowMs?: number; adapter?: PlayAdapter } = {}
): Promise<JobSummary> {
  const adapter = options.adapter ?? getPlayAdapter();
  const nowMs = options.nowMs ?? Date.now();
  const limit = options.limit ?? 25;
  if (!adapter.isConfigured()) return { considered: 0, processed: 0, failed: 0, skipped: "not_configured" };

  const due = findAllGooglePlayPurchases()
    .filter((p) => !p.acknowledged && !p.revokedAt && p.acknowledgementState !== "not_required")
    .filter((p) => ENTITLING_STATUSES.has(appStatusOfPlayStatus(p.status)))
    .filter((p) => (p.acknowledgementAttempts ?? 0) < MAX_ACK_ATTEMPTS)
    .filter((p) => nowMs - new Date(p.createdAt).getTime() < ACK_WINDOW_MS)
    .filter((p) => !p.acknowledgementLastAttemptAt || nowMs - new Date(p.acknowledgementLastAttemptAt).getTime() >= ACK_RETRY_MIN_INTERVAL_MS)
    .slice(0, limit);

  const summary: JobSummary = { considered: due.length, processed: 0, failed: 0 };
  for (const purchase of due) {
    const result = await adapter.acknowledge(purchase.purchaseToken);
    recordGooglePlayAcknowledgement(purchase.purchaseToken, result.ok ? { ok: true } : { ok: false, code: result.code }, new Date(nowMs).toISOString());
    if (result.ok) summary.processed++;
    else summary.failed++;
  }
  return summary;
}
