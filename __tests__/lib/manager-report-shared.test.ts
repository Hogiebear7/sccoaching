// lib/manager-report-shared.ts: the pure calculations behind the weekly and monthly manager reports (periods, busiest hours, tax set aside, money and AI cost
// summaries, the rule-based "things to look at"). No datastore.
import { describe, expect, it } from "vitest";

import type { FinanceLine } from "@/lib/finance-shared";
import {
  buildAttention,
  busiestHours,
  effectiveTaxRate,
  inPeriod,
  percentChange,
  previousPeriod,
  reportPeriod,
  summarizeAiCost,
  summarizeMoney,
  taxSetAsideCents,
  type AppSection,
  type GymSection,
} from "@/lib/manager-report-shared";

describe("report periods (Irish calendar)", () => {
  it("weekly: the last completed Monday to Sunday", () => {
    // Wednesday 18 November 2026
    const p = reportPeriod("weekly", 0, new Date("2026-11-18T10:00:00Z"));
    expect(p.startDate).toBe("2026-11-09");
    expect(p.endDate).toBe("2026-11-16");
    expect(p.key).toBe("2026-11-09");
    expect(p.label).toBe("Mon 9 Nov to Sun 15 Nov 2026");
    // November is GMT, so Irish midnight is UTC midnight
    expect(p.startISO).toBe("2026-11-09T00:00:00.000Z");
    expect(p.endISO).toBe("2026-11-16T00:00:00.000Z");
  });

  it("weekly: on a Monday the week that just ended is reported, and offset goes further back", () => {
    const monday = reportPeriod("weekly", 0, new Date("2026-11-16T07:30:00Z"));
    expect(monday.startDate).toBe("2026-11-09");
    expect(reportPeriod("weekly", 1, new Date("2026-11-16T07:30:00Z")).startDate).toBe("2026-11-02");
  });

  it("weekly: in summer Irish midnight is an hour before UTC midnight", () => {
    const p = reportPeriod("weekly", 0, new Date("2026-07-15T10:00:00Z"));
    expect(p.startDate).toBe("2026-07-06");
    expect(p.startISO).toBe("2026-07-05T23:00:00.000Z");
    expect(p.endISO).toBe("2026-07-12T23:00:00.000Z");
  });

  it("monthly: the last completed calendar month, across a year boundary too", () => {
    const p = reportPeriod("monthly", 0, new Date("2026-11-18T10:00:00Z"));
    expect([p.startDate, p.endDate, p.key, p.label]).toEqual(["2026-10-01", "2026-11-01", "2026-10", "October 2026"]);
    const jan = reportPeriod("monthly", 0, new Date("2027-01-05T10:00:00Z"));
    expect([jan.startDate, jan.endDate]).toEqual(["2026-12-01", "2027-01-01"]);
    expect(reportPeriod("monthly", 2, new Date("2027-01-05T10:00:00Z")).startDate).toBe("2026-10-01");
  });

  it("the previous period lines up exactly before this one", () => {
    const w = reportPeriod("weekly", 0, new Date("2026-11-18T10:00:00Z"));
    expect(previousPeriod(w).endDate).toBe(w.startDate);
    expect(previousPeriod(w).startDate).toBe("2026-11-02");
    const m = reportPeriod("monthly", 0, new Date("2026-03-10T10:00:00Z"));
    expect(previousPeriod(m).startDate).toBe("2026-01-01");
    expect(previousPeriod(m).endDate).toBe("2026-02-01");
  });

  it("inPeriod treats the end as exclusive, for dates and timestamps", () => {
    const p = reportPeriod("weekly", 0, new Date("2026-11-18T10:00:00Z"));
    expect(inPeriod(p, "2026-11-09")).toBe(true);
    expect(inPeriod(p, "2026-11-15")).toBe(true);
    expect(inPeriod(p, "2026-11-16")).toBe(false);
    expect(inPeriod(p, "2026-11-15T23:59:59.000Z")).toBe(true);
    expect(inPeriod(p, "2026-11-16T00:00:00.000Z")).toBe(false);
    expect(inPeriod(p, null)).toBe(false);
  });
});

describe("small calculations", () => {
  it("percentChange is null with nothing to compare, otherwise a whole percent", () => {
    expect(percentChange(10, 8)).toBe(25);
    expect(percentChange(6, 8)).toBe(-25);
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(5, null)).toBeNull();
  });

  it("busiest hours sums bookings by start hour, most first, ties to the earlier hour", () => {
    const rows = [
      { startTime: "18:00", bookingCount: 10 },
      { startTime: "18:30", bookingCount: 5 },
      { startTime: "06:00", bookingCount: 15 },
      { startTime: "09:00", bookingCount: 7 },
      { startTime: "12:00", bookingCount: 0 },
    ];
    expect(busiestHours(rows, 3)).toEqual([
      { label: "06:00 to 07:00", bookings: 15 },
      { label: "18:00 to 19:00", bookings: 15 },
      { label: "09:00 to 10:00", bookings: 7 },
    ]);
  });

  it("tax set aside is the rate on the balance, never below zero, and null with no rate", () => {
    expect(taxSetAsideCents(100_000, 23)).toBe(23_000);
    expect(taxSetAsideCents(-5_000, 23)).toBe(0);
    expect(taxSetAsideCents(100_000, null)).toBeNull();
    expect(taxSetAsideCents(333, 23)).toBe(77);
  });

  it("the tax rate is the saved one, or the owner's 23% when nothing sensible is saved", () => {
    expect(effectiveTaxRate(20)).toBe(20);
    expect(effectiveTaxRate(0)).toBe(0);
    expect(effectiveTaxRate(null)).toBe(23);
    expect(effectiveTaxRate(undefined)).toBe(23);
    expect(effectiveTaxRate(140)).toBe(23);
  });
});

const line = (over: Partial<FinanceLine>): FinanceLine => ({
  id: "l",
  kind: "income",
  status: "cleared",
  date: "2026-11-10T12:00:00.000Z",
  currency: "eur",
  grossCents: 0,
  feeCents: 0,
  netCents: 0,
  incomeSource: "stripe",
  incomeType: "tier1_membership",
  expenseType: null,
  feeType: null,
  memberId: null,
  packageName: null,
  reference: null,
  notes: null,
  ageBracket: "unknown",
  origin: "ledger",
  ...over,
});

describe("summarizeMoney", () => {
  const period = reportPeriod("weekly", 0, new Date("2026-11-18T10:00:00Z"));
  it("adds up cleared income by type and source, takes off fees and expenses, and sets tax aside", () => {
    const lines = [
      line({ id: "a", grossCents: 10_000 }),
      line({ id: "b", grossCents: 4_000, incomeType: "class_pass" }),
      line({ id: "c", grossCents: 1_000, incomeSource: "manual_cash", incomeType: "misc_income" }),
      line({ id: "fee", kind: "fee", grossCents: 500, feeType: "stripe_fee", incomeSource: null, incomeType: null }),
      line({ id: "rent", kind: "expense", grossCents: 3_000, expenseType: "rent", incomeSource: null, incomeType: null }),
      // outside the period, pending, refunded and failed must not count as income
      line({ id: "old", grossCents: 99_999, date: "2026-10-01T12:00:00.000Z" }),
      line({ id: "pend", grossCents: 700, status: "pending" }),
      line({ id: "ref", grossCents: 800, status: "refunded" }),
      line({ id: "fail", grossCents: 900, status: "failed" }),
    ];
    const m = summarizeMoney(lines, period, 23);
    expect(m.incomeCents).toBe(15_000);
    expect(m.feesCents).toBe(500);
    expect(m.expensesCents).toBe(3_000);
    expect(m.balanceCents).toBe(11_500);
    expect(m.taxSetAsideCents).toBe(Math.round(11_500 * 0.23));
    expect(m.byType.find((r) => r.label === "Class pass")?.amountCents).toBe(4_000);
    expect(m.bySource.find((r) => r.label === "Stripe")?.amountCents).toBe(14_000);
    expect(m.refundedCents).toBe(800);
    expect(m.failedCents).toBe(900);
    expect(m.pendingCents).toBe(700);
    expect(m.incomeLineCount).toBe(3);
  });

  it("reports an empty period as zero, with no income lines", () => {
    const m = summarizeMoney([], period, 23);
    expect([m.incomeCents, m.balanceCents, m.taxSetAsideCents, m.incomeLineCount]).toEqual([0, 0, 0, 0]);
  });
});

describe("summarizeAiCost", () => {
  it("totals in euro and averages per call and per user", () => {
    const s = summarizeAiCost([
      { userId: "a", costUsd: 1 },
      { userId: "a", costUsd: 1 },
      { userId: "b", costUsd: 2 },
    ]);
    // 4 USD at the 0.86 display rate
    expect(s.costEur).toBe(3.44);
    expect(s.calls).toBe(3);
    expect(s.users).toBe(2);
    expect(s.avgPerCallEur).toBe(1.15);
    expect(s.avgPerUserEur).toBe(1.72);
  });
  it("has no averages when nothing was used", () => {
    const s = summarizeAiCost([]);
    expect([s.costEur, s.avgPerCallEur, s.avgPerUserEur]).toEqual([0, null, null]);
  });
});

describe("buildAttention", () => {
  const gym = (over: { quiet?: number; bookingsChange?: number | null; noShows?: number; total?: number; lost?: number; signups?: number }): GymSection => ({
    bookings: {
      total: over.total ?? 100,
      attended: 80,
      noShows: over.noShows ?? 2,
      classes: 10,
      fillRate: 0.6,
      byType: [],
      busiestHours: [],
      comparison: { previous: 100, changePercent: over.bookingsChange ?? 0 },
    },
    members: {
      total: 50,
      current: 40,
      paused: 2,
      passHolders: 5,
      newSignups: over.signups ?? 3,
      newSignupsComparison: { previous: 3, changePercent: 0 },
      passesBought: 1,
      lost: over.lost ?? 1,
      lostComparison: { previous: 1, changePercent: 0 },
      quiet: over.quiet ?? 0,
      quietNames: [],
    },
  });

  it("says nothing when nothing crosses a threshold", () => {
    expect(buildAttention({ cadence: "weekly", gym: gym({}), money: null, app: null })).toEqual([]);
  });

  it("flags quiet members, a 20% fall in bookings, a high no-show rate and more leavers than joiners", () => {
    const text = buildAttention({ cadence: "weekly", gym: gym({ quiet: 4, bookingsChange: -25, noShows: 20, total: 100, lost: 5, signups: 2 }), money: null, app: null }).map((a) => a.text);
    expect(text.some((t) => t.startsWith("4 current members have not trained"))).toBe(true);
    expect(text.some((t) => t.includes("down 25%"))).toBe(true);
    expect(text.some((t) => t.includes("20 no-shows out of 100"))).toBe(true);
    expect(text.some((t) => t.includes("More memberships ended (5) than started (2)"))).toBe(true);
  });

  it("the monthly report asks for the app download numbers until both are entered; a weekly one does not", () => {
    const app = (downloads: { appStore: number | null; googlePlay: number | null; month: string | null }) =>
      ({ money: { incomeLineCount: 1 }, downloads }) as unknown as AppSection;
    const prompt = (a: AppSection, cadence: "weekly" | "monthly") => buildAttention({ cadence, gym: gym({}), money: null, app: a }).filter((x) => x.text.startsWith("Enter last month's app downloads"));
    expect(prompt(app({ appStore: null, googlePlay: null, month: "2026-10" }), "monthly")).toHaveLength(1);
    expect(prompt(app({ appStore: 120, googlePlay: null, month: "2026-10" }), "monthly")).toHaveLength(1);
    expect(prompt(app({ appStore: 120, googlePlay: 95, month: "2026-10" }), "monthly")).toHaveLength(0);
    expect(prompt(app({ appStore: null, googlePlay: null, month: null }), "weekly")).toHaveLength(0);
  });
});
