// The one place a verified store state becomes a member's digital entitlement, shared by the Google Play and App Store
// services so both stores obey the same rules:
//
//   - One live PAID store subscription per account. A second one from the OTHER store is refused (`other_store_active`),
//     never layered on top: the member would be billed twice and one store's reference would be orphaned. The refusal
//     leaves the first entitlement exactly as it is.
//   - A stale reference cannot rewrite the row. A snapshot or notification for a reference that is neither the one the row
//     is billed through nor its direct successor never overwrites a live entitlement.
//   - A reference that is not current may take the row over only when the row grants nothing right now and the incoming
//     state does (a genuine re-subscribe after expiry). A non-entitling state for a stale reference changes nothing.
//   - A staff grant is a separate row and is never read or replaced here.
//
// Synchronous on purpose: no await between the read of the row and its write, so no other request interleaves. Callers
// stay in their own synchronous section around this call.

import {
  appendIapEvent,
  findDigitalEntitlement,
  hashPurchaseToken,
  type DigitalEntitlementRecord,
  type DigitalEntitlementSource,
  type DigitalEntitlementStatus,
} from "@/lib/db";
import { isDigitalEntitlementLive, liveStoreEntitlement, writeStoreEntitlement } from "@/lib/digital-entitlement";

export type StoreSource = Exclude<DigitalEntitlementSource, "staff_grant">;

export type StoreApplyOutcome =
  | { kind: "applied"; status: DigitalEntitlementStatus; entitlement: DigitalEntitlementRecord }
  /** Not applied: a stale reference, or a non-entitling state that has nothing to replace. */
  | { kind: "stale" }
  /** The account already has a live paid subscription from the other store. */
  | { kind: "other_store_active" }
  /** The account already has a live subscription on this store, billed through a different reference. */
  | { kind: "already_subscribed" };

export interface StoreApplyInput {
  userId: string;
  source: StoreSource;
  /** The raw store reference this state belongs to (Google purchase token, Apple original transaction id). */
  storeRef: string;
  /** The reference this one replaced (Google linkedPurchaseToken), or null. */
  supersedesRef: string | null;
  status: DigitalEntitlementStatus;
  productId: string | null;
  billingOptionId: string | null;
  environment: "production" | "sandbox" | null;
  currentPeriodEnd: string | null;
  autoRenewing: boolean;
  revokedAt: string | null;
  actor: "user" | "provider" | "system";
}

const ENTITLING: ReadonlySet<DigitalEntitlementStatus> = new Set(["active", "canceled", "in_grace_period"]);

export type StoreConflictCode = "other_store_active" | "already_subscribed";

// Would an ENTITLING state for this reference be refused? Pure read, no write and no audit, so a caller can ask BEFORE it
// creates a purchase row (a refused claim must bind nothing and acknowledge nothing).
export function checkStoreConflict(args: { userId: string; source: StoreSource; storeRef: string; supersedesRef: string | null; entitling: boolean }): StoreConflictCode | null {
  if (!args.entitling) return null;
  const otherLive = liveStoreEntitlement(args.userId);
  if (otherLive && otherLive.source !== args.source) return "other_store_active";
  const existing = findDigitalEntitlement(args.userId, args.source);
  if (!existing || !isDigitalEntitlementLive(existing)) return null;
  const isCurrent = existing.storeRefHash === hashPurchaseToken(args.storeRef);
  const isSuccessor = !!args.supersedesRef && existing.storeRefHash === hashPurchaseToken(args.supersedesRef);
  return isCurrent || isSuccessor ? null : "already_subscribed";
}

export function applyStoreEntitlement(input: StoreApplyInput): StoreApplyOutcome {
  const { userId, source, storeRef, supersedesRef, actor } = input;
  const provider = source;
  const entitling = ENTITLING.has(input.status) && !input.revokedAt;
  const existing = findDigitalEntitlement(userId, source);

  const refHash = hashPurchaseToken(storeRef);
  const isCurrent = !!existing && existing.storeRefHash === refHash;
  const isSuccessor = !!existing && !!supersedesRef && existing.storeRefHash === hashPurchaseToken(supersedesRef);
  const existingLive = !!existing && isDigitalEntitlementLive(existing);

  const conflict = checkStoreConflict({ userId, source, storeRef, supersedesRef, entitling });
  if (conflict === "other_store_active") {
    // The other store holds a live paid subscription: an entitling state here is refused outright, whatever the reference.
    appendIapEvent({ provider, type: "claim_rejected_conflict", userId, purchaseToken: storeRef, actor, detail: { code: conflict } });
    return { kind: "other_store_active" };
  }
  if (conflict === "already_subscribed") {
    // A live subscription on this store billed through a DIFFERENT reference: a second purchase, or a stale notification.
    // Never overwritten. A user-initiated claim is told so; anything else is just stale.
    appendIapEvent({ provider, type: actor === "user" ? "claim_rejected_conflict" : "notification_stale", userId, purchaseToken: storeRef, actor, detail: { reason: "not_current_reference", status: input.status } });
    return actor === "user" ? { kind: "already_subscribed" } : { kind: "stale" };
  }
  if (existing && !isCurrent && !isSuccessor && !entitling) {
    // A non-entitling state for a reference the row does not follow has nothing to replace. History stays in the purchase record.
    appendIapEvent({ provider, type: "notification_stale", userId, purchaseToken: storeRef, actor, detail: { reason: "not_current_reference", status: input.status } });
    return { kind: "stale" };
  }

  const entitlement = writeStoreEntitlement({
    userId,
    source,
    status: input.status,
    productId: input.productId,
    billingOptionId: input.billingOptionId,
    storeRef,
    environment: input.environment,
    currentPeriodEnd: input.currentPeriodEnd,
    autoRenewing: input.autoRenewing,
    revokedAt: input.revokedAt,
  });

  const wasLive = existingLive && (isCurrent || isSuccessor);
  const nowLive = isDigitalEntitlementLive(entitlement);
  if (nowLive && !wasLive) {
    appendIapEvent({ provider, type: "entitlement_granted", userId, purchaseToken: storeRef, actor, detail: { status: input.status } });
  } else if (nowLive && existing?.status !== input.status) {
    appendIapEvent({ provider, type: "entitlement_updated", userId, purchaseToken: storeRef, actor, detail: { from: existing?.status ?? null, to: input.status } });
  } else if (!nowLive && wasLive) {
    appendIapEvent({ provider, type: input.revokedAt ? "entitlement_revoked" : "entitlement_expired", userId, purchaseToken: storeRef, actor, detail: { from: existing?.status ?? null, to: input.status } });
  }

  return { kind: "applied", status: input.status, entitlement };
}
