// App Store digital-plan service: claim, lifecycle, reconciliation. The counterpart of ./service (Google Play), obeying the
// same rules through the same shared entitlement writer (./entitlement-apply):
//
//  - A purchase is entitled only after Apple is asked and answers. The client's signed transaction is verified against the
//    pinned Apple root, and the subscription's state is then READ from the App Store Server API; nothing the client says
//    about its own purchase decides access (D5).
//  - First valid binding wins (D3): a transaction not yet owned must carry the session user's appAccountToken (a UUID derived
//    from the account by a server secret). A subscription owned by another account is rejected and never reassigned; a
//    duplicate by the same account is idempotent. A purchase made without the token, or with someone else's, is refused, so
//    a purchase can never be granted to an unrelated account (including by pressing Restore while signed in as another user).
//  - Synchronous section: after Apple answers there is no await until the purchase row, the entitlement and the audit events
//    are written.
//  - Never trust a notification's type: a notification only says "go and look". The live state decides. The one thing taken
//    from the notification's own signed transaction is a revocation date, because Apple signed it.
//  - Snapshot ordering: an answer issued earlier than the newest applied is dropped.
//  - Duplicate delivery: notificationUUID is recorded once.
//  - Lifecycle processing ignores the kill switch: withdrawing access must never be switchable off.
//  - Provider errors are a closed set of codes; no Apple text reaches a caller.
//
// This file performs no network call itself. See ./apple-adapter and ./apple-real-adapter.

import { randomUUID } from "crypto";

import {
  appendIapEvent,
  applyAppStoreSnapshot,
  claimAppStorePurchase,
  claimIapNotification,
  completeIapNotification,
  createRevenueEvent,
  findAllAppStorePurchases,
  findAppStorePurchaseByOriginalTransactionId,
  findDigitalEntitlementsByUserId,
  findMembershipBillingOptions,
  findRevenueEventByProviderRef,
  findUserById,
  type AppStorePurchaseRecord,
  type AppStoreSubscriptionStatus,
  type DigitalEntitlementStatus,
  type MembershipBillingOptionRecord,
} from "@/lib/db";
import { describeDigitalPlan, liveStoreEntitlement } from "@/lib/digital-entitlement";
import { isDeletedOwner } from "@/lib/member-deletion-guard";
import { resolveMemberAccessForUser } from "@/lib/membership-entitlement";
import {
  appStoreAccountBindingMatches,
  appStoreAccountToken,
  type AppleNotificationPayload,
  type AppleRenewalInfoPayload,
  type AppleTransactionPayload,
  type AppStoreStatusResult,
} from "@/lib/providers/app-store";

import { getAppStoreAdapter, type AppStoreAdapter } from "./apple-adapter";
import { acceptedAppStoreEnvironment, appStoreIapDisabledReason, appStoreIapEnvironment } from "./apple-config";
import { applyStoreEntitlement, checkStoreConflict, type StoreApplyOutcome } from "./entitlement-apply";
import { STORE_CONFLICT_MEMBER_MESSAGE } from "./messages";
import type { ServiceFailure, VerifyData, JobSummary } from "./service";
import "./apple-real-adapter";

const MAX_JWS_LENGTH = 20_000;
export const APP_STORE_MAX_NOTIFICATION_ATTEMPTS = 8;
export const APP_STORE_RECONCILE_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

const fail = (httpStatus: number, code: string, message: string): ServiceFailure => ({ ok: false, httpStatus, code, message });

const MESSAGES = {
  disabled: "In-app purchases are not available right now.",
  notConfigured: "App Store purchases aren't configured on the server yet.",
  signedRequired: "A signed transaction is required.",
  ownedByOther: "This purchase is already linked to another account. Sign in to the account you bought it with.",
  // One generic answer for a missing, malformed or mismatched binding: saying which would leak whether one was sent.
  bindingRequired: "This purchase could not be verified for your account.",
  providerUnavailable: "The App Store couldn't be reached. Try again shortly.",
  providerRejected: "This purchase could not be verified.",
  productUnknown: "This purchase doesn't match a known digital plan product.",
  environment: "This purchase can't be used with this version of the app.",
  pending: "Your purchase is still being processed by the App Store. Try again shortly.",
} as const;

// The apps' own product id, never a price: prices come from the store at display time.
function findBillingOptionByAppleProduct(productId: string | null | undefined): MembershipBillingOptionRecord | undefined {
  if (!productId) return undefined;
  return findMembershipBillingOptions().find((o) => o.appStoreProductId === productId);
}

const isoFromMillis = (ms: number | null | undefined) => (typeof ms === "number" && ms > 0 ? new Date(ms).toISOString() : null);

// Apple's subscription status codes (App Store Server API): 1 active, 2 expired, 3 billing retry, 4 grace, 5 revoked.
function mapAppleStatus(status: number, autoRenewing: boolean): { purchase: AppStoreSubscriptionStatus; digital: DigitalEntitlementStatus } | null {
  switch (status) {
    case 1:
      // Auto-renew turned off but inside the paid period: access continues to the expiry, shown as ending.
      return { purchase: "active", digital: autoRenewing ? "active" : "canceled" };
    case 2:
      return { purchase: "expired", digital: "expired" };
    case 3:
      // Billing retry WITHOUT a grace period: Apple is retrying but the member has no access in the meantime.
      return { purchase: "billing_retry", digital: "on_hold" };
    case 4:
      return { purchase: "in_grace_period", digital: "in_grace_period" };
    case 5:
      return { purchase: "revoked", digital: "revoked" };
    default:
      return null;
  }
}

const ENTITLING: ReadonlySet<DigitalEntitlementStatus> = new Set(["active", "canceled", "in_grace_period"]);

// ── Catalog and purchase context ─────────────────────────────────────────────────────────────

export interface DigitalPlanCatalogEntry {
  billingOptionId: string;
  /** Billing period for display grouping only; the price is whatever the store reports. */
  intervalUnit: "month" | "year" | null;
  intervalCount: number | null;
  appStoreProductId: string | null;
  googlePlayProductId: string | null;
  googlePlayBasePlanId: string | null;
}

// The store product identifiers the app should ask the stores about. Deliberately carries NO price: the app shows the
// price the store returns, localised and tax-inclusive where the store says so, and the server never states one.
export function getDigitalPlanCatalog(): DigitalPlanCatalogEntry[] {
  return findMembershipBillingOptions()
    .filter((o) => !!o.appStoreProductId || !!o.googlePlaySubscriptionId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((o) => ({
      billingOptionId: o.id,
      intervalUnit: o.intervalUnit,
      intervalCount: o.intervalCount,
      appStoreProductId: o.appStoreProductId ?? null,
      googlePlayProductId: o.googlePlaySubscriptionId ?? null,
      googlePlayBasePlanId: o.googlePlayBasePlanId ?? null,
    }));
}

export type AppStoreContextResult = { ok: true; data: { appAccountToken: string; environment: string } } | ServiceFailure;

export function getAppStorePurchaseContext(userId: string, adapter: AppStoreAdapter = getAppStoreAdapter()): AppStoreContextResult {
  if (appStoreIapDisabledReason()) return fail(503, "iap_disabled", MESSAGES.disabled);
  if (!adapter.isConfigured()) return fail(503, "not_configured", MESSAGES.notConfigured);

  const live = liveStoreEntitlement(userId);
  if (live) {
    const code = live.source === "app_store" ? "subscription_already_active" : "other_store_active";
    appendIapEvent({ provider: "app_store", type: "claim_rejected_conflict", userId, actor: "user", detail: { code, source: "purchase_context" } });
    return fail(409, code, STORE_CONFLICT_MEMBER_MESSAGE[code]);
  }

  const token = appStoreAccountToken(userId);
  if (!token) return fail(503, "binding_unavailable", MESSAGES.notConfigured);
  return { ok: true, data: { appAccountToken: token, environment: appStoreIapEnvironment() ?? "unset" } };
}

// ── Applying one live state ──────────────────────────────────────────────────────────────────

type AppleOutcome =
  | { kind: "applied"; status: DigitalEntitlementStatus }
  | { kind: "pending" }
  | { kind: "stale" }
  | { kind: "stale_snapshot" }
  | { kind: "other_store_active" }
  | { kind: "already_subscribed" }
  | { kind: "unknown_purchase" };

interface SyncInput {
  originalTransactionId: string;
  live: AppStoreStatusResult;
  /** When the provider call that produced `live` was ISSUED. */
  fetchedAt: string;
  actor: "user" | "provider" | "system";
  /** Apple's own signed notification transaction carried this revocation. */
  revocation?: { reason: "refunded" | "revoked"; transactionId: string | null };
  billingOption?: MembershipBillingOptionRecord;
}

// Synchronous: no await.
function syncAppStorePurchase(input: SyncInput): { outcome: AppleOutcome; purchase?: AppStorePurchaseRecord } {
  const { originalTransactionId, live, fetchedAt, actor } = input;
  const current = findAppStorePurchaseByOriginalTransactionId(originalTransactionId);
  if (!current) return { outcome: { kind: "unknown_purchase" } };

  const tx = live.transaction;
  const renewal = live.renewal;
  const autoRenewing = renewal?.autoRenewStatus === 1;

  // A revocation counts only when it concerns the CURRENT transaction. A refund of an earlier period leaves the current
  // period alone (the same rule as a voided prior order on Google Play).
  const liveRevoked = live.status === 5 || typeof tx.revocationDate === "number";
  const notificationRevokes = !!input.revocation && (!input.revocation.transactionId || !tx.transactionId || input.revocation.transactionId === tx.transactionId);
  const revokedNow = liveRevoked || notificationRevokes;
  if (input.revocation && !notificationRevokes) {
    appendIapEvent({ provider: "app_store", type: "notification_stale", userId: current.userId, purchaseToken: originalTransactionId, actor, detail: { reason: "revoked_prior_transaction" } });
  }

  const mapped = mapAppleStatus(live.status, autoRenewing);
  if (!mapped && !revokedNow && !current.revokedAt) return { outcome: { kind: "pending" }, purchase: current };

  const nowIso = new Date().toISOString();
  const applied = applyAppStoreSnapshot(
    originalTransactionId,
    {
      latestTransactionId: tx.transactionId ?? current.latestTransactionId,
      productId: tx.productId ?? current.productId,
      environment: live.environment,
      status: revokedNow ? "revoked" : mapped ? mapped.purchase : current.status,
      autoRenewing,
      purchaseDateMillis: tx.originalPurchaseDate ?? tx.purchaseDate ?? current.purchaseDateMillis,
      expiresDateMillis: tx.expiresDate ?? null,
      ...(revokedNow && !current.revokedAt
        ? { revokedAt: nowIso, revocationReason: input.revocation?.reason ?? (tx.revocationReason === 1 ? ("refunded" as const) : ("revoked" as const)) }
        : {}),
    },
    fetchedAt
  );
  if (applied.status === "stale") return { outcome: { kind: "stale_snapshot" } };
  if (applied.status === "unknown_purchase") return { outcome: { kind: "unknown_purchase" } };

  const purchase = applied.purchase;
  if (isDeletedOwner(purchase.userId) || !findUserById(purchase.userId)) {
    appendIapEvent({ provider: "app_store", type: "notification_stale", userId: null, purchaseToken: originalTransactionId, actor, detail: { reason: "owner_deleted" } });
    return { outcome: { kind: "stale" }, purchase };
  }

  const option = input.billingOption ?? findBillingOptionByAppleProduct(purchase.productId);
  // A purchase Apple revoked stays revoked: no later snapshot may re-entitle it.
  const status: DigitalEntitlementStatus = purchase.revokedAt ? "revoked" : mapped ? mapped.digital : "revoked";
  const graceEnd = status === "in_grace_period" ? isoFromMillis(renewal?.gracePeriodExpiresDate) : null;

  const result: StoreApplyOutcome = applyStoreEntitlement({
    userId: purchase.userId,
    source: "app_store",
    storeRef: originalTransactionId,
    supersedesRef: null,
    status,
    productId: purchase.productId,
    billingOptionId: option?.id ?? null,
    environment: purchase.environment,
    currentPeriodEnd: graceEnd ?? isoFromMillis(purchase.expiresDateMillis),
    autoRenewing: purchase.autoRenewing,
    revokedAt: purchase.revokedAt ?? null,
    actor,
  });
  if (result.kind !== "applied") return { outcome: result, purchase };

  // Revenue is recorded once per Apple transaction, for production purchases only. A sandbox purchase is never revenue.
  const ref = tx.transactionId ? `apple:${tx.transactionId}` : null;
  if (ref && status === "active" && purchase.environment === "production" && option && !findRevenueEventByProviderRef("app_store", ref)) {
    createRevenueEvent({
      id: randomUUID(),
      userId: purchase.userId,
      packageId: option.packageId,
      billingOptionId: option.id,
      amountCents: option.amountCents,
      currency: option.currency,
      provider: "app_store",
      providerRef: ref,
      source: "membership_renewal",
      receivedAt: nowIso,
      ownerGym: { scope: "platform" },
    });
  }
  return { outcome: { kind: "applied", status }, purchase };
}

// ── Claim: POST /api/mobile/billing/app-store/verify ─────────────────────────────────────────

export type AppStoreVerifyResult = { ok: true; httpStatus: 200; message: string; data: VerifyData } | ServiceFailure;

export async function verifyAndClaimAppStoreTransaction(
  userId: string,
  signedTransaction: unknown,
  adapter: AppStoreAdapter = getAppStoreAdapter()
): Promise<AppStoreVerifyResult> {
  const disabled = appStoreIapDisabledReason();
  if (disabled) {
    appendIapEvent({ provider: "app_store", type: "claim_rejected_disabled", userId, actor: "user", detail: { reason: disabled } });
    return fail(503, "iap_disabled", MESSAGES.disabled);
  }
  if (!adapter.isConfigured()) return fail(503, "not_configured", MESSAGES.notConfigured);

  if (typeof signedTransaction !== "string" || !signedTransaction.trim() || signedTransaction.length > MAX_JWS_LENGTH) {
    return fail(400, "invalid_request", MESSAGES.signedRequired);
  }

  // 1. The client's transaction must be Apple's: chain to the pinned root, signature valid.
  const verified = adapter.verifySigned<AppleTransactionPayload>(signedTransaction.trim());
  if (!verified.ok) {
    appendIapEvent({ provider: "app_store", type: "claim_rejected_product", userId, actor: "user", detail: { reason: "signature", code: verified.code } });
    return fail(400, "provider_rejected", MESSAGES.providerRejected);
  }
  const clientTx = verified.payload;
  const originalTransactionId = clientTx.originalTransactionId;
  if (!originalTransactionId || clientTx.bundleId !== adapter.expectedBundleId() || clientTx.type !== "Auto-Renewable Subscription") {
    appendIapEvent({ provider: "app_store", type: "claim_rejected_product", userId, actor: "user", detail: { reason: "not_this_app" } });
    return fail(400, "product_unknown", MESSAGES.productUnknown);
  }
  // A family-shared entitlement belongs to the family member who paid; it is not this account's own purchase.
  if (clientTx.inAppOwnershipType && clientTx.inAppOwnershipType !== "PURCHASED") return fail(400, "product_unknown", MESSAGES.productUnknown);

  const environment = acceptedAppStoreEnvironment(clientTx.environment);
  if (!environment) {
    appendIapEvent({ provider: "app_store", type: "claim_rejected_environment", userId, purchaseToken: originalTransactionId, actor: "user", detail: { environment: String(clientTx.environment ?? "") } });
    return fail(409, "environment_not_accepted", MESSAGES.environment);
  }

  const option = findBillingOptionByAppleProduct(clientTx.productId);
  if (!option) {
    appendIapEvent({ provider: "app_store", type: "claim_rejected_product", userId, purchaseToken: originalTransactionId, actor: "user" });
    return fail(400, "product_unknown", MESSAGES.productUnknown);
  }

  // Ownership gate before any provider call.
  const early = findAppStorePurchaseByOriginalTransactionId(originalTransactionId);
  if (early && early.userId !== userId) {
    appendIapEvent({ provider: "app_store", type: "claim_rejected_owner", userId, purchaseToken: originalTransactionId, actor: "user" });
    return fail(409, "owned_by_other", MESSAGES.ownedByOther);
  }

  // 2. The live state, from Apple.
  const fetchedAt = new Date().toISOString();
  const fetched = await adapter.fetchStatus(originalTransactionId, environment);
  if (!fetched.ok) {
    return fetched.retryable ? fail(502, "provider_unavailable", MESSAGES.providerUnavailable) : fail(400, "provider_rejected", MESSAGES.providerRejected);
  }
  const live = fetched.result;

  // ── Synchronous section: everything below to the end of the claim has no await. ──
  const existing = findAppStorePurchaseByOriginalTransactionId(originalTransactionId);
  if (existing && existing.userId !== userId) {
    appendIapEvent({ provider: "app_store", type: "claim_rejected_owner", userId, purchaseToken: originalTransactionId, actor: "user" });
    return fail(409, "owned_by_other", MESSAGES.ownedByOther);
  }

  // The live transaction must be the same subscription for the same app, in the environment we asked about.
  if (live.transaction.originalTransactionId !== originalTransactionId || live.transaction.bundleId !== adapter.expectedBundleId() || live.environment !== environment) {
    appendIapEvent({ provider: "app_store", type: "claim_rejected_product", userId, purchaseToken: originalTransactionId, actor: "user", detail: { reason: "live_mismatch" } });
    return fail(400, "provider_rejected", MESSAGES.providerRejected);
  }

  // A subscription with no owner must carry THIS session user's appAccountToken, on the signed transaction AND the live one
  // (if Apple reports one there). Already-owned subscriptions stay idempotent without it (restore).
  if (!existing) {
    const expected = appStoreAccountToken(userId);
    const liveToken = live.transaction.appAccountToken;
    const bound =
      appStoreAccountBindingMatches(expected, clientTx.appAccountToken) && (liveToken === undefined || appStoreAccountBindingMatches(expected, liveToken));
    if (!bound) {
      appendIapEvent({ provider: "app_store", type: "claim_rejected_binding", userId, purchaseToken: originalTransactionId, actor: "user" });
      return fail(409, "binding_required", MESSAGES.bindingRequired);
    }
  }

  const autoRenewing = live.renewal?.autoRenewStatus === 1;
  const mapped = mapAppleStatus(live.status, autoRenewing);
  const entitlingNow = !!mapped && ENTITLING.has(mapped.digital) && live.status !== 5 && typeof live.transaction.revocationDate !== "number";

  // One paid store subscription per account, decided BEFORE a purchase row exists so a refused claim binds nothing.
  const conflict = checkStoreConflict({ userId, source: "app_store", storeRef: originalTransactionId, supersedesRef: null, entitling: entitlingNow });
  if (conflict) {
    appendIapEvent({ provider: "app_store", type: "claim_rejected_conflict", userId, purchaseToken: originalTransactionId, actor: "user", detail: { code: conflict, source: "verify" } });
    const code = conflict === "already_subscribed" ? "subscription_already_active" : conflict;
    return fail(409, code, STORE_CONFLICT_MEMBER_MESSAGE[code]);
  }

  const claimed = claimAppStorePurchase(
    {
      originalTransactionId,
      latestTransactionId: live.transaction.transactionId ?? null,
      productId: live.transaction.productId ?? clientTx.productId ?? "",
      environment,
      appAccountToken: (live.transaction.appAccountToken ?? clientTx.appAccountToken ?? null)?.toLowerCase() ?? null,
      status: mapped ? mapped.purchase : "expired",
      autoRenewing,
      purchaseDateMillis: live.transaction.originalPurchaseDate ?? null,
      expiresDateMillis: live.transaction.expiresDate ?? null,
    },
    userId
  );
  if (claimed.status === "owned_by_other") return fail(409, "owned_by_other", MESSAGES.ownedByOther);

  const synced = syncAppStorePurchase({ originalTransactionId, live, fetchedAt, actor: "user", billingOption: option });
  // ── End of synchronous section. ──

  const outcome = synced.outcome;
  if (outcome.kind === "pending") return fail(409, "purchase_pending", MESSAGES.pending);
  if (outcome.kind === "other_store_active") return fail(409, "other_store_active", STORE_CONFLICT_MEMBER_MESSAGE.other_store_active);
  if (outcome.kind === "already_subscribed") return fail(409, "subscription_already_active", STORE_CONFLICT_MEMBER_MESSAGE.subscription_already_active);

  return {
    ok: true,
    httpStatus: 200,
    message: "Purchase verified.",
    data: {
      access: resolveMemberAccessForUser(userId),
      plan: describeDigitalPlan(findDigitalEntitlementsByUserId(userId)),
      status: outcome.kind === "applied" ? outcome.status : "unchanged",
      // StoreKit 2 has no server acknowledgement: the client finishes the transaction after this answers.
      acknowledged: true,
    },
  };
}

// ── Notifications (App Store Server Notifications V2) ─────────────────────────────────────────

export interface AppStoreNotificationResult {
  httpStatus: number;
  body: Record<string, unknown>;
}

const ok = (message: string, extra: Record<string, unknown> = {}): AppStoreNotificationResult => ({ httpStatus: 200, body: { ok: true, message, ...extra } });

export async function processAppStoreNotification(signedPayload: unknown, adapter: AppStoreAdapter = getAppStoreAdapter()): Promise<AppStoreNotificationResult> {
  if (typeof signedPayload !== "string" || !signedPayload || signedPayload.length > 100_000) {
    return { httpStatus: 400, body: { error: "A signed payload is required." } };
  }
  if (!adapter.isConfigured()) return { httpStatus: 503, body: { error: "Provider is not configured." } };

  // Nothing is read, recorded or deduplicated before the signature verifies: a forged notification changes nothing.
  const verified = adapter.verifySigned<AppleNotificationPayload>(signedPayload);
  if (!verified.ok) return { httpStatus: 401, body: { error: "Signature could not be verified." } };
  const notification = verified.payload;
  const uuid = notification.notificationUUID;
  if (!uuid || typeof uuid !== "string" || uuid.length > 100) return { httpStatus: 400, body: { error: "Malformed notification." } };

  const messageId = `appstore:${uuid}`;
  const claim = claimIapNotification(messageId);
  if (claim.status === "duplicate") return ok("Duplicate notification ignored.");

  const finish = (outcome: string, message: string, extra: Record<string, unknown> = {}) => {
    completeIapNotification(messageId, outcome);
    return ok(message, extra);
  };

  if (notification.notificationType === "TEST") return finish("test", "Test notification received.");

  const data = notification.data;
  if (!data || data.bundleId !== adapter.expectedBundleId()) return finish("wrong_bundle", "Ignored: notification is for a different app.");
  const environment = acceptedAppStoreEnvironment(data.environment);
  if (!environment) return finish("environment_not_accepted", "Ignored: environment not accepted by this deployment.");
  if (!data.signedTransactionInfo) return finish("no_transaction", "Ignored: no transaction in notification.");

  const txVerified = adapter.verifySigned<AppleTransactionPayload>(data.signedTransactionInfo);
  if (!txVerified.ok || !txVerified.payload.originalTransactionId) return finish("bad_transaction", "Ignored: the transaction in the notification could not be verified.");
  const notifiedTx = txVerified.payload;
  const originalTransactionId = notifiedTx.originalTransactionId as string;

  const purchase = findAppStorePurchaseByOriginalTransactionId(originalTransactionId);
  if (!purchase) {
    // Not linked to a member yet (the notification beat the client's claim). The claim reads fresh state itself.
    return finish("unknown_purchase", "Ignored: subscription not yet linked to a member.");
  }

  if (claim.attempts > APP_STORE_MAX_NOTIFICATION_ATTEMPTS) {
    appendIapEvent({ provider: "app_store", type: "notification_stale", userId: purchase.userId, purchaseToken: originalTransactionId, actor: "provider", detail: { reason: "gave_up", attempts: claim.attempts } });
    return finish("gave_up", "Gave up after repeated provider failures; reconciliation will re-check.");
  }

  const fetchedAt = new Date().toISOString();
  const fetched = await adapter.fetchStatus(originalTransactionId, purchase.environment);
  if (!fetched.ok) {
    if (!fetched.retryable) return finish("provider_rejected", "Ignored: provider no longer recognises this subscription.");
    // Not completed: Apple redelivers, and this notification id is retried (bounded by APP_STORE_MAX_NOTIFICATION_ATTEMPTS).
    return { httpStatus: 502, body: { error: "Could not re-check the subscription with the App Store." } };
  }

  // The notification's own signed transaction may carry a revocation Apple stamped on it (REFUND / REVOKE).
  const revocation =
    typeof notifiedTx.revocationDate === "number"
      ? { reason: notification.notificationType === "REFUND" ? ("refunded" as const) : ("revoked" as const), transactionId: notifiedTx.transactionId ?? null }
      : undefined;

  const synced = syncAppStorePurchase({ originalTransactionId, live: fetched.result, fetchedAt, actor: "provider", revocation });
  const outcome = synced.outcome;
  const access = resolveMemberAccessForUser(purchase.userId);
  if (outcome.kind === "applied") return finish("applied", "Subscription state applied.", { digital: access.digital, status: outcome.status });
  if (outcome.kind === "pending") return finish("pending", "Subscription state recorded; not confident enough to update access yet.");
  return finish(outcome.kind, "Subscription state recorded; the entitlement was not changed.");
}

// ── Background work ──────────────────────────────────────────────────────────────────────────

// Re-asks Apple about subscriptions whose state may have drifted (a lost notification). Ignores the kill switch.
export async function reconcileAppStorePurchases(options: { limit?: number; nowMs?: number; adapter?: AppStoreAdapter } = {}): Promise<JobSummary> {
  const adapter = options.adapter ?? getAppStoreAdapter();
  const nowMs = options.nowMs ?? Date.now();
  const limit = options.limit ?? 25;
  if (!adapter.isConfigured()) return { considered: 0, processed: 0, failed: 0, skipped: "not_configured" };

  const due = findAllAppStorePurchases()
    .filter((p) => !isDeletedOwner(p.userId))
    .filter((p) => !p.revokedAt && p.status !== "expired" && p.status !== "revoked")
    .filter((p) => {
      const last = p.lastSnapshotAt ? new Date(p.lastSnapshotAt).getTime() : 0;
      const expiredButActive = p.expiresDateMillis !== null && p.expiresDateMillis < nowMs;
      return expiredButActive || nowMs - last > APP_STORE_RECONCILE_STALE_AFTER_MS;
    })
    .slice(0, limit);

  const summary: JobSummary = { considered: due.length, processed: 0, failed: 0 };
  for (const purchase of due) {
    const fetchedAt = new Date(nowMs).toISOString();
    const fetched = await adapter.fetchStatus(purchase.originalTransactionId, purchase.environment);
    if (!fetched.ok) {
      summary.failed++;
      if (fetched.code === "unauthorized" || fetched.code === "not_configured") break;
      continue;
    }
    syncAppStorePurchase({ originalTransactionId: purchase.originalTransactionId, live: fetched.result, fetchedAt, actor: "system" });
    summary.processed++;
  }
  appendIapEvent({ provider: "app_store", type: "reconciliation_run", userId: null, actor: "system", detail: { considered: summary.considered, processed: summary.processed, failed: summary.failed } });
  return summary;
}

export type { AppleRenewalInfoPayload };
