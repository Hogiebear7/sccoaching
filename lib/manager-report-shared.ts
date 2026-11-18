// The weekly and monthly manager reports (docs/manager-reports-2026-11.md): types and the pure calculations behind them. No datastore access here, so every
// figure can be unit-tested and the same functions serve the staff page, the email and the tests. All the money arithmetic is plain code on cents; nothing here
// involves AI. The server-only builder that reads the datastore is lib/manager-report.ts.

import { classStartMs, gymLocalDateString } from "@/lib/class-time";
import {
  computeExceptionTotals,
  computeTotals,
  FINANCE_FEE_TYPE_LABEL,
  FINANCE_INCOME_SOURCE_LABEL,
  FINANCE_INCOME_TYPE_LABEL,
  groupByFeeType,
  groupByIncomeSource,
  groupByIncomeType,
  usdToEur,
  type FinanceLine,
} from "@/lib/finance-shared";
import type { ClassTypeReportRow } from "@/lib/reports-shared";

export type ReportCadence = "weekly" | "monthly";

export interface ReportPeriod {
  cadence: ReportCadence;
  /** Stable key: "2026-11-09" (the Monday) for a week, "2026-10" for a month. */
  key: string;
  label: string;
  /** First day, "YYYY-MM-DD" (Irish calendar). */
  startDate: string;
  /** Day after the last day (exclusive), "YYYY-MM-DD". */
  endDate: string;
  /** The same bounds as instants (Irish midnight), for timestamps. End is exclusive. */
  startISO: string;
  endISO: string;
}

const DAY_MS = 86_400_000;
const addDays = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const midnightISO = (date: string): string => new Date(classStartMs(date, "00:00")).toISOString();
const fmt = (date: string, opts: Intl.DateTimeFormatOptions): string => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IE", { ...opts, timeZone: "UTC" });
/** "Mon 9 Nov", with the year when asked ("Mon 9 Nov 2026"). */
const dayLabel = (date: string, withYear: boolean): string => `${fmt(date, { weekday: "short" })} ${fmt(date, { day: "numeric", month: "short" })}${withYear ? ` ${fmt(date, { year: "numeric" })}` : ""}`;

/** Monday of the week containing `date`. */
function mondayOf(date: string): string {
  const dow = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, -dow);
}

function makePeriod(cadence: ReportCadence, start: string, end: string): ReportPeriod {
  if (cadence === "weekly") {
    const lastDay = addDays(end, -1);
    return {
      cadence,
      key: start,
      label: `${dayLabel(start, false)} to ${dayLabel(lastDay, true)}`,
      startDate: start,
      endDate: end,
      startISO: midnightISO(start),
      endISO: midnightISO(end),
    };
  }
  return {
    cadence,
    key: start.slice(0, 7),
    label: fmt(start, { month: "long", year: "numeric" }),
    startDate: start,
    endDate: end,
    startISO: midnightISO(start),
    endISO: midnightISO(end),
  };
}

const monthStart = (y: number, monthIndex: number): string => new Date(Date.UTC(y, monthIndex, 1)).toISOString().slice(0, 10);

/**
 * The report period `offset` periods back from the last completed one (0 = the last completed week or month, 1 = the one before, ...), by the Irish calendar.
 * A week runs Monday to Sunday and a month is a calendar month.
 */
export function reportPeriod(cadence: ReportCadence, offset = 0, now: Date = new Date()): ReportPeriod {
  const today = gymLocalDateString(now);
  if (cadence === "weekly") {
    const end = addDays(mondayOf(today), -7 * offset);
    return makePeriod(cadence, addDays(end, -7), end);
  }
  const [y, m] = today.split("-").map(Number);
  return makePeriod(cadence, monthStart(y, m - 2 - offset), monthStart(y, m - 1 - offset));
}

/** The period just before `period`, of the same kind (for the comparison line). */
export function previousPeriod(period: ReportPeriod): ReportPeriod {
  if (period.cadence === "weekly") return makePeriod("weekly", addDays(period.startDate, -7), period.startDate);
  const [y, m] = period.startDate.split("-").map(Number);
  return makePeriod("monthly", monthStart(y, m - 2), period.startDate);
}

/** True when `isoOrDate` (a timestamp or a "YYYY-MM-DD") falls inside the period. */
export function inPeriod(period: ReportPeriod, isoOrDate: string | null | undefined): boolean {
  if (!isoOrDate) return false;
  if (isoOrDate.length === 10) return isoOrDate >= period.startDate && isoOrDate < period.endDate;
  return isoOrDate >= period.startISO && isoOrDate < period.endISO;
}

// ── Pure calculations ──────────────────────────────────────────────────────

/** Percentage change from `previous` to `current`, whole percent; null when there is nothing to compare against. */
export function percentChange(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export interface BusyHour {
  /** "18:00 to 19:00" */
  label: string;
  bookings: number;
}

/** The busiest start hours by bookings, most first. Ties go to the earlier hour. */
export function busiestHours(rows: { startTime: string; bookingCount: number }[], top = 3): BusyHour[] {
  const byHour = new Map<number, number>();
  for (const r of rows) {
    const hour = Number(r.startTime.slice(0, 2));
    if (!Number.isFinite(hour)) continue;
    byHour.set(hour, (byHour.get(hour) ?? 0) + r.bookingCount);
  }
  return [...byHour.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, top)
    .map(([hour, bookings]) => ({ label: `${String(hour).padStart(2, "0")}:00 to ${String((hour + 1) % 24).padStart(2, "0")}:00`, bookings }));
}

/**
 * Tax set aside: the Finances tax rate applied to net income after fees, the same way Staff > Finances works it out (FinancesView), never below zero.
 * An estimate for planning, not tax advice. `ratePercent` null means no rate is set, so no figure.
 */
export function taxSetAsideCents(netAfterFeesCents: number, ratePercent: number | null): number | null {
  if (ratePercent === null || !Number.isFinite(ratePercent)) return null;
  return Math.max(0, Math.round((netAfterFeesCents * ratePercent) / 100));
}

/** The rate to use: the one saved in Staff > Finances > Settings, else the owner's 23%. */
export const DEFAULT_TAX_RATE_PERCENT = 23;
export function effectiveTaxRate(saved: number | null | undefined): number {
  return saved !== null && saved !== undefined && Number.isFinite(saved) && saved >= 0 && saved <= 100 ? saved : DEFAULT_TAX_RATE_PERCENT;
}

export interface MoneyRow {
  label: string;
  amountCents: number;
  count: number;
}

export interface MoneySummary {
  incomeCents: number;
  byType: MoneyRow[];
  bySource: MoneyRow[];
  feesCents: number;
  feesByType: MoneyRow[];
  expensesCents: number;
  /** Income minus fees minus expenses, cleared lines only. */
  balanceCents: number;
  taxRatePercent: number;
  taxSetAsideCents: number;
  /** Not counted above: pending, refunded, failed or disputed lines in the period. */
  refundedCents: number;
  refundedCount: number;
  failedCents: number;
  failedCount: number;
  pendingCents: number;
  pendingCount: number;
  /** Number of cleared income lines (0 means nothing was recorded for the period). */
  incomeLineCount: number;
}

// The finance groupers label rows with the raw stored value ("class_pass"); this turns them into the words staff see.
const relabel = (rows: MoneyRow[], labels: Record<string, string>): MoneyRow[] => rows.map((r) => ({ ...r, label: labels[r.label] ?? r.label }));

/** Money summary for the ledger lines that fall in `period` (callers pass the lines already narrowed to the right business). Pure. */
export function summarizeMoney(lines: FinanceLine[], period: ReportPeriod, taxRatePercent: number): MoneySummary {
  const inRange = lines.filter((l) => l.date >= period.startISO && l.date < period.endISO);
  const totals = computeTotals(inRange);
  const exceptions = computeExceptionTotals(inRange);
  const expenseLines = inRange.filter((l) => l.kind === "expense");
  const expensesCents = computeTotals(expenseLines).moneyOutCents;
  return {
    incomeCents: totals.moneyInCents,
    byType: relabel(groupByIncomeType(inRange), FINANCE_INCOME_TYPE_LABEL),
    bySource: relabel(groupByIncomeSource(inRange), FINANCE_INCOME_SOURCE_LABEL),
    feesCents: totals.feesCents,
    feesByType: relabel(groupByFeeType(inRange), FINANCE_FEE_TYPE_LABEL),
    expensesCents,
    balanceCents: totals.netAfterFeesCents,
    taxRatePercent,
    taxSetAsideCents: taxSetAsideCents(totals.netAfterFeesCents, taxRatePercent) ?? 0,
    refundedCents: exceptions.refundedCents,
    refundedCount: exceptions.refundedCount,
    failedCents: exceptions.failedCents,
    failedCount: exceptions.failedCount,
    pendingCents: exceptions.pendingCents,
    pendingCount: exceptions.pendingCount,
    incomeLineCount: inRange.filter((l) => l.kind === "income" && l.status === "cleared").length,
  };
}

export interface AiCostSummary {
  calls: number;
  /** Members (or other users) who made at least one call. */
  users: number;
  costEur: number;
  /** Per call, null when there were none. */
  avgPerCallEur: number | null;
  /** Per user who used AI, null when there were none. */
  avgPerUserEur: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Totals and averages for AI usage logs already narrowed to the right users and period. Pure. */
export function summarizeAiCost(logs: { userId: string | null; costUsd: number }[]): AiCostSummary {
  const users = new Set(logs.map((l) => l.userId).filter((u): u is string => !!u));
  const costEur = usdToEur(logs.reduce((sum, l) => sum + l.costUsd, 0));
  return {
    calls: logs.length,
    users: users.size,
    costEur: round2(costEur),
    avgPerCallEur: logs.length > 0 ? round2(costEur / logs.length) : null,
    avgPerUserEur: users.size > 0 ? round2(costEur / users.size) : null,
  };
}

// ── The report ─────────────────────────────────────────────────────────────

export interface Comparison {
  previous: number | null;
  changePercent: number | null;
}

export interface GymSection {
  bookings: {
    total: number;
    attended: number;
    noShows: number;
    classes: number;
    /** Attended divided by capacity, 0 to 1; null when no classes ran. */
    fillRate: number | null;
    byType: ClassTypeReportRow[];
    busiestHours: BusyHour[];
    comparison: Comparison;
  };
  members: {
    total: number;
    current: number;
    paused: number;
    passHolders: number;
    newSignups: number;
    newSignupsComparison: Comparison;
    passesBought: number;
    lost: number;
    lostComparison: Comparison;
    quiet: number;
    /** Up to five, longest absent first. Names stay in the staff page and out of the email. */
    quietNames: { name: string; daysSince: number | null }[];
  };
}

export interface GymMoneySection extends MoneySummary {
  ai: AiCostSummary;
  incomeComparison: Comparison;
}

export interface AppSection {
  totalUsers: number;
  subscribers: { appStore: number; googlePlay: number; complimentary: number; total: number };
  /** Plans first bought in the period, by plan name. */
  plansBought: { label: string; count: number }[];
  trialsStarted: number | null;
  trialsEndedWithoutConverting: number;
  money: MoneySummary;
  ai: AiCostSummary;
  /** Apple and Google download numbers for the month, as the owner typed them in (the stores do not report them to this system). Null when not entered, and
      always null in a weekly report. `month` is the calendar month the figures belong to ("2026-10"), null for weekly. */
  downloads: { appStore: number | null; googlePlay: number | null; month: string | null };
}

export interface PlatformGymRow {
  name: string;
  members: number;
  newSignups: number;
  bookings: number;
  classes: number;
}

export interface Attention {
  /** "info" is neutral, "watch" is worth a look. */
  level: "info" | "watch";
  text: string;
  href?: string;
}

export interface ManagerReport {
  cadence: ReportCadence;
  period: ReportPeriod;
  generatedAt: string;
  gymName: string;
  gym: GymSection;
  /** Platform owner only. */
  money: GymMoneySection | null;
  app: AppSection | null;
  platform: PlatformGymRow[] | null;
  attention: Attention[];
  /** What the report could not show, stated plainly. */
  notes: string[];
}

/** The rule-based "things to look at": no AI, just thresholds on the figures. */
export function buildAttention(input: {
  cadence: ReportCadence;
  gym: GymSection;
  money: GymMoneySection | null;
  app: AppSection | null;
}): Attention[] {
  const out: Attention[] = [];
  const { cadence, gym, money, app } = input;
  if (gym.members.quiet > 0) {
    out.push({ level: "watch", text: `${gym.members.quiet} current member${gym.members.quiet === 1 ? " has" : "s have"} not trained in 14 days or more.`, href: "/staff/attendance" });
  }
  const bookingsDrop = gym.bookings.comparison.changePercent;
  if (bookingsDrop !== null && bookingsDrop <= -20) {
    out.push({ level: "watch", text: `Class bookings are down ${Math.abs(bookingsDrop)}% on the previous period.`, href: "/staff/classes" });
  }
  const signupsDrop = gym.members.newSignupsComparison.changePercent;
  if (signupsDrop !== null && signupsDrop <= -20) {
    out.push({ level: "watch", text: `New sign-ups are down ${Math.abs(signupsDrop)}% on the previous period.`, href: "/staff/members" });
  }
  if (gym.bookings.total > 0 && gym.bookings.noShows / gym.bookings.total >= 0.15) {
    out.push({ level: "watch", text: `${gym.bookings.noShows} no-show${gym.bookings.noShows === 1 ? "" : "s"} out of ${gym.bookings.total} bookings (${Math.round((gym.bookings.noShows / gym.bookings.total) * 100)}%).`, href: "/staff/attendance" });
  }
  for (const t of gym.bookings.byType) {
    if (t.classCount >= 3 && t.capacityTotal > 0 && t.attendedCount / t.capacityTotal < 0.3) {
      out.push({ level: "info", text: `${t.label} classes were under 30% full (${t.attendedCount} attended across ${t.classCount} classes).`, href: "/staff/reports" });
    }
  }
  if (gym.members.lost > gym.members.newSignups && gym.members.lost > 0) {
    out.push({ level: "watch", text: `More memberships ended (${gym.members.lost}) than started (${gym.members.newSignups}).`, href: "/staff/members" });
  }
  if (money) {
    if (money.failedCount > 0) out.push({ level: "watch", text: `${money.failedCount} failed or disputed payment${money.failedCount === 1 ? "" : "s"} (€${(money.failedCents / 100).toFixed(2)}).`, href: "/staff/finances" });
    if (money.refundedCount > 0) out.push({ level: "info", text: `${money.refundedCount} refund${money.refundedCount === 1 ? "" : "s"} (€${(money.refundedCents / 100).toFixed(2)}).`, href: "/staff/finances" });
    if (money.pendingCount > 0) out.push({ level: "info", text: `${money.pendingCount} payment${money.pendingCount === 1 ? " is" : "s are"} still pending (€${(money.pendingCents / 100).toFixed(2)}).`, href: "/staff/finances" });
  }
  if (app && cadence === "monthly" && (app.downloads.appStore === null || app.downloads.googlePlay === null)) {
    out.push({
      level: "watch",
      text: "Enter last month's app downloads: App Store Connect (Analytics) for Apple, Google Play Console (Statistics) for Google. Type them in on the Briefings page.",
      href: "/staff/briefings?cadence=monthly#downloads",
    });
  }
  if (app && app.money.incomeLineCount === 0) {
    out.push({ level: "info", text: "No App Subscription income is recorded for this period. Enter the Apple and Google payouts in Staff > Finances.", href: "/staff/finances" });
  }
  return out;
}
