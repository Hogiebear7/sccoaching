// Pure presentation/derivation helpers for booking, eligibility, and
// date/time validation — kept separate from lib/scheduling.ts because that
// file reads server-only env vars and imports lib/db.ts (Node-only, uses
// fs), which would break client components that only need these.
import type { ClassCategory, MembershipPlanRecord, SubscriptionRecord } from "./db";

// Static fallback labels for the original 4 built-in categories. Kept as a
// last-resort safety net so any data created before the DB-backed category
// model still renders a human-readable label. New custom categories are
// handled by the deletedCategoryLabels tombstone map in lib/db.ts instead.
export const CLASS_CATEGORY_LABEL: Record<string, string> = {
  general: "General",
  strength: "Strength",
  cardio: "Cardio",
  mother_and_baby: "Mother & Baby",
};

// Legacy static list — kept for backward compat. Prefer fetching categories
// from the DB (findClassCategories) for any new UI that needs the full list.
export const CLASS_CATEGORY_OPTIONS: string[] = [
  "general",
  "strength",
  "cardio",
  "mother_and_baby",
];

// Safe label lookup for client components that receive categories as props.
// Resolution order: live DB category → deleted-category tombstone map →
// static legacy map → raw slug. Never throws or returns undefined.
export function classCategoryLabel(
  categories: { slug: string; name: string }[],
  slug: string,
  deletedLabels: Record<string, string> = {}
): string {
  const found = categories.find((c) => c.slug === slug);
  if (found) return found.name;
  if (deletedLabels[slug]) return deletedLabels[slug];
  return CLASS_CATEGORY_LABEL[slug] ?? slug;
}

export function combineDateAndTime(date: string, time: string): Date {
  return new Date(`${date}T${time}`);
}

// The one real enforcement point for "no past date/time" on the client —
// also called server-side. A client-side check is only ever a UX hint; the
// server route is what actually enforces this.
export function isFutureDateTime(date: string, time: string): boolean {
  const parsed = combineDateAndTime(date, time);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() > Date.now();
}

// Empty allowedCategories means the plan is unrestricted (see
// MembershipPlanRecord.allowedCategories).
export function isClassEligibleForPlan(
  category: ClassCategory,
  plan: Pick<MembershipPlanRecord, "allowedCategories">
): boolean {
  return plan.allowedCategories.length === 0 || plan.allowedCategories.includes(category);
}

// Sum of staff-granted extra class passes for the current billing period.
export function extraSessionsGranted(
  subscription: Pick<SubscriptionRecord, "extraSessionGrants">
): number {
  return subscription.extraSessionGrants.reduce((sum, grant) => sum + grant.amount, 0);
}

// null = unlimited. Never negative. Includes staff-granted extra passes so
// booking eligibility and every display agree on one number.
export function remainingSessions(
  plan: Pick<MembershipPlanRecord, "monthlySessionAllowance">,
  subscription: Pick<SubscriptionRecord, "sessionsUsedThisPeriod" | "extraSessionGrants">
): number | null {
  if (plan.monthlySessionAllowance === null) return null;
  return Math.max(
    0,
    plan.monthlySessionAllowance +
      extraSessionsGranted(subscription) -
      subscription.sessionsUsedThisPeriod
  );
}

// Full breakdown behind remainingSessions, for class-pass displays:
// included − used + extra = remaining. remaining === null means unlimited.
// overusedBy > 0 means usage exceeded included + extra (e.g. a plan's
// allowance was lowered mid-period) — remaining clamps to 0 so it can be
// shown calmly instead of as a negative balance.
export interface ClassPassBalance {
  allowance: number | null;
  used: number;
  extra: number;
  remaining: number | null;
  overusedBy: number;
}

export function classPassBalance(
  plan: Pick<MembershipPlanRecord, "monthlySessionAllowance">,
  subscription: Pick<SubscriptionRecord, "sessionsUsedThisPeriod" | "extraSessionGrants">
): ClassPassBalance {
  const used = subscription.sessionsUsedThisPeriod;
  const extra = extraSessionsGranted(subscription);
  if (plan.monthlySessionAllowance === null) {
    return { allowance: null, used, extra, remaining: null, overusedBy: 0 };
  }
  const raw = plan.monthlySessionAllowance + extra - used;
  return {
    allowance: plan.monthlySessionAllowance,
    used,
    extra,
    remaining: Math.max(0, raw),
    overusedBy: Math.max(0, -raw),
  };
}

export function formatRemainingSessions(remaining: number | null): string {
  if (remaining === null) return "Unlimited";
  return `${remaining} session${remaining === 1 ? "" : "s"} left`;
}

export function formatSessionAllowance(allowance: number | null): string {
  if (allowance === null) return "Unlimited";
  return `${allowance} session${allowance === 1 ? "" : "s"} / month`;
}
