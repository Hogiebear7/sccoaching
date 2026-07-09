// Pure presentation/derivation helpers for subscription status — kept
// separate from lib/membership.ts because that file imports lib/db.ts
// (Node-only, uses fs), which would break client components that only
// need these.
import type { SubscriptionRecord, SubscriptionStatus } from "./db";

export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  inactive: "Pending billing setup",
  pending: "Awaiting payment",
  active: "Active",
  canceled: "Canceled",
  past_due: "Past due",
};

export const SUBSCRIPTION_STATUS_STYLE: Record<SubscriptionStatus, string> = {
  inactive: "bg-zinc-800 text-zinc-300",
  pending: "bg-amber-500/15 text-amber-300",
  active: "bg-emerald-500/15 text-emerald-300",
  canceled: "bg-zinc-800 text-zinc-400",
  past_due: "bg-red-500/15 text-red-300",
};

// True recurring auto-billing isn't implemented yet (see
// docs/billing-revolut.md) — a subscription's billing period has a real end
// date (currentPeriodEnd, set when the webhook marks it active) but nothing
// automatically charges the next period or flips status when it lapses.
// This computes the truth live instead of relying on a background job that
// doesn't exist, so the UI never claims access continues past a period a
// member never actually paid for again.
export function isPeriodLapsed(
  subscription: Pick<SubscriptionRecord, "status" | "currentPeriodEnd">
): boolean {
  if (subscription.status !== "active" || !subscription.currentPeriodEnd) return false;
  return new Date(subscription.currentPeriodEnd).getTime() < Date.now();
}

// Locale-default toLocaleDateString() can render "12/7/2026" — genuinely
// ambiguous between Dec 7 and Jul 12 depending on the reader's locale
// assumptions. Always show an unambiguous month name instead.
export function formatMembershipDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
