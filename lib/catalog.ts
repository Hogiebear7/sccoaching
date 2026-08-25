import type {
  AccessType,
  BillingChannel,
  DeliveryChannel,
  MembershipBillingOptionRecord,
  MembershipCategoryRecord,
  MembershipPackageRecord,
} from "./db";

// Shared, pure catalog helpers (no db reads) — safe to import from client
// components and API routes alike.

// Value lists for the channel/tier classification fields on
// MembershipPackageRecord. Deliberately duplicated here (not re-exported
// from lib/db.ts as values) — lib/db.ts imports Node's `fs` and must never
// be imported for its VALUE exports from a "use client" component; only
// `import type` from it is safe there. lib/db.ts remains the source of
// truth for the TYPES (DeliveryChannel/BillingChannel/AccessType).
export const DELIVERY_CHANNEL_OPTIONS: DeliveryChannel[] = ["in_person", "hybrid", "app_only"];
export const BILLING_CHANNEL_OPTIONS: BillingChannel[] = ["stripe_web", "apple_iap", "google_play", "manual"];
export const ACCESS_TYPE_OPTIONS: AccessType[] = ["membership", "pass", "subscription", "add_on"];

export const DELIVERY_CHANNEL_LABEL: Record<DeliveryChannel, string> = {
  in_person: "In-person",
  hybrid: "Hybrid",
  app_only: "App-only",
};
export const BILLING_CHANNEL_LABEL: Record<BillingChannel, string> = {
  stripe_web: "Stripe (website)",
  apple_iap: "Apple In-App Purchase",
  google_play: "Google Play Billing",
  manual: "Manual / other",
};
export const ACCESS_TYPE_LABEL: Record<AccessType, string> = {
  membership: "Membership",
  pass: "Pass",
  subscription: "Subscription",
  add_on: "Add-on",
};

export function slugifyCatalog(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// A category's "from €X" headline. Prefers the cheapest VISIBLE RECURRING
// option (a membership price) across its visible packages, so a cheap one-off
// pass never undercuts the headline. Falls back to the cheapest visible
// one-time option only when the category has no recurring options at all.
// Returns the billing type too so the card can label a one-off price.
export function categoryFromPrice(
  category: MembershipCategoryRecord,
  packages: MembershipPackageRecord[],
  options: MembershipBillingOptionRecord[]
): { amountCents: number; billingType: MembershipBillingOptionRecord["billingType"] } | null {
  const visiblePackageIds = new Set(
    packages.filter((p) => p.categoryId === category.id && p.visible).map((p) => p.id)
  );
  const visibleOptions = options.filter((o) => o.visible && visiblePackageIds.has(o.packageId));
  if (visibleOptions.length === 0) return null;

  const recurring = visibleOptions.filter((o) => o.billingType === "recurring");
  const pool = recurring.length > 0 ? recurring : visibleOptions;
  const cheapest = pool.reduce((min, o) => (o.amountCents < min.amountCents ? o : min), pool[0]);
  return { amountCents: cheapest.amountCents, billingType: cheapest.billingType };
}

// The per-price suffix on the member option row: "/ month", "/ quarter",
// "/ year", or "" for a one-off (which reads as a single price, no cadence).
export function formatBillingOptionCadence(option: MembershipBillingOptionRecord): string {
  if (option.billingType === "one_time") return "";
  const unit = option.intervalUnit === "year" ? "year" : "month";
  const count = option.intervalCount ?? 1;
  if (unit === "month" && count === 1) return "/ month";
  if (unit === "month" && count === 3) return "/ quarter";
  if (unit === "year" && count === 1) return "/ year";
  return `/ ${count} ${unit}${count === 1 ? "" : "s"}`;
}

// Member-facing name for a billing option — plain English, no "billing" or
// Stripe jargon. Recurring reads as a membership; one-time reads as a one-off.
export function memberBillingLabel(option: MembershipBillingOptionRecord): string {
  if (option.billingType === "one_time") return "One-off purchase";
  if (option.intervalUnit === "year") return "Annual membership";
  if (option.intervalUnit === "month" && option.intervalCount === 3) return "Quarterly membership";
  return "Monthly membership";
}

// One-line "how it renews" reassurance under a recurring option; empty for
// one-off purchases (nothing renews).
export function memberBillingHint(option: MembershipBillingOptionRecord): string {
  if (option.billingType === "one_time") return "One-time payment — nothing renews.";
  const every =
    option.intervalUnit === "year"
      ? "year"
      : option.intervalCount === 3
        ? "3 months"
        : "month";
  return `Renews automatically every ${every}. Cancel anytime.`;
}

export function describePackageAllowance(pkg: MembershipPackageRecord): string {
  if (pkg.sessionAllowanceType === "unlimited") return "Unlimited sessions";
  if (pkg.sessionAllowanceType === "single_use") return "Single class pass";
  const n = pkg.sessionAllowanceCount ?? 0;
  return `${n} session${n === 1 ? "" : "s"}`;
}
