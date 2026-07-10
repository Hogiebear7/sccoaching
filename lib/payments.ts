// Commerce service layer: purchase lifecycle + entitlement application.
//
// Sits between API routes and lib/billing.ts (which stays the only module
// that talks to lib/providers/*). Everything here is deliberately boring:
// explicit state machines, append-only ledgers, and idempotent appliers so
// duplicate submits and webhook retries can never double-charge access.
//
// Source-of-truth rules (see docs/payments-architecture.md):
//  - A redirect/success page NEVER grants anything.
//  - Webhook events flip PurchaseRecord.status; entitlements are derived
//    from our own records (subscriptions, pass ledger), not provider state.

import { randomUUID } from "crypto";

import {
  appendPassLedgerEntry,
  findClassPassProductById,
  findPassLedgerByBookingId,
  findPassLedgerByPurchaseId,
  findPassLedgerByUserId,
  savePurchase,
  type BillingProvider,
  type ClassPassProductRecord,
  type PassLedgerEntryRecord,
  type PurchaseRecord,
  type PurchaseStatus,
} from "./db";
import { isPendingCheckoutStale } from "./billing";

// ── Purchase state machine ─────────────────────────────────────────────
// pending → paid | failed | cancelled ; paid → refunded ; others terminal.
const ALLOWED_TRANSITIONS: Record<PurchaseStatus, PurchaseStatus[]> = {
  pending: ["paid", "failed", "cancelled"],
  paid: ["refunded"],
  failed: [],
  cancelled: [],
  refunded: [],
};

export function canTransitionPurchase(from: PurchaseStatus, to: PurchaseStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

// Applies a status transition and persists, or returns null when the
// transition is illegal (e.g. a replayed COMPLETED after a refund).
export function transitionPurchase(
  purchase: PurchaseRecord,
  to: PurchaseStatus
): PurchaseRecord | null {
  if (!canTransitionPurchase(purchase.status, to)) return null;
  const updated: PurchaseRecord = {
    ...purchase,
    status: to,
    updatedAt: new Date().toISOString(),
  };
  savePurchase(updated);
  return updated;
}

// A pending purchase counts as reusable while its checkout is still fresh —
// the same staleness window the membership flow uses, so an abandoned
// checkout can't lock a member out of buying.
export function isPurchaseCheckoutReusable(purchase: PurchaseRecord): boolean {
  return purchase.status === "pending" && !isPendingCheckoutStale(purchase.updatedAt);
}

// ── Pass entitlement ledger ────────────────────────────────────────────

/** Current purchased-pass balance for a member (sum over the ledger). */
export function purchasedPassBalance(userId: string): number {
  return findPassLedgerByUserId(userId).reduce((sum, e) => sum + e.delta, 0);
}

// Credits the passes for a paid purchase exactly once. Safe to call on
// every webhook delivery: replays and retries find the existing credit and
// no-op. Returns whether a credit was written on THIS call.
export function applyPaidPassPurchase(
  purchase: PurchaseRecord,
  product: Pick<ClassPassProductRecord, "passCount" | "name">
): boolean {
  const existing = findPassLedgerByPurchaseId(purchase.id);
  if (existing.some((e) => e.reason === "purchase")) return false;

  const entry: PassLedgerEntryRecord = {
    id: randomUUID(),
    userId: purchase.userId,
    delta: product.passCount,
    reason: "purchase",
    purchaseId: purchase.id,
    bookingId: null,
    note: `${product.name} (${product.passCount} passes)`,
    createdAt: new Date().toISOString(),
  };
  appendPassLedgerEntry(entry);
  return true;
}

// Compensating entry for a refunded purchase: reverses the credit exactly
// once, and only if the credit was actually written. The balance is allowed
// to go negative if passes were already consumed — that is a true statement
// of account, visible to staff, not an error.
export function applyRefundedPassPurchase(purchase: PurchaseRecord): boolean {
  const entries = findPassLedgerByPurchaseId(purchase.id);
  const credit = entries.find((e) => e.reason === "purchase");
  if (!credit) return false;
  if (entries.some((e) => e.reason === "refund_reversal")) return false;

  appendPassLedgerEntry({
    id: randomUUID(),
    userId: purchase.userId,
    delta: -credit.delta,
    reason: "refund_reversal",
    purchaseId: purchase.id,
    bookingId: null,
    note: "Refund — purchase credit reversed",
    createdAt: new Date().toISOString(),
  });
  return true;
}

// ── Pass consumption (booking-driven) ──────────────────────────────────
//
// Purchased passes are spent when a booking exceeds the plan's monthly
// allowance. Provenance is the booking id, which is what makes retries and
// repeated actions inert: one consume and at most one reversal per booking.

/** True if this booking already spent a purchased pass. */
export function hasConsumedPassForBooking(bookingId: string): boolean {
  return findPassLedgerByBookingId(bookingId).some((e) => e.reason === "consume");
}

// Spends one purchased pass for a booking. Refuses (returns false) when the
// member has no positive balance or this booking already consumed — callers
// treat false as "not covered by pass packs".
export function consumePurchasedPass(input: { userId: string; bookingId: string }): boolean {
  if (hasConsumedPassForBooking(input.bookingId)) return false;
  if (purchasedPassBalance(input.userId) <= 0) return false;

  appendPassLedgerEntry({
    id: randomUUID(),
    userId: input.userId,
    delta: -1,
    reason: "consume",
    purchaseId: null,
    bookingId: input.bookingId,
    note: null,
    createdAt: new Date().toISOString(),
  });
  return true;
}

// Compensating +1 for an early-enough cancellation (the caller applies the
// app's existing cancellation-window rule; this function only guarantees
// once-only reversal of an actual consumption).
export function reversePassConsumption(bookingId: string): boolean {
  const entries = findPassLedgerByBookingId(bookingId);
  const consumed = entries.find((e) => e.reason === "consume");
  if (!consumed) return false;
  if (entries.some((e) => e.reason === "consume_reversal")) return false;

  appendPassLedgerEntry({
    id: randomUUID(),
    userId: consumed.userId,
    delta: 1,
    reason: "consume_reversal",
    purchaseId: null,
    bookingId,
    note: "Early cancellation — pass returned",
    createdAt: new Date().toISOString(),
  });
  return true;
}

// ── Purchase construction ──────────────────────────────────────────────

export function buildPassPackPurchase(input: {
  userId: string;
  product: ClassPassProductRecord;
  idempotencyKey: string;
  provider: BillingProvider;
}): PurchaseRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    userId: input.userId,
    kind: "pass_pack",
    productId: input.product.id,
    description: `${input.product.name} — ${input.product.passCount} class passes`,
    amountCents: input.product.priceCents,
    status: "pending",
    provider: input.provider,
    providerOrderId: null,
    providerPaymentRef: null,
    checkoutUrl: null,
    idempotencyKey: input.idempotencyKey,
    createdAt: now,
    updatedAt: now,
  };
}

export function findActivePassProduct(productId: string): ClassPassProductRecord | undefined {
  const product = findClassPassProductById(productId);
  return product && product.isActive ? product : undefined;
}
