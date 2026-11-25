// What a tenant (a gym on the platform) owes S&C for using it, and what happens when it is not paid.
//
// Owner decisions (2026-11-18, docs: multi-tenant-requirements-2026-11-18.md): tenants pay S&C for the platform like a gym membership. A missed payment gets a
// grace period; after that the tenant is LOCKED OUT. Nothing is ever deleted, and when they pay again everything is back as if nothing had happened.
//
// This file is only the rule (pure, no datastore, no clock of its own) so it can be tested exhaustively. The datastore lookup and the request-time check are
// in lib/tenant-lockout.ts. Nothing here takes money: S&C never holds tenant money, and the platform payment itself is a separate, later piece.
import type { GymRecord } from "./gyms-schema";

export type TenantAccessState = "active" | "grace" | "locked";

/** Days after the paid-through date before the lockout starts. A named default; the owner has not fixed the number yet, so it is also settable per gym. */
export const DEFAULT_TENANT_GRACE_DAYS = 14;
export const MAX_TENANT_GRACE_DAYS = 60;

export interface TenantAccess {
  state: TenantAccessState;
  /** The last paid day (YYYY-MM-DD), or null when the gym is not billed. */
  paidThrough: string | null;
  /** Only in "grace": the last day before the lockout starts. */
  graceEndsOn: string | null;
  /** Days of grace left, counting today (only in "grace"). */
  graceDaysLeft: number | null;
}

const DAY_MS = 86_400_000;

/** Today's date (YYYY-MM-DD, UTC) for a clock value. */
export function isoDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function dayNumber(iso: string): number {
  return Math.floor(new Date(`${iso}T00:00:00.000Z`).getTime() / DAY_MS);
}

export function addDays(iso: string, days: number): string {
  return new Date((dayNumber(iso) + days) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Whether a gym is active, in its grace period, or locked.
 *
 * A gym with no billing set up (the primary gym, a gym that has not been put on a plan yet) is always active: billing only ever restricts a gym that has
 * been explicitly put on it. `paidThrough` is the last day that is paid; the day after is the first day of grace.
 */
export function tenantAccess(gym: Pick<GymRecord, "platformBilling"> | undefined | null, now: Date): TenantAccess {
  const billing = gym?.platformBilling;
  if (!billing || !isIsoDay(billing.paidThrough)) {
    return { state: "active", paidThrough: null, graceEndsOn: null, graceDaysLeft: null };
  }
  const paidThrough = billing.paidThrough;
  const today = isoDay(now);
  if (today <= paidThrough) return { state: "active", paidThrough, graceEndsOn: null, graceDaysLeft: null };

  const graceDays = Math.max(0, Math.min(MAX_TENANT_GRACE_DAYS, Math.floor(billing.graceDays ?? DEFAULT_TENANT_GRACE_DAYS)));
  const graceEndsOn = addDays(paidThrough, graceDays);
  if (today <= graceEndsOn) {
    return { state: "grace", paidThrough, graceEndsOn, graceDaysLeft: dayNumber(graceEndsOn) - dayNumber(today) + 1 };
  }
  return { state: "locked", paidThrough, graceEndsOn, graceDaysLeft: null };
}
