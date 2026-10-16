// Google Play digital-plan service: claim, lifecycle, acknowledgement, reconciliation.
//
// Routes and jobs are thin callers of this module. Every rule from the owner defaults (plan section 1) is enforced HERE, in
// one place, against the provider-neutral adapter (./adapter):
//
//  - Entitlement is granted only after the provider is asked and answers (D5). A claim that is refused never creates a
//    purchase row, never acknowledges and never writes an entitlement (D1, I5).
//  - First valid binding wins (D3): a new token must echo the session user's one-way account binding; a token owned by
//    another account is rejected and never reassigned; a duplicate by the same account is idempotent.
//  - Synchronous section: after the provider call returns there is NO await until the purchase row, the entitlement row and
//    the audit events are written, so no other request interleaves (the datastore is one synchronous JSON file; see plan
//    section 3).
//  - Stale tokens cannot rewrite the row (./entitlement-apply): a snapshot or notification for a token that is neither the one
//    the row is billed through nor its direct successor never overwrites a live entitlement.
//  - Snapshot ordering: each provider answer carries the time its call was issued; an older answer than the newest applied is
//    dropped.
//  - Lifecycle processing ignores the kill switch (I6): withdrawing access must never be switchable off.
//  - Provider errors are a closed set of codes; no provider text reaches a caller.
//
// Since owner decision D1 (2026-10-15) the entitlement is a DigitalEntitlementRecord, separate from the gym Membership row. A
// gym Membership never blocks, replaces or is replaced by a purchase here.
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
  findDigitalEntitlementsByUserId,
  findGooglePlayPurchaseByToken,
  findMembershipBillingOptions,
  findRevenueEventByProviderRef,
  findUserById,
  recordGooglePlayAcknowledgement,
  type DigitalEntitlementStatus,
  type GooglePlayPurchaseRecord,
  type GooglePlaySubscriptionStatus,
  type MembershipBillingOptionRecord,
} from "@/lib/db";
import { aiAllowanceConfigured } from "@/lib/ai-allowance";
import { describeDigitalPlan, liveStoreEntitlement, type DigitalPlanSummary } from "@/lib/digital-entitlement";
import type { MemberAccess } from "@/lib/member-access";
import { isDeletedOwner } from "@/lib/member-deletion-guard";
import { resolveMemberAccessForUser } from "@/lib/membership-entitlement";
import { googlePlayAccountBindingMatches, googlePlayObfuscatedAccountId } from "@/lib/providers/google-play";

import { getPlayAdapter, type PlayAdapter, type ProviderSubscriptionSnapshot } from "./adapter";
import { iapDisabledReason, iapEnvironment } from "./config";
import { applyStoreEntitlement, checkStoreConflict, type StoreApplyOutcome } from "./entitlement-apply";
import { STORE_CONFLICT_MEMBER_MESSAGE } from "./messages";
import "./google-adapter";

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
  productUnknown: "This purchase doesn't match a known digital plan product.",
  pending: "Your purchase is still being processed by Google Play. Try again shortly.",
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

// Is the current period a free trial? Google's subscriptionsv2 resource says so itself: lineItems[].offerPhase is exactly one of freeTrial /
// introductoryPrice / basePrice / prorationPeriod. That is the AUTHORITY ("store_reported"), and it is the only thing revenue decisions use.
//
// Only when Google reports no phase at all is a fallback used ("inferred"): an offer id plus a period of at most 8 days since the subscription began
// (the longest launch trial is 7 days, the shortest paid period a month). The fallback exists to bound AI cost (an uncertain period gets the smaller trial
// allowance, never the larger paid one); it is NOT evidence and is never used to decide whether money was received.
export const GOOGLE_TRIAL_MAX_MS = 8 * 24 * 60 * 60 * 1000;
export function googleTrialEvidence(
  s: Pick<ProviderSubscriptionSnapshot, "offerId" | "offerPhase" | "startTimeMillis" | "expiryTimeMillis">
): { trial: boolean; basis: "store_reported" | "inferred" } {
  if (s.offerPhase) return { trial: s.offerPhase === "free_trial", basis: "store_reported" };
  const inferred = !!s.offerId && s.startTimeMillis != null && s.expiryTimeMillis != null && s.expiryTimeMillis - s.startTimeMillis <= GOOGLE_TRIAL_MAX_MS;
  return { trial: inferred, basis: "inferred" };
}

// Statuses for which Google expects the purchase to be acknowledged (the member has, or had, access to it).
const ACK_STATUSES: ReadonlySet<DigitalEntitlementStatus> = new Set(["active", "canceled", "in_grace_period"]);
const isEntitling = (status: DigitalEntitlementStatus): boolean => ACK_STATUSES.has(status);

function digitalStatusOfPlayStatus(status: GooglePlaySubscriptionStatus): DigitalEntitlementStatus {
  // 1:1 with Google's states. "canceled" keeps access to the paid expiry, which isDigitalEntitlementLive enforces from the
  // expiry time, not from this label.
  return status;
}

// ── Applying one provider snapshot to a purchase and, if allowed, to the member's entitlement ─────

type EntitlementOutcome =
  | { kind: "applied"; status: DigitalEntitlementStatus }
  | { kind: "pending" }
  | { kind: "stale" }
  | { kind: "other_store_active" }
  | { kind: "already_subscribed" }
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

// Synchronous: no await. Writes the purchase snapshot, the entitlement row and the audit events together.
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
      freeTrial: googleTrialEvidence(snapshot).trial,
      offerPhase: snapshot.offerPhase ?? null,
      acknowledgementState: current.acknowledged || snapshot.acknowledged ? "acknowledged" : current.acknowledgementState ?? "pending",
      ...(revokedNow && !current.revokedAt ? { revokedAt: nowIso, revocationReason: "voided" as const } : {}),
    },
    fetchedAt
  );
  if (applied.status === "stale") return { outcome: { kind: "stale_snapshot" } };
  if (applied.status === "unknown_token") return { outcome: { kind: "unknown_token" } };

  const purchase = applied.purchase;
  // The member's account was permanently deleted after the entitlement ended. The purchase record is kept (anonymised) so the
  // token stays owned and the snapshot above is recorded, but there is no account left to entitle: never create an
  // entitlement for a user that does not exist.
  if (isDeletedOwner(purchase.userId) || !findUserById(purchase.userId)) {
    appendIapEvent({ type: "notification_stale", userId: null, purchaseToken: token, actor, detail: { reason: "owner_deleted" } });
    return { outcome: { kind: "stale" }, purchase };
  }
  // A not-yet-confident provider state (pending, unspecified) never grants.
  if (mapped.appStatus === null && !purchase.revokedAt) return { outcome: { kind: "pending" }, purchase };

  const option = input.billingOption ?? findBillingOption(purchase.productId, purchase.basePlanId);
  const outcome = applyEntitlement({ token, purchase, option, actor });
  return { outcome, purchase };
}

function applyEntitlement(args: {
  token: string;
  purchase: GooglePlayPurchaseRecord;
  option: MembershipBillingOptionRecord | undefined;
  actor: "user" | "provider" | "system";
}): EntitlementOutcome {
  const { token, purchase, option, actor } = args;
  // A voided purchase stays void: no later snapshot may re-entitle it.
  const status: DigitalEntitlementStatus = purchase.revokedAt ? "revoked" : digitalStatusOfPlayStatus(purchase.status);

  const result: StoreApplyOutcome = applyStoreEntitlement({
    userId: purchase.userId,
    source: "google_play",
    storeRef: token,
    supersedesRef: purchase.linkedPurchaseToken,
    status,
    productId: purchase.productId,
    billingOptionId: option?.id ?? null,
    environment: null,
    currentPeriodEnd: isoFromMillis(purchase.expiryTimeMillis),
    autoRenewing: purchase.autoRenewing,
    trial: purchase.freeTrial === true,
    revokedAt: purchase.revokedAt ?? null,
    actor,
  });
  if (result.kind !== "applied") return result;

  // Revenue is recorded once per Google order id, and ALWAYS as UNVERIFIED: this server does not fetch what Google actually charged (the Orders API:
  // amount, currency, tax), so the row carries the catalog price as a placeholder to reconcile against Google's sales report, and is not counted as income
  // until then (lib/finance.ts). An entitlement, a renewal date or an active state is not money received.
  // A period Google itself reports as a free trial charged nothing and is not recorded at all. If Google reported no phase, the row is still recorded, as
  // unverified, with that reason: a paid period must not silently vanish from reconciliation because a trial was guessed.
  if (purchase.orderId && status === "active" && purchase.offerPhase !== "free_trial" && option && !findRevenueEventByProviderRef("google_play", purchase.orderId)) {
    createRevenueEvent({
      id: randomUUID(),
      userId: purchase.userId,
      packageId: option.packageId,
      billingOptionId: option.id,
      amountCents: option.amountCents,
      currency: option.currency,
      provider: "google_play",
      providerRef: purchase.orderId,
      source: "membership_renewal",
      receivedAt: new Date().toISOString(),
      evidence: "unverified",
      unverifiedReason: purchase.offerPhase
        ? "Charged amount and currency not fetched from Google (Orders API); the catalog price is a placeholder. Reconcile against Google's sales report."
        : "Google did not report the offer phase and the charged amount is not fetched; trial status is inferred and the catalog price is a placeholder. Reconcile against Google's sales report.",
      ownerGym: { scope: "platform" },
    });
  }

  return { kind: "applied", status };
}

// ── Acknowledgement ──────────────────────────────────────────────────────────────────────────────

async function acknowledgeIfNeeded(adapter: PlayAdapter, token: string): Promise<boolean> {
  const purchase = findGooglePlayPurchaseByToken(token);
  if (!purchase || purchase.acknowledged || purchase.revokedAt) return !!purchase?.acknowledged;
  if (!isEntitling(digitalStatusOfPlayStatus(purchase.status))) return false;

  const result = await adapter.acknowledge(token);
  recordGooglePlayAcknowledgement(token, result.ok ? { ok: true } : { ok: false, code: result.code });
  return result.ok;
}

// ── Purchase context: the account binding the client must set before purchase ───────────────────

export type PurchaseContextResult =
  | { ok: true; data: { obfuscatedAccountId: string; environment: string } }
  | ServiceFailure;

export function getPurchaseContext(userId: string, adapter: PlayAdapter = getPlayAdapter()): PurchaseContextResult {
  if (iapDisabledReason()) return fail(503, "iap_disabled", MESSAGES.disabled);
  if (!adapter.isConfigured()) return fail(503, "not_configured", MESSAGES.notConfigured);
  // Never start a sale whose AI cost is uncapped: all four allowance budgets must be set (lib/ai-allowance.ts).
  if (!aiAllowanceConfigured()) return fail(503, "not_configured", MESSAGES.notConfigured);

  // No purchase intent for a member who already holds a live paid store subscription: a second one would bill twice. A gym
  // Membership or a complimentary grant does not prevent a purchase (they are separate products).
  const live = liveStoreEntitlement(userId);
  if (live) {
    const code = live.source === "google_play" ? "subscription_already_active" : "other_store_active";
    appendIapEvent({ type: "claim_rejected_conflict", userId, actor: "user", detail: { code, source: "purchase_context" } });
    return fail(409, code, STORE_CONFLICT_MEMBER_MESSAGE[code]);
  }

  const obfuscatedAccountId = googlePlayObfuscatedAccountId(userId);
  if (!obfuscatedAccountId) return fail(503, "binding_unavailable", MESSAGES.notConfigured);
  return { ok: true, data: { obfuscatedAccountId, environment: iapEnvironment() ?? "unset" } };
}

// ── Claim: POST /api/mobile/billing/google-play/verify ───────────────────────────────────────────

export interface VerifyData {
  /** The member's access after the claim. Display convenience: the server decides from its records on every request. */
  access: MemberAccess;
  plan: DigitalPlanSummary | null;
  status: string;
  acknowledged: boolean;
}

export type VerifyResult = { ok: true; httpStatus: 200; message: string; data: VerifyData } | ServiceFailure;

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

  const entitlingNow = mapped.appStatus !== null && isEntitling(digitalStatusOfPlayStatus(mapped.playStatus as GooglePlaySubscriptionStatus));

  // One paid store subscription per account (D1/D2), decided BEFORE a purchase row exists so a refused claim leaves no
  // pending intent and the token stays unbound and unacknowledged (I5). A gym Membership is not a conflict.
  const conflictCode = checkStoreConflict({ userId, source: "google_play", storeRef: token, supersedesRef: snapshot.linkedPurchaseToken, entitling: entitlingNow });
  // An already-owned purchase that grants nothing right now may still be refreshed for history.
  if (conflictCode) {
    appendIapEvent({ type: "claim_rejected_conflict", userId, purchaseToken: token, actor: "user", detail: { code: conflictCode, source: "verify" } });
    return fail(409, conflictCode === "already_subscribed" ? "subscription_already_active" : conflictCode, STORE_CONFLICT_MEMBER_MESSAGE[conflictCode === "already_subscribed" ? "subscription_already_active" : conflictCode]);
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
      freeTrial: googleTrialEvidence(snapshot).trial,
      offerPhase: snapshot.offerPhase ?? null,
      // Stored for audit only: already an opaque one-way hash, never the raw user id.
      obfuscatedExternalAccountId: snapshot.accountBinding,
      acknowledgementState: snapshot.acknowledged ? "acknowledged" : "pending",
    },
    userId
  );
  if (claimed.status === "owned_by_other") return fail(409, "owned_by_other", MESSAGES.ownedByOther);

  const synced = syncPurchase({ adapter, token, snapshot, fetchedAt, actor: "user", billingOption: option });
  // ── End of synchronous section. ──

  const outcome = synced.outcome;
  if (outcome.kind === "pending") return fail(409, "purchase_pending", MESSAGES.pending);
  if (outcome.kind === "other_store_active") return fail(409, "other_store_active", STORE_CONFLICT_MEMBER_MESSAGE.other_store_active);
  if (outcome.kind === "already_subscribed") return fail(409, "subscription_already_active", STORE_CONFLICT_MEMBER_MESSAGE.subscription_already_active);

  // Acknowledge only a purchase that was actually entitled, after the entitlement is written (D5, I5).
  let acknowledged = !!findGooglePlayPurchaseByToken(token)?.acknowledged;
  if (outcome.kind === "applied" && isEntitling(outcome.status) && !acknowledged) {
    acknowledged = await acknowledgeIfNeeded(adapter, token);
  }

  const status = outcome.kind === "applied" ? outcome.status : mapped.playStatus;
  return {
    ok: true,
    httpStatus: 200,
    message: "Purchase verified.",
    data: { access: resolveMemberAccessForUser(userId), plan: describeDigitalPlan(findDigitalEntitlementsByUserId(userId)), status, acknowledged },
  };
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

  if (outcome.kind === "applied" && isEntitling(outcome.status)) await acknowledgeIfNeeded(adapter, token);

  const access = resolveMemberAccessForUser(purchase.userId);
  if (outcome.kind === "applied") return finish("applied", "Purchase state applied.", { digital: access.digital, status: outcome.status });
  if (outcome.kind === "pending") return finish("pending", "Purchase state recorded; not confident enough to update access yet.");
  return finish(outcome.kind, "Purchase state recorded; the entitlement was not changed.");
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
    .filter((p) => !isDeletedOwner(p.userId))
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
    .filter((p) => !isDeletedOwner(p.userId))
    .filter((p) => !p.acknowledged && !p.revokedAt && p.acknowledgementState !== "not_required")
    .filter((p) => isEntitling(digitalStatusOfPlayStatus(p.status)))
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
