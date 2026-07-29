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
  findPassLedgerByBookingId,
  findPassLedgerByPurchaseId,
  findPassLedgerByUserId,
  savePurchase,
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

/**
 * Current purchased-pass balance for a member.
 *
 * Replays the ledger chronologically into per-purchase pools so expiry can
 * apply per purchase: consumption spends the oldest usable pool first
 * (FIFO), a consume_reversal returns the pass to the pool it came from
 * (booking id provenance), and a pool past its expiresAt forfeits whatever
 * positive remainder it has. Negative remainders (refund taken after use)
 * survive expiry — a refund debt is not forgiven by time. For ledgers with
 * no expiring credits this reduces exactly to the old sum-of-deltas.
 */
export function purchasedPassBalance(userId: string, now: Date = new Date()): number {
  const pools = purchasedPassPools(userId);
  const nowIso = now.toISOString();

  const available = pools.reduce((sum, pool) => {
    if (pool.expiresAt !== null && pool.expiresAt <= nowIso) {
      return sum + Math.min(pool.remaining, 0);
    }
    return sum + pool.remaining;
  }, 0);

  return available;
}

export type PurchasedPassPool = { remaining: number; expiresAt: string | null };

/**
 * The per-purchase pools behind purchasedPassBalance, replayed from the
 * ledger. Exposed so expiry can be SHOWN (member "expires soon" notices,
 * staff detail), not just enforced. A running deficit (consumption that no
 * pool could cover) is folded in as a final negative never-expiring pool so
 * summing pool remainders always reproduces the balance.
 */
export function purchasedPassPools(userId: string): PurchasedPassPool[] {
  const entries = [...findPassLedgerByUserId(userId)].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );

  type Pool = { remaining: number; expiresAt: string | null };
  const pools: Pool[] = [];
  const poolByPurchase = new Map<string, Pool>();
  const poolByBooking = new Map<string, Pool>();
  let deficit = 0;

  const usableAt = (pool: Pool, at: string) =>
    pool.remaining > 0 && (pool.expiresAt === null || pool.expiresAt > at);

  for (const e of entries) {
    switch (e.reason) {
      case "purchase": {
        const pool: Pool = { remaining: e.delta, expiresAt: e.expiresAt ?? null };
        pools.push(pool);
        if (e.purchaseId) poolByPurchase.set(e.purchaseId, pool);
        break;
      }
      case "refund_reversal": {
        const pool = e.purchaseId ? poolByPurchase.get(e.purchaseId) : undefined;
        if (pool) pool.remaining += e.delta;
        else deficit -= e.delta;
        break;
      }
      case "staff_adjust": {
        if (e.delta >= 0) {
          // Staff grants never expire.
          pools.push({ remaining: e.delta, expiresAt: null });
        } else {
          let toTake = -e.delta;
          for (const pool of pools) {
            if (toTake === 0) break;
            if (!usableAt(pool, e.createdAt)) continue;
            const take = Math.min(pool.remaining, toTake);
            pool.remaining -= take;
            toTake -= take;
          }
          deficit += toTake;
        }
        break;
      }
      case "consume": {
        const pool = pools.find((p) => usableAt(p, e.createdAt));
        if (pool) {
          pool.remaining -= 1;
          if (e.bookingId) poolByBooking.set(e.bookingId, pool);
        } else {
          deficit += 1;
        }
        break;
      }
      case "consume_reversal": {
        const pool = e.bookingId ? poolByBooking.get(e.bookingId) : undefined;
        if (pool) pool.remaining += 1;
        else if (deficit > 0) deficit -= 1;
        else pools.push({ remaining: 1, expiresAt: null });
        break;
      }
    }
  }

  if (deficit > 0) pools.push({ remaining: -deficit, expiresAt: null });

  return pools;
}

/**
 * Usable passes that stop being usable within the window: pools that are
 * positive, not yet expired, and expiring on or before the horizon. Returns
 * the total at stake plus the soonest expiry, or null when nothing applies.
 */
export function expiringPassSummary(
  userId: string,
  withinDays: number,
  now: Date = new Date()
): { count: number; soonestExpiresAt: string } | null {
  const nowIso = now.toISOString();
  const horizonIso = new Date(now.getTime() + withinDays * 86_400_000).toISOString();

  const expiring = purchasedPassPools(userId).filter(
    (pool) =>
      pool.remaining > 0 &&
      pool.expiresAt !== null &&
      pool.expiresAt > nowIso &&
      pool.expiresAt <= horizonIso
  );

  if (expiring.length === 0) return null;

  return {
    count: expiring.reduce((sum, pool) => sum + pool.remaining, 0),
    soonestExpiresAt: expiring.reduce(
      (min, pool) => (pool.expiresAt! < min ? pool.expiresAt! : min),
      expiring[0].expiresAt!
    ),
  };
}

// Credits the passes for a paid purchase exactly once. Safe to call on
// every webhook delivery: replays and retries find the existing credit and
// no-op. Returns whether a credit was written on THIS call.
export function applyPaidPassPurchase(
  purchase: PurchaseRecord,
  product: { passCount: number; name: string; validityDays?: number | null }
): boolean {
  const existing = findPassLedgerByPurchaseId(purchase.id);
  if (existing.some((e) => e.reason === "purchase")) return false;

  // Expiry is stamped at credit time from the product's current rule, so a
  // later product edit never shortens (or extends) passes already bought.
  const creditedAt = new Date();
  const validityDays = product.validityDays ?? null;
  const expiresAt =
    validityDays === null
      ? null
      : new Date(creditedAt.getTime() + validityDays * 86_400_000).toISOString();

  const entry: PassLedgerEntryRecord = {
    id: randomUUID(),
    userId: purchase.userId,
    delta: product.passCount,
    reason: "purchase",
    purchaseId: purchase.id,
    bookingId: null,
    expiresAt,
    note: `${product.name} (${product.passCount} passes)`,
    createdAt: creditedAt.toISOString(),
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
export function reversePassConsumption(bookingId: string, note?: string): boolean {
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
    note: note ?? "Early cancellation — pass returned",
    createdAt: new Date().toISOString(),
  });
  return true;
}

