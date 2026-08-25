// Pure finance-ledger helpers safe to import from client components — no
// dependency on lib/db.ts (which pulls in Node's `fs` and breaks the client
// bundle if imported transitively). Server-only aggregation that actually
// reads the datastore lives in lib/finance.ts, which imports from here.
//
// This is the "business finance ledger" — deliberately not framed as gross
// revenue reporting any more. Every FinanceLine below can represent income,
// an expense, or a fee, whether it came from the existing Stripe/Revolut
// webhook pipeline or a staff-entered finance-ledger row (see lib/db.ts
// FinanceLedgerEntryRecord). All the money-in/out/net/forecast/cash-position
// math here operates on that one unified shape.

import type {
  FinanceEntryStatus,
  FinanceExpenseType,
  FinanceFeeType,
  FinanceIncomeSource,
  FinanceIncomeType,
} from "@/lib/db";

// Value lists for the manual-entry form dropdowns. Duplicated from lib/db.ts
// rather than re-exported from it as values — lib/db.ts imports Node's `fs`
// and must never be imported for its VALUE exports from a "use client"
// component (see the identical note on lib/catalog.ts's channel/tier
// options). lib/db.ts remains the source of truth for the enum TYPES.
export const FINANCE_ENTRY_STATUS_OPTIONS: FinanceEntryStatus[] = [
  "pending",
  "cleared",
  "refunded",
  "disputed",
  "failed",
  "estimate",
];
export const FINANCE_INCOME_SOURCE_OPTIONS: FinanceIncomeSource[] = [
  "stripe",
  "apple",
  "google",
  "revolut",
  "manual_cash",
  "other",
];
export const FINANCE_INCOME_TYPE_OPTIONS: FinanceIncomeType[] = [
  "tier1_membership",
  "class_pass",
  "tier2_app_subscription",
  "misc_income",
];
export const FINANCE_EXPENSE_TYPE_OPTIONS: FinanceExpenseType[] = [
  "payroll",
  "contractor",
  "software",
  "rent",
  "utilities",
  "marketing",
  "tax",
  "misc",
];
export const FINANCE_FEE_TYPE_OPTIONS: FinanceFeeType[] = ["stripe_fee", "apple_fee", "google_fee", "tax_withheld", "other_fee"];

export const FINANCE_LINE_KIND_LABEL: Record<FinanceLineKind, string> = {
  income: "Income",
  expense: "Expense",
  fee: "Fee",
};

export const FINANCE_LINE_STATUS_LABEL: Record<FinanceLineStatus, string> = {
  pending: "Pending",
  cleared: "Cleared",
  refunded: "Refunded",
  disputed: "Disputed",
  failed: "Failed",
  estimate: "Estimate",
  cancelled: "Cancelled",
};

export const FINANCE_INCOME_SOURCE_LABEL: Record<FinanceIncomeSource, string> = {
  stripe: "Stripe",
  apple: "Apple",
  google: "Google",
  revolut: "Revolut",
  manual_cash: "Cash / manual",
  other: "Other",
};

export const FINANCE_INCOME_TYPE_LABEL: Record<FinanceIncomeType, string> = {
  tier1_membership: "Tier 1 membership",
  class_pass: "Class pass",
  tier2_app_subscription: "Tier 2 app subscription",
  misc_income: "Misc income",
};

export const FINANCE_EXPENSE_TYPE_LABEL: Record<FinanceExpenseType, string> = {
  payroll: "Payroll",
  contractor: "Contractor",
  software: "Software",
  rent: "Rent",
  utilities: "Utilities",
  marketing: "Marketing",
  tax: "Tax",
  misc: "Misc",
};

export const FINANCE_FEE_TYPE_LABEL: Record<FinanceFeeType, string> = {
  stripe_fee: "Stripe fee",
  apple_fee: "Apple fee",
  google_fee: "Google fee",
  tax_withheld: "Tax withheld",
  other_fee: "Other fee",
};

export type FinanceLineKind = "income" | "expense" | "fee";
// Broader than FinanceEntryStatus only by "cancelled" — PurchaseRecord has a
// cancelled status with no ledger equivalent, kept distinct from "failed" so
// an abandoned checkout doesn't read the same as a declined card.
export type FinanceLineStatus = FinanceEntryStatus | "cancelled";
// Only these statuses represent money that has actually moved — every
// total/breakdown/forecast/cash-position figure below sums exactly this set.
// Explicitly excludes "estimate" so a projected figure can never silently
// blend into an actual one.
const CLEARED_STATUSES: FinanceLineStatus[] = ["cleared"];

export interface FinanceLine {
  id: string;
  kind: FinanceLineKind;
  status: FinanceLineStatus;
  /** ISO date/timestamp this line is attributed to — the field every range
      filter, grouping, and forecast operates on. */
  date: string;
  currency: string;
  /** The headline amount for this line. */
  grossCents: number;
  /** Fee deducted from this line, if known at entry time. 0 if not
      applicable, or if the fee is tracked as its own separate "fee" line
      instead — see lib/db.ts FinanceLedgerEntryRecord. */
  feeCents: number;
  /** grossCents - feeCents for income; equals grossCents for expense/fee. */
  netCents: number;
  incomeSource: FinanceIncomeSource | null;
  incomeType: FinanceIncomeType | null;
  expenseType: FinanceExpenseType | null;
  feeType: FinanceFeeType | null;
  memberId: string | null;
  packageName: string | null;
  reference: string | null;
  notes: string | null;
  ageBracket: AgeBracket;
  /** Where this line actually came from — useful for the ledger table (e.g.
      only allow edit/delete on "ledger" rows, never on webhook-derived
      ones). */
  origin: "revenue_event" | "purchase" | "ledger";
}

function isCleared(line: FinanceLine): boolean {
  return CLEARED_STATUSES.includes(line.status);
}

// ─── Totals ─────────────────────────────────────────────────────────────

export interface FinanceTotals {
  moneyInCents: number; // gross income, cleared only
  moneyOutCents: number; // gross expenses, cleared only
  feesCents: number; // income-line inline fees + standalone fee lines, cleared only
  netAfterFeesCents: number; // moneyInCents - feesCents - moneyOutCents
  clearedCount: number;
}

export function computeTotals(lines: FinanceLine[]): FinanceTotals {
  let moneyInCents = 0;
  let moneyOutCents = 0;
  let feesCents = 0;
  let clearedCount = 0;

  for (const l of lines) {
    if (!isCleared(l)) continue;
    clearedCount += 1;
    if (l.kind === "income") {
      moneyInCents += l.grossCents;
      feesCents += l.feeCents;
    } else if (l.kind === "expense") {
      moneyOutCents += l.grossCents;
    } else if (l.kind === "fee") {
      feesCents += l.grossCents;
    }
  }

  return {
    moneyInCents,
    moneyOutCents,
    feesCents,
    netAfterFeesCents: moneyInCents - feesCents - moneyOutCents,
    clearedCount,
  };
}

// Not-yet-real buckets, shown separately from the totals above so nothing
// projected or unresolved is ever folded into an "actual" figure.
export interface FinanceExceptionTotals {
  pendingCents: number;
  pendingCount: number;
  refundedCents: number;
  refundedCount: number;
  failedCents: number;
  failedCount: number;
  estimateCents: number;
  estimateCount: number;
}

export function computeExceptionTotals(lines: FinanceLine[]): FinanceExceptionTotals {
  const result: FinanceExceptionTotals = {
    pendingCents: 0,
    pendingCount: 0,
    refundedCents: 0,
    refundedCount: 0,
    failedCents: 0,
    failedCount: 0,
    estimateCents: 0,
    estimateCount: 0,
  };
  for (const l of lines) {
    if (l.status === "pending") {
      result.pendingCents += l.grossCents;
      result.pendingCount += 1;
    } else if (l.status === "refunded") {
      result.refundedCents += l.grossCents;
      result.refundedCount += 1;
    } else if (l.status === "failed" || l.status === "cancelled" || l.status === "disputed") {
      result.failedCents += l.grossCents;
      result.failedCount += 1;
    } else if (l.status === "estimate") {
      result.estimateCents += l.grossCents;
      result.estimateCount += 1;
    }
  }
  return result;
}

// ─── Ranges ─────────────────────────────────────────────────────────────

export interface FinanceRangePreset {
  key: "this_month" | "last_month" | "this_quarter" | "this_year" | "all_time";
  label: string;
}

export const FINANCE_RANGE_PRESETS: FinanceRangePreset[] = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_quarter", label: "This quarter" },
  { key: "this_year", label: "This year" },
  { key: "all_time", label: "All time" },
];

function quarterStartMonth(month: number): number {
  return Math.floor(month / 3) * 3;
}

// Returns [fromISO, toISO) — toISO is exclusive. null bounds mean "no limit"
// on that side (used by all_time).
export function boundsForPreset(preset: FinanceRangePreset["key"], now = new Date()): [string | null, string | null] {
  const y = now.getFullYear();
  const m = now.getMonth();

  switch (preset) {
    case "this_month":
      return [new Date(y, m, 1).toISOString(), new Date(y, m + 1, 1).toISOString()];
    case "last_month":
      return [new Date(y, m - 1, 1).toISOString(), new Date(y, m, 1).toISOString()];
    case "this_quarter": {
      const qStart = quarterStartMonth(m);
      return [new Date(y, qStart, 1).toISOString(), new Date(y, qStart + 3, 1).toISOString()];
    }
    case "this_year":
      return [new Date(y, 0, 1).toISOString(), new Date(y + 1, 0, 1).toISOString()];
    case "all_time":
      return [null, null];
  }
}

// Period bounds as Date objects — used by computeForecast, which needs real
// start/end instants rather than the ISO-string bounds above.
export function periodBoundsForPreset(preset: "this_month" | "this_quarter" | "this_year", now = new Date()): [Date, Date] {
  const y = now.getFullYear();
  const m = now.getMonth();
  if (preset === "this_month") return [new Date(y, m, 1), new Date(y, m + 1, 1)];
  if (preset === "this_quarter") {
    const qStart = quarterStartMonth(m);
    return [new Date(y, qStart, 1), new Date(y, qStart + 3, 1)];
  }
  return [new Date(y, 0, 1), new Date(y + 1, 0, 1)];
}

export function filterByRange(lines: FinanceLine[], fromISO: string | null, toISO: string | null): FinanceLine[] {
  return lines.filter((l) => {
    if (fromISO && l.date < fromISO) return false;
    if (toISO && l.date >= toISO) return false;
    return true;
  });
}

// ─── Grouping ───────────────────────────────────────────────────────────

interface GroupRow {
  label: string;
  amountCents: number;
  count: number;
}

function groupBy(lines: FinanceLine[], keyOf: (l: FinanceLine) => string | null, fallbackLabel: string): GroupRow[] {
  const map = new Map<string, GroupRow>();
  for (const l of lines) {
    if (!isCleared(l)) continue;
    const label = keyOf(l) ?? fallbackLabel;
    const entry = map.get(label) ?? { label, amountCents: 0, count: 0 };
    entry.amountCents += l.grossCents;
    entry.count += 1;
    map.set(label, entry);
  }
  return [...map.values()].sort((a, b) => b.amountCents - a.amountCents);
}

export function groupByPackage(lines: FinanceLine[]): GroupRow[] {
  return groupBy(
    lines.filter((l) => l.kind === "income"),
    (l) => l.packageName,
    "Unknown package"
  );
}

export function groupByIncomeSource(lines: FinanceLine[]): GroupRow[] {
  return groupBy(
    lines.filter((l) => l.kind === "income"),
    (l) => l.incomeSource,
    "Other"
  );
}

export function groupByIncomeType(lines: FinanceLine[]): GroupRow[] {
  return groupBy(
    lines.filter((l) => l.kind === "income"),
    (l) => l.incomeType,
    "Misc income"
  );
}

export function groupByExpenseType(lines: FinanceLine[]): GroupRow[] {
  return groupBy(
    lines.filter((l) => l.kind === "expense"),
    (l) => l.expenseType,
    "Misc"
  );
}

export function groupByFeeType(lines: FinanceLine[]): GroupRow[] {
  const map = new Map<string, GroupRow>();
  for (const l of lines) {
    if (!isCleared(l)) continue;
    // Fees show up two ways: a standalone "fee" line, or inline feeCents on
    // an income line. Both count toward the same fee-type bucket.
    if (l.kind === "fee") {
      const label = l.feeType ?? "Other fee";
      const entry = map.get(label) ?? { label, amountCents: 0, count: 0 };
      entry.amountCents += l.grossCents;
      entry.count += 1;
      map.set(label, entry);
    } else if (l.kind === "income" && l.feeCents > 0) {
      const label = "Inline fee (" + (l.incomeSource ?? "unknown source") + ")";
      const entry = map.get(label) ?? { label, amountCents: 0, count: 0 };
      entry.amountCents += l.feeCents;
      entry.count += 1;
      map.set(label, entry);
    }
  }
  return [...map.values()].sort((a, b) => b.amountCents - a.amountCents);
}

// ─── Forecast — transparent linear run-rate, no black box ─────────────────
//
// forecast = (actual net so far ÷ days elapsed so far in the period) × total
// days in the period. That's the whole formula — shown verbatim in the UI
// next to the number, per the "no fake AI forecasting" requirement.

export interface ForecastResult {
  actualCents: number;
  daysElapsed: number;
  daysInPeriod: number;
  runRatePerDayCents: number;
  forecastCents: number;
}

export function computeForecast(periodStart: Date, periodEnd: Date, actualCents: number, now = new Date()): ForecastResult {
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysInPeriod = Math.max(1, Math.round((periodEnd.getTime() - periodStart.getTime()) / msPerDay));
  const elapsedMs = Math.min(now.getTime(), periodEnd.getTime()) - periodStart.getTime();
  const daysElapsed = Math.max(1, Math.ceil(elapsedMs / msPerDay));
  const runRatePerDayCents = actualCents / daysElapsed;
  const forecastCents = Math.round(runRatePerDayCents * daysInPeriod);
  return { actualCents, daysElapsed, daysInPeriod, runRatePerDayCents, forecastCents };
}

// ─── Cash position — app-calculated, never bank-synced ─────────────────
//
// currentCents = anchorCents + net(cleared lines dated on/after the anchor,
// up to now). Explicitly an estimate: if a transaction never made it into
// this ledger (a bank fee, an ATM withdrawal, anything outside Stripe/
// Revolut/manual entry), this figure won't reflect it. The UI must always
// label this as app-calculated, not a real balance.

export interface CashPositionResult {
  anchorCents: number;
  anchorDate: string;
  movementCents: number;
  currentCents: number;
}

export function computeCashPosition(
  anchorCents: number,
  anchorDateISO: string,
  lines: FinanceLine[],
  nowISO = new Date().toISOString()
): CashPositionResult {
  let movementCents = 0;
  for (const l of lines) {
    if (!isCleared(l)) continue;
    if (l.date < anchorDateISO || l.date > nowISO) continue;
    if (l.kind === "income") movementCents += l.netCents;
    else movementCents -= l.grossCents;
  }
  return { anchorCents, anchorDate: anchorDateISO, movementCents, currentCents: anchorCents + movementCents };
}

// ─── Stripe fee estimate — transparent formula, admin-configured rate ────
//
// Not synced from Stripe. lib/db.ts FinanceSettings carries a percent + a
// fixed per-transaction amount the admin_manager types in (Stripe's own
// published rate for their account) — this multiplies that against actual
// cleared Stripe income for the lines given.

export function estimateStripeFeeCents(
  stripeIncomeLines: FinanceLine[],
  stripeFeePercent: number | null,
  stripeFeeFixedCents: number | null
): number | null {
  if (stripeFeePercent === null && stripeFeeFixedCents === null) return null;
  const cleared = stripeIncomeLines.filter((l) => isCleared(l) && l.kind === "income");
  const pct = stripeFeePercent ?? 0;
  const fixed = stripeFeeFixedCents ?? 0;
  return Math.round(cleared.reduce((sum, l) => sum + (l.grossCents * pct) / 100 + fixed, 0));
}

// ─── Age brackets — shared by Finances (revenue cut) and Members (headcount
// cut). ─────────────────────────────────────────────────────────────────

export type AgeBracket = "under_18" | "18_24" | "25_34" | "35_44" | "45_54" | "55_64" | "65_plus" | "unknown";

export const AGE_BRACKETS: AgeBracket[] = [
  "under_18",
  "18_24",
  "25_34",
  "35_44",
  "45_54",
  "55_64",
  "65_plus",
  "unknown",
];

export const AGE_BRACKET_LABEL: Record<AgeBracket, string> = {
  under_18: "Under 18",
  "18_24": "18–24",
  "25_34": "25–34",
  "35_44": "35–44",
  "45_54": "45–54",
  "55_64": "55–64",
  "65_plus": "65+",
  unknown: "Unknown",
};

export function ageFromDateOfBirth(dateOfBirth: string | null | undefined, onDate = new Date()): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;

  let age = onDate.getFullYear() - dob.getFullYear();
  const monthDiff = onDate.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && onDate.getDate() < dob.getDate())) age -= 1;
  return age;
}

export function ageBracketForAge(age: number | null): AgeBracket {
  if (age === null) return "unknown";
  if (age < 18) return "under_18";
  if (age <= 24) return "18_24";
  if (age <= 34) return "25_34";
  if (age <= 44) return "35_44";
  if (age <= 54) return "45_54";
  if (age <= 64) return "55_64";
  return "65_plus";
}

export function groupByAgeBracket(
  lines: FinanceLine[]
): { bracket: AgeBracket; label: string; amountCents: number; count: number }[] {
  const map = new Map<AgeBracket, { amountCents: number; count: number }>();
  for (const l of lines) {
    if (!isCleared(l) || l.kind !== "income") continue;
    const entry = map.get(l.ageBracket) ?? { amountCents: 0, count: 0 };
    entry.amountCents += l.grossCents;
    entry.count += 1;
    map.set(l.ageBracket, entry);
  }
  return AGE_BRACKETS.filter((b) => map.has(b)).map((bracket) => ({
    bracket,
    label: AGE_BRACKET_LABEL[bracket],
    ...map.get(bracket)!,
  }));
}
