"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { formatPriceCents } from "@/lib/billing";
import type { FinanceSettings } from "@/lib/db";
import { formatMembershipDate } from "@/lib/membership-status";
import {
  FINANCE_ENTRY_STATUS_OPTIONS,
  FINANCE_EXPENSE_TYPE_LABEL,
  FINANCE_EXPENSE_TYPE_OPTIONS,
  FINANCE_FEE_TYPE_LABEL,
  FINANCE_FEE_TYPE_OPTIONS,
  FINANCE_INCOME_SOURCE_LABEL,
  FINANCE_INCOME_SOURCE_OPTIONS,
  FINANCE_INCOME_TYPE_LABEL,
  FINANCE_INCOME_TYPE_OPTIONS,
  FINANCE_LINE_KIND_LABEL,
  FINANCE_LINE_STATUS_LABEL,
  FINANCE_RANGE_PRESETS,
  boundsForPreset,
  computeCashPosition,
  computeExceptionTotals,
  computeForecast,
  computeTotals,
  estimateStripeFeeCents,
  filterByRange,
  groupByAgeBracket,
  groupByExpenseType,
  groupByFeeType,
  groupByIncomeSource,
  groupByIncomeType,
  groupByPackage,
  periodBoundsForPreset,
  type FinanceLine,
  type FinanceLineKind,
  type FinanceLineStatus,
  type FinanceRangePreset,
} from "@/lib/finance-shared";

const input =
  "rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15";
const fieldLabel = "mb-1 block text-xs font-medium text-muted-foreground";

async function post(url: string, body: unknown): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, message: data?.message ?? (res.ok ? "Saved." : "Something went wrong.") };
  } catch {
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

export function FinancesView({ lines, settings }: { lines: FinanceLine[]; settings: FinanceSettings }) {
  const [banner, setBanner] = useState<{ ok: boolean; message: string } | null>(null);

  async function run(fn: () => Promise<{ ok: boolean; message: string }>) {
    const r = await fn();
    setBanner(r);
    if (r.ok) window.location.reload();
  }

  // ── Always-current figures: MTD/QTD/YTD + forecasts + cash position.
  // Independent of the range picker below, which only scopes the
  // breakdowns and ledger table — these headline numbers always mean
  // "right now", so a staff member glancing at the top of the page never
  // has to check what range is selected first. ──────────────────────────
  const now = new Date();
  const [mtdFrom, mtdTo] = boundsForPreset("this_month", now);
  const [qtdFrom, qtdTo] = boundsForPreset("this_quarter", now);
  const [ytdFrom, ytdTo] = boundsForPreset("this_year", now);
  const mtdTotals = computeTotals(filterByRange(lines, mtdFrom, mtdTo));
  const qtdTotals = computeTotals(filterByRange(lines, qtdFrom, qtdTo));
  const ytdTotals = computeTotals(filterByRange(lines, ytdFrom, ytdTo));
  const [monthStart, monthEnd] = periodBoundsForPreset("this_month", now);
  const [quarterStart, quarterEnd] = periodBoundsForPreset("this_quarter", now);
  const [yearStart, yearEnd] = periodBoundsForPreset("this_year", now);
  const monthForecast = computeForecast(monthStart, monthEnd, mtdTotals.netAfterFeesCents, now);
  const quarterForecast = computeForecast(quarterStart, quarterEnd, qtdTotals.netAfterFeesCents, now);
  const yearForecast = computeForecast(yearStart, yearEnd, ytdTotals.netAfterFeesCents, now);

  const cashPosition =
    settings.cashPositionAnchorCents !== null && settings.cashPositionAnchorDate
      ? computeCashPosition(settings.cashPositionAnchorCents, settings.cashPositionAnchorDate, lines)
      : null;

  // ── Range-scoped breakdowns ─────────────────────────────────────────
  const [preset, setPreset] = useState<FinanceRangePreset["key"] | "custom">("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [rangeFromISO, rangeToISO] =
    preset === "custom"
      ? [customFrom ? new Date(customFrom).toISOString() : null, customTo ? new Date(`${customTo}T23:59:59.999`).toISOString() : null]
      : boundsForPreset(preset);

  const rangeLines = useMemo(() => filterByRange(lines, rangeFromISO, rangeToISO), [lines, rangeFromISO, rangeToISO]);
  const rangeTotals = computeTotals(rangeLines);
  const rangeExceptions = computeExceptionTotals(rangeLines);
  const byIncomeSource = useMemo(() => groupByIncomeSource(rangeLines), [rangeLines]);
  const byIncomeType = useMemo(() => groupByIncomeType(rangeLines), [rangeLines]);
  const byPackage = useMemo(() => groupByPackage(rangeLines), [rangeLines]);
  const byExpenseType = useMemo(() => groupByExpenseType(rangeLines), [rangeLines]);
  const byFeeType = useMemo(() => groupByFeeType(rangeLines), [rangeLines]);
  const byAge = useMemo(() => groupByAgeBracket(rangeLines), [rangeLines]);

  const payrollCents = byExpenseType.find((r) => r.label === "payroll")?.amountCents ?? 0;
  const businessExpenseCents = rangeTotals.moneyOutCents - payrollCents;
  const appOnlyIncomeCents = byIncomeType.find((r) => r.label === "tier2_app_subscription")?.amountCents ?? 0;
  const stripeIncomeLines = rangeLines.filter((l) => l.kind === "income" && l.incomeSource === "stripe");
  const stripeFeeEstimateCents = estimateStripeFeeCents(stripeIncomeLines, settings.stripeFeePercent, settings.stripeFeeFixedCents);
  const feesPctOfRevenue = rangeTotals.moneyInCents > 0 ? (rangeTotals.feesCents / rangeTotals.moneyInCents) * 100 : 0;
  const payrollPctOfRevenue = rangeTotals.moneyInCents > 0 ? (payrollCents / rangeTotals.moneyInCents) * 100 : 0;
  const recurringCents = rangeLines
    .filter((l) => l.kind === "income" && l.status === "cleared" && (l.incomeType === "tier1_membership" || l.incomeType === "tier2_app_subscription"))
    .reduce((sum, l) => sum + l.grossCents, 0);
  const oneOffCents = Math.max(0, rangeTotals.moneyInCents - recurringCents);

  const taxEstimateCents =
    settings.taxRatePercent !== null ? Math.round((rangeTotals.netAfterFeesCents * settings.taxRatePercent) / 100) : null;

  // ── Ledger / transactions table ─────────────────────────────────────
  const [kindFilter, setKindFilter] = useState<FinanceLineKind | "all">("all");
  const [statusFilter, setStatusFilter] = useState<FinanceLineStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [showAllRows, setShowAllRows] = useState(false);

  const ledgerFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rangeLines.filter((l) => {
      if (kindFilter !== "all" && l.kind !== kindFilter) return false;
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (!q) return true;
      const haystack = [l.packageName, l.notes, l.reference, l.incomeSource, l.incomeType, l.expenseType, l.feeType]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rangeLines, kindFilter, statusFilter, search]);

  const visibleRows = showAllRows ? ledgerFiltered : ledgerFiltered.slice(0, 25);

  // ── Manual entry ─────────────────────────────────────────────────────
  const [addKind, setAddKind] = useState<FinanceLineKind | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <p className="label-caps">Staff</p>
        <h2 className="text-display mt-1 text-[28px] leading-tight">Finances</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          The business finance ledger — money in, money out, fees, and what&apos;s actually left. Tier 1
          membership/class-pass income still flows in automatically from Stripe and Revolut; everything else
          (Apple/Google app income, expenses, fees) is entered below. New here? The numbers at the top always
          mean &quot;right now&quot; — the range picker further down only affects the breakdowns and the
          transaction list.
        </p>
      </div>

      {banner ? (
        <p
          className={`rounded-xl border px-4 py-3 text-sm ${
            banner.ok ? "border-primary/30 bg-primary/10 text-primary" : "border-destructive/30 bg-destructive/10 text-destructive"
          }`}
        >
          {banner.message}
        </p>
      ) : null}

      {/* ── Top summary strip ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryStat label="Money in (this month)" value={formatPriceCents(mtdTotals.moneyInCents)} detail="Cleared income, month to date." tone="positive" />
        <SummaryStat label="Money out (this month)" value={formatPriceCents(mtdTotals.moneyOutCents)} detail="Cleared expenses, month to date." tone="negative" />
        <SummaryStat label="Net after fees (this month)" value={formatPriceCents(mtdTotals.netAfterFeesCents)} detail="Money in − fees − money out." tone={mtdTotals.netAfterFeesCents >= 0 ? "positive" : "negative"} />
        <CashPositionCard cashPosition={cashPosition} />
      </div>

      {/* ── MTD / QTD / YTD ── */}
      <div className="grid gap-4 sm:grid-cols-3">
        <PeriodStat label="Month to date" totals={mtdTotals} />
        <PeriodStat label="Quarter to date" totals={qtdTotals} />
        <PeriodStat label="Year to date" totals={ytdTotals} />
      </div>

      {/* ── Forecast ── */}
      <div className="panel p-6">
        <h3 className="text-lg font-semibold">Forecast</h3>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          A simple run-rate projection, not a prediction model: (net so far ÷ days elapsed) × days in the
          period. Shown per card so you can see exactly how each number was reached.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <ForecastCard label="End of month" forecast={monthForecast} />
          <ForecastCard label="End of quarter" forecast={quarterForecast} />
          <ForecastCard label="End of year" forecast={yearForecast} />
        </div>
      </div>

      {/* ── Range picker ── */}
      <div className="panel flex flex-wrap items-center gap-2 p-4">
        <span className="mr-1 text-xs font-semibold text-muted-foreground">Breakdowns & ledger for:</span>
        {FINANCE_RANGE_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPreset(p.key)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              preset === p.key ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:border-primary hover:text-foreground"
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPreset("custom")}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
            preset === "custom" ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:border-primary hover:text-foreground"
          }`}
        >
          Custom range
        </button>
        {preset === "custom" ? (
          <div className="flex items-center gap-2">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} aria-label="From date" className={input} />
            <span className="text-xs text-muted-foreground">to</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} aria-label="To date" className={input} />
          </div>
        ) : null}
      </div>

      {/* ── Revenue breakdown ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <BreakdownPanel title="Revenue by source" rows={byIncomeSource} labelMap={FINANCE_INCOME_SOURCE_LABEL} emptyText="No income in this range." />
        <BreakdownPanel title="Revenue by product" rows={byIncomeType} labelMap={FINANCE_INCOME_TYPE_LABEL} emptyText="No income in this range." />
      </div>
      <div className="panel p-6">
        <h3 className="text-lg font-semibold">By package</h3>
        {byPackage.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No revenue in this range.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {byPackage.map((row) => (
              <Row key={row.label} label={row.label} count={row.count} amountCents={row.amountCents} />
            ))}
          </div>
        )}
      </div>

      {/* ── Expense breakdown ── */}
      <div className="panel p-6">
        <h3 className="text-lg font-semibold">Expenses by type</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <MiniStat label="Payroll" value={formatPriceCents(payrollCents)} />
          <MiniStat label="Business expenses (non-payroll)" value={formatPriceCents(businessExpenseCents)} />
          <MiniStat label="Payroll % of revenue" value={rangeTotals.moneyInCents > 0 ? `${payrollPctOfRevenue.toFixed(1)}%` : "—"} />
        </div>
        {byExpenseType.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No expenses logged in this range.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {byExpenseType.map((row) => (
              <Row key={row.label} label={FINANCE_EXPENSE_TYPE_LABEL[row.label as keyof typeof FINANCE_EXPENSE_TYPE_LABEL] ?? row.label} count={row.count} amountCents={row.amountCents} />
            ))}
          </div>
        )}
      </div>

      {/* ── Fees + tax ── */}
      <div className="panel p-6">
        <h3 className="text-lg font-semibold">Fees & tax</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <MiniStat label="Total fees" value={formatPriceCents(rangeTotals.feesCents)} />
          <MiniStat label="Fees % of revenue" value={rangeTotals.moneyInCents > 0 ? `${feesPctOfRevenue.toFixed(1)}%` : "—"} />
          <MiniStat label="App-only income (Tier 2)" value={formatPriceCents(appOnlyIncomeCents)} />
        </div>
        {byFeeType.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No fees logged in this range.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {byFeeType.map((row) => (
              <Row key={row.label} label={FINANCE_FEE_TYPE_LABEL[row.label as keyof typeof FINANCE_FEE_TYPE_LABEL] ?? row.label} count={row.count} amountCents={row.amountCents} />
            ))}
          </div>
        )}

        <div className="mt-5 rounded-xl border border-border/60 bg-white/[0.02] p-4">
          <p className="text-xs font-semibold text-foreground">Estimated Stripe fee</p>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            Not synced from Stripe — this app doesn&apos;t call the Stripe API for real per-transaction fees.
            Set your rate below (Stripe&apos;s own published rate for this account) and this multiplies it
            against actual cleared Stripe income in range.
          </p>
          <p className="mt-2 text-sm">
            {stripeFeeEstimateCents !== null ? (
              <>
                Estimated: <span className="font-semibold tabular-nums">{formatPriceCents(stripeFeeEstimateCents)}</span> across{" "}
                {stripeIncomeLines.length} Stripe payment{stripeIncomeLines.length === 1 ? "" : "s"} in range.
              </>
            ) : (
              <span className="text-muted-foreground">Set a rate in Settings below to see an estimate.</span>
            )}
          </p>
        </div>

        <div className="mt-4 rounded-xl border border-border/60 bg-white/[0.02] p-4">
          <p className="text-xs font-semibold text-foreground">Estimated tax</p>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            Not a filing figure. Multiplies net income (after expenses and fees) in range by the rate you set
            below — it doesn&apos;t know your business structure or VAT treatment. Get the real number from
            your accountant.
          </p>
          <p className="mt-2 text-sm">
            {taxEstimateCents !== null ? (
              <>
                Estimated at <span className="font-semibold">{settings.taxRatePercent}%</span> of net income in range:{" "}
                <span className="font-semibold tabular-nums">{formatPriceCents(taxEstimateCents)}</span>
              </>
            ) : (
              <span className="text-muted-foreground">Set a rate in Settings below to see an estimate.</span>
            )}
          </p>
        </div>
      </div>

      {/* ── Other metrics ── */}
      <div className="panel p-6">
        <h3 className="text-lg font-semibold">Other metrics</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MiniStat label="Recurring income" value={formatPriceCents(recurringCents)} />
          <MiniStat label="One-off income" value={formatPriceCents(oneOffCents)} />
          <MiniStat label="Refunds in range" value={`${formatPriceCents(rangeExceptions.refundedCents)} · ${rangeExceptions.refundedCount}`} />
          <MiniStat label="Failed / cancelled" value={`${formatPriceCents(rangeExceptions.failedCents)} · ${rangeExceptions.failedCount}`} />
          <MiniStat label="Pending / outstanding" value={`${formatPriceCents(rangeExceptions.pendingCents)} · ${rangeExceptions.pendingCount}`} />
        </div>
      </div>

      {/* ── By member age ── */}
      <div className="panel p-6">
        <h3 className="text-lg font-semibold">By member age</h3>
        <p className="mt-1 text-xs text-muted-foreground">Based on date of birth on file. Members without one are grouped under Unknown.</p>
        {byAge.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No revenue in this range.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {byAge.map((row) => (
              <Row key={row.bracket} label={row.label} count={row.count} amountCents={row.amountCents} />
            ))}
          </div>
        )}
      </div>

      {/* ── Manual entry ── */}
      <div className="panel p-6">
        <h3 className="text-lg font-semibold">Add an entry</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Log app-store income (Apple/Google), a business expense, payroll, or a fee. Stripe/Revolut membership
          and pass income keeps recording itself automatically — you don&apos;t need to add those here.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["income", "expense", "fee"] as FinanceLineKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setAddKind(addKind === k ? null : k)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                addKind === k ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:border-primary hover:text-foreground"
              }`}
            >
              + Add {FINANCE_LINE_KIND_LABEL[k].toLowerCase()}
            </button>
          ))}
        </div>
        {addKind ? (
          <div className="mt-4">
            <LedgerEntryForm
              kind={addKind}
              onSave={(payload) => run(() => post("/api/staff/finance/ledger", payload))}
              onDone={() => setAddKind(null)}
            />
          </div>
        ) : null}
      </div>

      {/* ── Ledger / transactions table ── */}
      <div className="panel p-6">
        <h3 className="text-lg font-semibold">Transactions</h3>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select className={`${input} w-32`} value={kindFilter} onChange={(e) => setKindFilter(e.target.value as FinanceLineKind | "all")}>
            <option value="all">All kinds</option>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
            <option value="fee">Fee</option>
          </select>
          <select className={`${input} w-36`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as FinanceLineStatus | "all")}>
            <option value="all">All statuses</option>
            {FINANCE_ENTRY_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{FINANCE_LINE_STATUS_LABEL[s]}</option>
            ))}
          </select>
          <input
            type="search"
            placeholder="Search notes, reference, package…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${input} min-w-[220px] flex-1`}
          />
        </div>

        {ledgerFiltered.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No transactions match these filters.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-border/60 text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Kind</th>
                  <th className="py-2 pr-3 font-medium">Detail</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 text-right font-medium">Gross</th>
                  <th className="py-2 pr-3 text-right font-medium">Fee</th>
                  <th className="py-2 pr-3 text-right font-medium">Net</th>
                  <th className="py-2 pr-3 font-medium">Notes / ref</th>
                  <th className="py-2 pr-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((l) => (
                  <LedgerRow key={l.id} line={l} onChanged={() => window.location.reload()} setBanner={setBanner} />
                ))}
              </tbody>
            </table>
            {!showAllRows && ledgerFiltered.length > 25 ? (
              <button type="button" onClick={() => setShowAllRows(true)} className="mt-3 text-xs font-semibold text-primary hover:underline">
                Show all {ledgerFiltered.length} transactions
              </button>
            ) : null}
          </div>
        )}
      </div>

      {/* ── Settings: cash position + fee/tax rates ── */}
      <SettingsPanel settings={settings} onSave={(payload) => run(() => post("/api/staff/settings/finance", payload))} />
    </div>
  );
}

// ── Small display primitives ──────────────────────────────────────────

function SummaryStat({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: "positive" | "negative" | "neutral" }) {
  const toneClass = tone === "positive" ? "text-primary" : tone === "negative" ? "text-destructive" : "text-foreground";
  return (
    <div className="panel rounded-3xl p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-3 text-display text-[28px] tabular-nums ${toneClass}`}>{value}</p>
      <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

function CashPositionCard({ cashPosition }: { cashPosition: ReturnType<typeof computeCashPosition> | null }) {
  if (!cashPosition) {
    return (
      <div className="panel rounded-3xl p-5">
        <p className="text-sm text-muted-foreground">Cash position (now)</p>
        <p className="mt-3 text-display text-[22px] leading-tight">Not set</p>
        <p className="mt-2 text-sm text-muted-foreground">Set an opening balance in Settings below to see this.</p>
      </div>
    );
  }
  return (
    <div className="panel rounded-3xl p-5">
      <p className="text-sm text-muted-foreground">Cash position (now)</p>
      <p className="mt-3 text-display text-[28px] tabular-nums">{formatPriceCents(cashPosition.currentCents)}</p>
      <p className="mt-2 text-sm text-muted-foreground">
        App-calculated, not bank-synced — {formatPriceCents(cashPosition.anchorCents)} as of{" "}
        {formatMembershipDate(cashPosition.anchorDate)} plus ledger movements since.
      </p>
    </div>
  );
}

function PeriodStat({ label, totals }: { label: string; totals: ReturnType<typeof computeTotals> }) {
  return (
    <div className="panel rounded-3xl p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-3 text-display text-[22px] tabular-nums">{formatPriceCents(totals.netAfterFeesCents)}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        {formatPriceCents(totals.moneyInCents)} in · {formatPriceCents(totals.feesCents)} fees · {formatPriceCents(totals.moneyOutCents)} out
      </p>
    </div>
  );
}

function ForecastCard({ label, forecast }: { label: string; forecast: ReturnType<typeof computeForecast> }) {
  return (
    <div className="well rounded-2xl p-4">
      <p className="text-sm font-medium">{label}</p>
      <p className="mt-2 text-display text-[20px] tabular-nums">{formatPriceCents(forecast.forecastCents)}</p>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        {formatPriceCents(forecast.actualCents)} net over {forecast.daysElapsed} day{forecast.daysElapsed === 1 ? "" : "s"} so far →{" "}
        {formatPriceCents(Math.round(forecast.runRatePerDayCents))}/day × {forecast.daysInPeriod} days.
      </p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="well rounded-xl p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Row({ label, count, amountCents }: { label: string; count: number; amountCents: number }) {
  return (
    <div className="well flex items-center justify-between gap-3 p-3">
      <div>
        <p className="text-sm font-medium capitalize">{label.replace(/_/g, " ")}</p>
        <p className="text-xs text-muted-foreground">{count} item{count === 1 ? "" : "s"}</p>
      </div>
      <p className="text-sm font-semibold tabular-nums">{formatPriceCents(amountCents)}</p>
    </div>
  );
}

function BreakdownPanel({
  title,
  rows,
  labelMap,
  emptyText,
}: {
  title: string;
  rows: { label: string; amountCents: number; count: number }[];
  labelMap: Record<string, string>;
  emptyText: string;
}) {
  return (
    <div className="panel p-6">
      <h3 className="text-lg font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="mt-4 space-y-2">
          {rows.map((row) => (
            <Row key={row.label} label={labelMap[row.label] ?? row.label} count={row.count} amountCents={row.amountCents} />
          ))}
        </div>
      )}
    </div>
  );
}

function KindBadge({ kind }: { kind: FinanceLineKind }) {
  const toneClass =
    kind === "income" ? "border-primary/30 bg-primary/10 text-primary" : kind === "expense" ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-gold/30 bg-gold/[0.08] text-gold";
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${toneClass}`}>{FINANCE_LINE_KIND_LABEL[kind]}</span>;
}

function StatusBadge({ status }: { status: FinanceLineStatus }) {
  const toneClass =
    status === "cleared"
      ? "text-primary"
      : status === "failed" || status === "cancelled" || status === "disputed"
        ? "text-destructive"
        : status === "refunded"
          ? "text-gold"
          : "text-muted-foreground";
  return <span className={`text-xs font-medium ${toneClass}`}>{FINANCE_LINE_STATUS_LABEL[status]}</span>;
}

function lineDetailLabel(l: FinanceLine): string {
  if (l.kind === "income") return l.incomeType ? FINANCE_INCOME_TYPE_LABEL[l.incomeType] : "Income";
  if (l.kind === "expense") return l.expenseType ? FINANCE_EXPENSE_TYPE_LABEL[l.expenseType] : "Expense";
  return l.feeType ? FINANCE_FEE_TYPE_LABEL[l.feeType] : "Fee";
}

function LedgerRow({
  line,
  onChanged,
  setBanner,
}: {
  line: FinanceLine;
  onChanged: () => void;
  setBanner: (b: { ok: boolean; message: string } | null) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const editable = line.origin === "ledger";

  async function handleDelete() {
    const r = await post("/api/staff/finance/ledger/delete", { id: line.id });
    setBanner(r);
    if (r.ok) onChanged();
  }

  async function handleSaveEdit(payload: Record<string, unknown>) {
    const r = await post("/api/staff/finance/ledger", payload);
    setBanner(r);
    if (r.ok) onChanged();
  }

  if (editing) {
    return (
      <tr className="border-b border-border/40">
        <td colSpan={9} className="py-3">
          <LedgerEntryForm kind={line.kind} initial={line} onSave={handleSaveEdit} onDone={() => setEditing(false)} />
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-border/40 align-top">
      <td className="py-2 pr-3 whitespace-nowrap text-xs text-muted-foreground">{formatMembershipDate(line.date)}</td>
      <td className="py-2 pr-3"><KindBadge kind={line.kind} /></td>
      <td className="py-2 pr-3">
        <p className="text-sm font-medium">{line.packageName ?? lineDetailLabel(line)}</p>
        <p className="text-xs text-muted-foreground">
          {lineDetailLabel(line)}
          {line.incomeSource ? ` · ${FINANCE_INCOME_SOURCE_LABEL[line.incomeSource]}` : ""}
        </p>
      </td>
      <td className="py-2 pr-3"><StatusBadge status={line.status} /></td>
      <td className="py-2 pr-3 text-right tabular-nums text-sm">{formatPriceCents(line.grossCents)}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-sm text-muted-foreground">{line.feeCents > 0 ? formatPriceCents(line.feeCents) : "—"}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-sm font-semibold">{formatPriceCents(line.netCents)}</td>
      <td className="py-2 pr-3 max-w-[220px] text-xs text-muted-foreground">
        {[line.notes, line.reference].filter(Boolean).join(" · ") || "—"}
      </td>
      <td className="py-2 pr-1 text-right">
        {editable ? (
          confirming ? (
            <span className="inline-flex gap-1">
              <button type="button" onClick={handleDelete} className="rounded-lg border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] font-semibold text-destructive hover:bg-destructive/20">
                Confirm
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="rounded-lg border border-border px-2 py-1 text-[11px] text-foreground hover:bg-accent">
                Cancel
              </button>
            </span>
          ) : (
            <span className="inline-flex gap-1">
              <button type="button" onClick={() => setEditing(true)} className="rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-accent">
                Edit
              </button>
              <button type="button" onClick={() => setConfirming(true)} className="rounded-lg border border-destructive/30 px-2 py-1 text-[11px] font-medium text-destructive hover:border-destructive/60">
                Delete
              </button>
            </span>
          )
        ) : (
          <span className="text-[10px] text-muted-foreground">auto</span>
        )}
      </td>
    </tr>
  );
}

// ── Manual entry form ────────────────────────────────────────────────

function Field({ label: l, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className={fieldLabel}>{l}</span>
      {children}
    </label>
  );
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function LedgerEntryForm({
  kind,
  initial,
  onSave,
  onDone,
}: {
  kind: FinanceLineKind;
  /** When set, prefills every field from an existing line and includes its
      id in the save payload — the same route handles create vs. update
      based on id presence, matching the catalog CRUD convention. */
  initial?: FinanceLine;
  onSave: (payload: Record<string, unknown>) => void;
  onDone: () => void;
}) {
  const [incomeSource, setIncomeSource] = useState(initial?.incomeSource ?? FINANCE_INCOME_SOURCE_OPTIONS[0]);
  const [incomeType, setIncomeType] = useState(initial?.incomeType ?? FINANCE_INCOME_TYPE_OPTIONS[0]);
  const [expenseType, setExpenseType] = useState(initial?.expenseType ?? FINANCE_EXPENSE_TYPE_OPTIONS[0]);
  const [feeType, setFeeType] = useState(initial?.feeType ?? FINANCE_FEE_TYPE_OPTIONS[0]);
  const [status, setStatus] = useState<FinanceLineStatus>(initial?.status ?? "cleared");
  const [date, setDate] = useState(initial ? initial.date.slice(0, 10) : todayDateString());
  const [amountEur, setAmountEur] = useState(initial ? (initial.grossCents / 100).toFixed(2) : "");
  const [feeEur, setFeeEur] = useState(initial && initial.feeCents > 0 ? (initial.feeCents / 100).toFixed(2) : "");
  const [reference, setReference] = useState(initial?.reference ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const grossAmountCents = Math.round(Number(amountEur) * 100);
        const feeAmountCents = feeEur.trim() ? Math.round(Number(feeEur) * 100) : 0;
        onSave({
          id: initial?.id,
          kind,
          incomeSource: kind === "income" ? incomeSource : undefined,
          incomeType: kind === "income" ? incomeType : undefined,
          expenseType: kind === "expense" ? expenseType : undefined,
          feeType: kind === "fee" ? feeType : undefined,
          status,
          date: new Date(`${date}T12:00:00.000Z`).toISOString(),
          currency: "eur",
          grossAmountCents,
          feeAmountCents,
          reference: reference.trim() || null,
          notes: notes.trim() || null,
        });
        onDone();
      }}
      className="rounded-2xl border border-border/60 bg-white/[0.02] p-4 space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {kind === "income" ? (
          <>
            <Field label="Source">
              <select className={input} value={incomeSource} onChange={(e) => setIncomeSource(e.target.value as typeof incomeSource)}>
                {FINANCE_INCOME_SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{FINANCE_INCOME_SOURCE_LABEL[s]}</option>)}
              </select>
            </Field>
            <Field label="Type">
              <select className={input} value={incomeType} onChange={(e) => setIncomeType(e.target.value as typeof incomeType)}>
                {FINANCE_INCOME_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{FINANCE_INCOME_TYPE_LABEL[t]}</option>)}
              </select>
            </Field>
          </>
        ) : null}
        {kind === "expense" ? (
          <Field label="Expense type">
            <select className={input} value={expenseType} onChange={(e) => setExpenseType(e.target.value as typeof expenseType)}>
              {FINANCE_EXPENSE_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{FINANCE_EXPENSE_TYPE_LABEL[t]}</option>)}
            </select>
          </Field>
        ) : null}
        {kind === "fee" ? (
          <Field label="Fee type">
            <select className={input} value={feeType} onChange={(e) => setFeeType(e.target.value as typeof feeType)}>
              {FINANCE_FEE_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{FINANCE_FEE_TYPE_LABEL[t]}</option>)}
            </select>
          </Field>
        ) : null}
        <Field label="Status">
          <select className={input} value={status} onChange={(e) => setStatus(e.target.value as FinanceLineStatus)}>
            {FINANCE_ENTRY_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{FINANCE_LINE_STATUS_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field label="Date">
          <input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={kind === "income" ? "Gross amount (€)" : "Amount (€)"}>
          <input type="number" min={0} step="0.01" required className={input} value={amountEur} onChange={(e) => setAmountEur(e.target.value)} placeholder="e.g. 49.99" />
        </Field>
        {kind === "income" ? (
          <Field label="Fee taken (€, optional)">
            <input type="number" min={0} step="0.01" className={input} value={feeEur} onChange={(e) => setFeeEur(e.target.value)} placeholder="e.g. 7.50" />
          </Field>
        ) : null}
        <Field label="Reference (optional)">
          <input className={input} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Invoice #, payout ID…" />
        </Field>
      </div>
      <Field label="Notes (optional)">
        <input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything worth remembering about this entry" />
      </Field>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary px-4 py-2 text-xs">
          {initial ? "Save changes" : `Save ${FINANCE_LINE_KIND_LABEL[kind].toLowerCase()}`}
        </button>
        <button type="button" onClick={onDone} className="rounded-lg border border-border px-4 py-2 text-xs text-foreground hover:bg-accent">Cancel</button>
      </div>
    </form>
  );
}

// ── Settings panel: cash-position anchor + fee/tax rates ───────────────

function SettingsPanel({ settings, onSave }: { settings: FinanceSettings; onSave: (payload: Record<string, unknown>) => void }) {
  const [taxRateInput, setTaxRateInput] = useState(settings.taxRatePercent !== null ? String(settings.taxRatePercent) : "");
  const [stripeFeePercentInput, setStripeFeePercentInput] = useState(settings.stripeFeePercent !== null ? String(settings.stripeFeePercent) : "");
  const [stripeFeeFixedInput, setStripeFeeFixedInput] = useState(settings.stripeFeeFixedCents !== null ? String(settings.stripeFeeFixedCents / 100) : "");
  const [anchorAmountInput, setAnchorAmountInput] = useState(settings.cashPositionAnchorCents !== null ? String(settings.cashPositionAnchorCents / 100) : "");
  const [anchorDateInput, setAnchorDateInput] = useState(settings.cashPositionAnchorDate ? settings.cashPositionAnchorDate.slice(0, 10) : "");
  const [error, setError] = useState<string | null>(null);

  function parsePercent(raw: string): number | null | "invalid" {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0 || n > 100) return "invalid";
    return n;
  }

  function parseEurToCents(raw: string): number | null | "invalid" {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return "invalid";
    return Math.round(n * 100);
  }

  return (
    <div className="panel p-6">
      <h3 className="text-lg font-semibold">Settings</h3>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
        Cash position starting point, and the estimate rates used above. All optional — leave blank to hide
        the corresponding figure rather than show a guess.
      </p>

      {error ? (
        <p className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          const taxRate = parsePercent(taxRateInput);
          const stripePct = parsePercent(stripeFeePercentInput);
          const stripeFixed = parseEurToCents(stripeFeeFixedInput);
          const anchorCents = parseEurToCents(anchorAmountInput);
          if (taxRate === "invalid" || stripePct === "invalid" || stripeFixed === "invalid" || anchorCents === "invalid") {
            setError("Enter valid numbers, or leave a field blank to clear it.");
            return;
          }
          if ((anchorCents !== null) !== (anchorDateInput.trim() !== "")) {
            setError("Set both a cash-position balance and a date, or clear both.");
            return;
          }
          onSave({
            taxRatePercent: taxRate,
            stripeFeePercent: stripePct,
            stripeFeeFixedCents: stripeFixed,
            cashPositionAnchorCents: anchorCents,
            cashPositionAnchorDate: anchorDateInput.trim() ? new Date(`${anchorDateInput}T00:00:00.000Z`).toISOString() : null,
          });
        }}
        className="mt-4 space-y-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Cash position — balance (€)">
            <input type="number" step="0.01" className={input} value={anchorAmountInput} onChange={(e) => setAnchorAmountInput(e.target.value)} placeholder="e.g. 12500.00" />
          </Field>
          <Field label="Cash position — as of date">
            <input type="date" className={input} value={anchorDateInput} onChange={(e) => setAnchorDateInput(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Tax rate (%)">
            <input type="number" min={0} max={100} step="0.1" className={input} value={taxRateInput} onChange={(e) => setTaxRateInput(e.target.value)} placeholder="e.g. 20" />
          </Field>
          <Field label="Stripe fee (%)">
            <input type="number" min={0} max={100} step="0.01" className={input} value={stripeFeePercentInput} onChange={(e) => setStripeFeePercentInput(e.target.value)} placeholder="e.g. 1.5" />
          </Field>
          <Field label="Stripe fee — fixed per payment (€)">
            <input type="number" min={0} step="0.01" className={input} value={stripeFeeFixedInput} onChange={(e) => setStripeFeeFixedInput(e.target.value)} placeholder="e.g. 0.25" />
          </Field>
        </div>
        <button type="submit" className="btn-primary px-4 py-2 text-xs">Save settings</button>
      </form>
    </div>
  );
}
