import type {
  MembershipBillingOptionRecord,
  MembershipCategoryRecord,
  MembershipPackageRecord,
} from "./db";

// Shared, pure catalog helpers (no db reads) — safe to import from client
// components and API routes alike.

export function slugifyCatalog(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// A category's "from €X" is the cheapest VISIBLE billing option across all
// its visible packages. Returns null when the category has nothing sellable.
export function categoryFromPriceCents(
  category: MembershipCategoryRecord,
  packages: MembershipPackageRecord[],
  options: MembershipBillingOptionRecord[]
): number | null {
  const visiblePackageIds = new Set(
    packages.filter((p) => p.categoryId === category.id && p.visible).map((p) => p.id)
  );
  const prices = options
    .filter((o) => o.visible && visiblePackageIds.has(o.packageId))
    .map((o) => o.amountCents);
  return prices.length > 0 ? Math.min(...prices) : null;
}

// "€250.00 / month", "€720.00 / 3 months", "€2,750.00 / year", "€30.00 one-time".
export function formatBillingOptionCadence(option: MembershipBillingOptionRecord): string {
  if (option.billingType === "one_time") return "one-time";
  const unit = option.intervalUnit === "year" ? "year" : "month";
  const count = option.intervalCount ?? 1;
  if (unit === "month" && count === 1) return "/ month";
  if (unit === "month" && count === 3) return "/ quarter";
  if (unit === "year" && count === 1) return "/ year";
  return `/ ${count} ${unit}${count === 1 ? "" : "s"}`;
}

export function describePackageAllowance(pkg: MembershipPackageRecord): string {
  if (pkg.sessionAllowanceType === "unlimited") return "Unlimited sessions";
  if (pkg.sessionAllowanceType === "single_use") return "Single class pass";
  const n = pkg.sessionAllowanceCount ?? 0;
  return `${n} session${n === 1 ? "" : "s"}`;
}
