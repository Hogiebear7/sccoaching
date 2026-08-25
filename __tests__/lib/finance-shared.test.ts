import { describe, expect, it } from "vitest";

import {
  boundsForPreset,
  computeCashPosition,
  computeExceptionTotals,
  computeForecast,
  computeTotals,
  estimateStripeFeeCents,
  filterByRange,
  groupByExpenseType,
  groupByFeeType,
  groupByIncomeSource,
  groupByIncomeType,
  groupByPackage,
  periodBoundsForPreset,
  type FinanceLine,
} from "@/lib/finance-shared";

function line(overrides: Partial<FinanceLine> & Pick<FinanceLine, "kind">): FinanceLine {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    status: "cleared",
    date: "2026-08-10T12:00:00.000Z",
    currency: "eur",
    grossCents: 1000,
    feeCents: 0,
    netCents: 1000,
    incomeSource: null,
    incomeType: null,
    expenseType: null,
    feeType: null,
    memberId: null,
    packageName: null,
    reference: null,
    notes: null,
    ageBracket: "unknown",
    origin: "ledger",
    ...overrides,
  };
}

describe("computeTotals", () => {
  it("sums cleared income, expense, and fees separately", () => {
    const lines: FinanceLine[] = [
      line({ kind: "income", grossCents: 10000, feeCents: 300, netCents: 9700 }),
      line({ kind: "expense", grossCents: 2000 }),
      line({ kind: "fee", grossCents: 150, feeType: "other_fee" }),
    ];
    const totals = computeTotals(lines);
    expect(totals.moneyInCents).toBe(10000);
    expect(totals.moneyOutCents).toBe(2000);
    // 300 inline fee on the income line + 150 standalone fee line
    expect(totals.feesCents).toBe(450);
    expect(totals.netAfterFeesCents).toBe(10000 - 450 - 2000);
    expect(totals.clearedCount).toBe(3);
  });

  it("excludes non-cleared statuses from every total", () => {
    const lines: FinanceLine[] = [
      line({ kind: "income", grossCents: 5000, status: "pending" }),
      line({ kind: "income", grossCents: 4000, status: "refunded" }),
      line({ kind: "expense", grossCents: 1000, status: "estimate" }),
      line({ kind: "income", grossCents: 3000, status: "cleared" }),
    ];
    const totals = computeTotals(lines);
    expect(totals.moneyInCents).toBe(3000);
    expect(totals.moneyOutCents).toBe(0);
    expect(totals.clearedCount).toBe(1);
  });
});

describe("computeExceptionTotals", () => {
  it("buckets pending/refunded/failed/cancelled/disputed/estimate separately", () => {
    const lines: FinanceLine[] = [
      line({ kind: "income", grossCents: 100, status: "pending" }),
      line({ kind: "income", grossCents: 200, status: "refunded" }),
      line({ kind: "income", grossCents: 300, status: "failed" }),
      line({ kind: "income", grossCents: 400, status: "cancelled" }),
      line({ kind: "income", grossCents: 500, status: "disputed" }),
      line({ kind: "expense", grossCents: 600, status: "estimate" }),
      line({ kind: "income", grossCents: 700, status: "cleared" }),
    ];
    const ex = computeExceptionTotals(lines);
    expect(ex.pendingCents).toBe(100);
    expect(ex.refundedCents).toBe(200);
    // failed + cancelled + disputed all bucket into "failed"
    expect(ex.failedCents).toBe(300 + 400 + 500);
    expect(ex.failedCount).toBe(3);
    expect(ex.estimateCents).toBe(600);
  });
});

describe("computeForecast", () => {
  it("projects linearly from actual-so-far at a transparent run rate", () => {
    // A 30-day month, 10 days elapsed, €300 net so far -> €30/day -> €900 forecast.
    const start = new Date(2026, 0, 1);
    const end = new Date(2026, 0, 31); // 30 days
    const now = new Date(2026, 0, 10);
    const result = computeForecast(start, end, 30000, now);
    expect(result.daysInPeriod).toBe(30);
    expect(result.daysElapsed).toBe(9); // (Jan10 - Jan1) = 9 days elapsed
    expect(result.runRatePerDayCents).toBeCloseTo(30000 / 9);
    expect(result.forecastCents).toBe(Math.round((30000 / 9) * 30));
  });

  it("never divides by zero days elapsed", () => {
    const start = new Date(2026, 0, 1);
    const end = new Date(2026, 0, 31);
    const result = computeForecast(start, end, 5000, start);
    expect(Number.isFinite(result.runRatePerDayCents)).toBe(true);
    expect(result.daysElapsed).toBeGreaterThanOrEqual(1);
  });
});

describe("computeCashPosition", () => {
  it("adds cleared net movement since the anchor date to the anchor balance", () => {
    const lines: FinanceLine[] = [
      line({ kind: "income", date: "2026-08-05T00:00:00.000Z", grossCents: 5000, netCents: 4800 }),
      line({ kind: "expense", date: "2026-08-06T00:00:00.000Z", grossCents: 1000 }),
      // Before the anchor date — must not count.
      line({ kind: "income", date: "2026-07-01T00:00:00.000Z", grossCents: 9999, netCents: 9999 }),
      // Not cleared — must not count.
      line({ kind: "income", date: "2026-08-07T00:00:00.000Z", grossCents: 2000, status: "pending" }),
    ];
    const result = computeCashPosition(100000, "2026-08-01T00:00:00.000Z", lines, "2026-08-31T00:00:00.000Z");
    expect(result.movementCents).toBe(4800 - 1000);
    expect(result.currentCents).toBe(100000 + 4800 - 1000);
  });
});

describe("estimateStripeFeeCents", () => {
  it("applies percent + fixed-per-transaction against cleared income only", () => {
    const lines: FinanceLine[] = [
      line({ kind: "income", grossCents: 10000, status: "cleared" }),
      line({ kind: "income", grossCents: 5000, status: "cleared" }),
      line({ kind: "income", grossCents: 99999, status: "pending" }), // excluded
    ];
    // 1.5% + €0.25 (25 cents) per transaction over 2 cleared transactions.
    const estimate = estimateStripeFeeCents(lines, 1.5, 25);
    const expected = Math.round((10000 * 1.5) / 100 + 25 + (5000 * 1.5) / 100 + 25);
    expect(estimate).toBe(expected);
  });

  it("returns null when no rate is configured", () => {
    expect(estimateStripeFeeCents([], null, null)).toBeNull();
  });
});

describe("groupBy* helpers", () => {
  const lines: FinanceLine[] = [
    line({ kind: "income", incomeSource: "stripe", incomeType: "tier1_membership", packageName: "Unlimited", grossCents: 5000 }),
    line({ kind: "income", incomeSource: "stripe", incomeType: "tier1_membership", packageName: "Unlimited", grossCents: 3000 }),
    line({ kind: "income", incomeSource: "apple", incomeType: "tier2_app_subscription", packageName: "App Pro", grossCents: 900 }),
    line({ kind: "expense", expenseType: "payroll", grossCents: 20000 }),
    line({ kind: "expense", expenseType: "rent", grossCents: 8000 }),
    line({ kind: "fee", feeType: "stripe_fee", grossCents: 250 }),
    line({ kind: "income", incomeSource: "stripe", grossCents: 100, feeCents: 30 }), // inline fee
  ];

  it("groupByIncomeSource sums and sorts descending", () => {
    const rows = groupByIncomeSource(lines);
    expect(rows[0]).toMatchObject({ label: "stripe", amountCents: 5000 + 3000 + 100 });
    expect(rows.find((r) => r.label === "apple")).toMatchObject({ amountCents: 900 });
  });

  it("groupByIncomeType separates tier1 from tier2", () => {
    const rows = groupByIncomeType(lines);
    expect(rows.find((r) => r.label === "tier1_membership")?.amountCents).toBe(8000);
    expect(rows.find((r) => r.label === "tier2_app_subscription")?.amountCents).toBe(900);
  });

  it("groupByPackage only counts income lines", () => {
    const rows = groupByPackage(lines);
    expect(rows.find((r) => r.label === "Unlimited")?.amountCents).toBe(8000);
    expect(rows.find((r) => r.label === "App Pro")?.amountCents).toBe(900);
  });

  it("groupByExpenseType only counts expense lines", () => {
    const rows = groupByExpenseType(lines);
    expect(rows).toEqual([
      { label: "payroll", amountCents: 20000, count: 1 },
      { label: "rent", amountCents: 8000, count: 1 },
    ]);
  });

  it("groupByFeeType includes standalone fee lines and inline income fees", () => {
    const rows = groupByFeeType(lines);
    expect(rows.find((r) => r.label === "stripe_fee")?.amountCents).toBe(250);
    expect(rows.some((r) => r.label.startsWith("Inline fee"))).toBe(true);
  });
});

describe("filterByRange", () => {
  const lines: FinanceLine[] = [
    line({ kind: "income", id: "a", date: "2026-08-01T00:00:00.000Z" }),
    line({ kind: "income", id: "b", date: "2026-08-15T00:00:00.000Z" }),
    line({ kind: "income", id: "c", date: "2026-09-01T00:00:00.000Z" }),
  ];

  it("is inclusive of from and exclusive of to", () => {
    const result = filterByRange(lines, "2026-08-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z");
    expect(result.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("null bounds mean no limit on that side", () => {
    expect(filterByRange(lines, null, null)).toHaveLength(3);
  });
});

describe("boundsForPreset / periodBoundsForPreset", () => {
  it("this_quarter bounds span exactly the current 3-month quarter", () => {
    const now = new Date(2026, 7, 20); // August -> Q3 (Jul-Sep)
    const [fromISO, toISO] = boundsForPreset("this_quarter", now);
    expect(new Date(fromISO!).getMonth()).toBe(6); // July
    expect(new Date(toISO!).getMonth()).toBe(9); // October (exclusive)
  });

  it("periodBoundsForPreset returns real Date objects for forecasting", () => {
    const now = new Date(2026, 7, 20);
    const [start, end] = periodBoundsForPreset("this_month", now);
    expect(start.getDate()).toBe(1);
    expect(end.getMonth()).toBe(8); // September 1st (exclusive end)
  });
});
