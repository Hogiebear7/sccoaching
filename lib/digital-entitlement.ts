// Pure rules for "is this digital entitlement row granting access right now?", and the one writer that turns a verified
// store state into a row. The datastore holds one DigitalEntitlementRecord per (user, source) (lib/db.ts).
//
// Why a row's `status` is never read on its own: a store subscription row says "active" until a notification or a
// reconciliation pass moves it. If the notification is lost, access must still end at the paid expiry rather than depend on
// it. So liveness is always status AND the paid-through time, evaluated at the moment of the question.

import {
  appendIapEvent,
  digitalEntitlementId,
  findDigitalEntitlement,
  findDigitalEntitlementsByUserId,
  hashPurchaseToken,
  saveDigitalEntitlement,
  type DigitalEntitlementRecord,
  type DigitalEntitlementSource,
  type DigitalEntitlementStatus,
} from "@/lib/db";

// Renewal and the notification that records it are separate events, so the clock is allowed a small margin before an
// "active" store row is treated as ended. This is a tolerance for event ordering, not a grace period: a lapsed row never
// regains access by waiting.
export const STORE_EXPIRY_TOLERANCE_MS = 10 * 60 * 1000;

// A store-reported grace period (the store is retrying a failed payment and says access continues) is honoured, but never
// for longer than this past the last paid-through time. Apple's longest grace period is 16 days and Google's is 30; the cap
// is the larger, so a lost "grace ended" notification cannot leave access open indefinitely.
export const STORE_GRACE_ACCESS_CAP_MS = 30 * 24 * 60 * 60 * 1000;

export function isDigitalEntitlementLive(
  row: Pick<DigitalEntitlementRecord, "source" | "status" | "currentPeriodEnd" | "revokedAt">,
  nowMs: number = Date.now()
): boolean {
  if (row.revokedAt) return false;
  const end = row.currentPeriodEnd ? new Date(row.currentPeriodEnd).getTime() : null;
  if (end !== null && Number.isNaN(end)) return false;

  if (row.source === "staff_grant") {
    // A complimentary grant runs until it is withdrawn, or until its optional end date.
    return row.status === "active" && (end === null || end > nowMs);
  }

  switch (row.status) {
    case "active":
    case "canceled": // will not renew, but the paid period continues
      return end !== null && end + STORE_EXPIRY_TOLERANCE_MS > nowMs;
    case "in_grace_period":
      return end !== null && end + STORE_GRACE_ACCESS_CAP_MS > nowMs;
    default:
      // on_hold, paused, expired, revoked: no access.
      return false;
  }
}

export function liveDigitalEntitlements(rows: readonly DigitalEntitlementRecord[], nowMs: number = Date.now()): DigitalEntitlementRecord[] {
  return rows.filter((r) => isDigitalEntitlementLive(r, nowMs));
}

export function hasLiveDigitalEntitlement(userId: string, nowMs: number = Date.now()): boolean {
  return liveDigitalEntitlements(findDigitalEntitlementsByUserId(userId), nowMs).length > 0;
}

// A live PAID store subscription (not a staff grant). Used for the one-paid-subscription-per-account rule.
export function liveStoreEntitlement(userId: string, nowMs: number = Date.now()): DigitalEntitlementRecord | undefined {
  return liveDigitalEntitlements(findDigitalEntitlementsByUserId(userId), nowMs).find((r) => r.source !== "staff_grant");
}

// What the member (and the mobile app) is told about their digital plan. Only fields a member may see: no store reference.
export interface DigitalPlanSummary {
  source: DigitalEntitlementSource;
  status: DigitalEntitlementStatus;
  /** Paid-through time (store) or optional end of a complimentary grant. */
  currentPeriodEnd: string | null;
  autoRenewing: boolean;
  environment: "production" | "sandbox" | null;
}

// The one live entitlement worth showing: a paid store subscription first (it is the one the member can manage in the
// store), then a complimentary grant. Null when nothing is live.
export function describeDigitalPlan(rows: readonly DigitalEntitlementRecord[], nowMs: number = Date.now()): DigitalPlanSummary | null {
  const live = liveDigitalEntitlements(rows, nowMs);
  const row = live.find((r) => r.source !== "staff_grant") ?? live[0];
  if (!row) return null;
  return { source: row.source, status: row.status, currentPeriodEnd: row.currentPeriodEnd, autoRenewing: row.autoRenewing, environment: row.environment };
}

export interface StoreEntitlementInput {
  userId: string;
  source: Exclude<DigitalEntitlementSource, "staff_grant">;
  status: DigitalEntitlementStatus;
  productId: string | null;
  billingOptionId: string | null;
  /** The raw store reference (Google purchase token, Apple original transaction id). Stored only as a hash. */
  storeRef: string;
  environment: "production" | "sandbox" | null;
  currentPeriodEnd: string | null;
  autoRenewing: boolean;
  revokedAt: string | null;
}

// Synchronous: writes the one row for (user, source). The caller has already decided this reference is the one the row may
// follow (current, or the direct successor of the current one).
export function writeStoreEntitlement(input: StoreEntitlementInput): DigitalEntitlementRecord {
  const existing = findDigitalEntitlement(input.userId, input.source);
  const now = new Date().toISOString();
  return saveDigitalEntitlement({
    id: digitalEntitlementId(input.source, input.userId),
    userId: input.userId,
    source: input.source,
    status: input.status,
    productId: input.productId,
    billingOptionId: input.billingOptionId,
    storeRefHash: hashPurchaseToken(input.storeRef),
    environment: input.environment,
    currentPeriodEnd: input.currentPeriodEnd,
    autoRenewing: input.autoRenewing,
    grantedByUserId: null,
    note: null,
    revokedAt: input.revokedAt,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

// A complimentary grant by staff (or an invite). Distinct from a paid entitlement everywhere it is shown: it has no store
// reference, no billing, and a named grantor. Idempotent: granting again updates the same row.
export function grantStaffDigitalEntitlement(args: {
  userId: string;
  grantedByUserId: string | null;
  note?: string | null;
  /** Optional end of the grant. Null means until withdrawn. */
  endsAt?: string | null;
}): DigitalEntitlementRecord {
  const existing = findDigitalEntitlement(args.userId, "staff_grant");
  const now = new Date().toISOString();
  const row = saveDigitalEntitlement({
    id: digitalEntitlementId("staff_grant", args.userId),
    userId: args.userId,
    source: "staff_grant",
    status: "active",
    productId: null,
    billingOptionId: null,
    storeRefHash: null,
    environment: null,
    currentPeriodEnd: args.endsAt ?? null,
    autoRenewing: false,
    grantedByUserId: args.grantedByUserId,
    note: args.note ? args.note.slice(0, 200) : null,
    revokedAt: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  appendIapEvent({ provider: "staff", type: "staff_grant_changed", userId: args.userId, actor: "staff", detail: { action: "grant" } });
  return row;
}

// Withdraws a complimentary grant. Never touches a paid store entitlement: that can only be ended in the store.
export function revokeStaffDigitalEntitlement(userId: string): boolean {
  const existing = findDigitalEntitlement(userId, "staff_grant");
  if (!existing || existing.status !== "active") return false;
  const now = new Date().toISOString();
  saveDigitalEntitlement({ ...existing, status: "revoked", revokedAt: now, updatedAt: now });
  appendIapEvent({ provider: "staff", type: "staff_grant_changed", userId, actor: "staff", detail: { action: "revoke" } });
  return true;
}
