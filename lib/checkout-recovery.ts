// Late-payment recovery for checkouts that looked abandoned.
//
// A Stripe Checkout session stays payable for up to 24 hours, but this app treats a checkout as stale after 30 minutes
// (lib/billing.ts PENDING_CHECKOUT_STALE_AFTER_MS). The cleanup job used to CLEAR a stale checkout from the subscription row, and a
// provider takeover (a Google Play purchase replacing a pending Stripe row) dropped its setup-order reference. A member who then paid
// late was charged by Stripe while the webhook matched no row, and the payment needed manual recovery.
//
// Policy now: a stale or displaced checkout is PARKED in SubscriptionRecord.abandonedCheckouts (provider session id, package, billing
// option, start and clear times, reason), never discarded. A late completion is reconciled through the same guards as an on-time one
// (app/api/stripe/webhook/route.ts): applied if no other provider holds a live entitlement, REFUSED and audited as a manual-recovery
// case if one does. Nothing is cancelled or refunded automatically. Parking is idempotent (one entry per session id) and bounded.

import type { AbandonedCheckout } from "./db";

// A subscription keeps at most this many abandoned checkouts (newest kept). Bounds growth.
export const MAX_ABANDONED_CHECKOUTS = 10;

export function parkAbandonedCheckout(existing: AbandonedCheckout[] | undefined, entry: AbandonedCheckout): AbandonedCheckout[] {
  const list = existing ?? [];
  // Idempotent: one entry per provider session id. A repeat keeps the first (earliest) record exactly as it was.
  if (list.some((c) => c.sessionId === entry.sessionId)) return list;
  return [...list, entry].slice(-MAX_ABANDONED_CHECKOUTS);
}

export function settleAbandonedCheckout(existing: AbandonedCheckout[] | undefined, sessionId: string, settledAt: string): AbandonedCheckout[] {
  return (existing ?? []).map((c) => (c.sessionId === sessionId && !c.settledAt ? { ...c, settledAt } : c));
}
