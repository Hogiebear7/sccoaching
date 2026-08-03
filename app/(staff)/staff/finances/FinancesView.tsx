"use client";

import { useMemo, useState } from "react";

import { formatPriceCents } from "@/lib/billing";
import { formatMembershipDate } from "@/lib/membership-status";
import {
  REVENUE_RANGE_PRESETS,
  boundsForPreset,
  filterByRange,
  groupByAgeBracket,
  groupByPackage,
  sumCents,
  type RevenueLine,
  type RevenueRangePreset,
} from "@/lib/finance-shared";

const input =
  "rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15";

export function FinancesView({
  lines,
  taxRatePercent,
}: {
  lines: RevenueLine[];
  taxRatePercent: number | null;
}) {
  const [preset, setPreset] = useState<RevenueRangePreset["key"] | "custom">("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [taxRateInput, setTaxRateInput] = useState(taxRatePercent !== null ? String(taxRatePercent) : "");
  const [savingRate, setSavingRate] = useState(false);
  const [rateSaved, setRateSaved] = useState<number | null>(taxRatePercent);
  const [rateError, setRateError] = useState<string | null>(null);

  const [fromISO, toISO] =
    preset === "custom"
      ? [customFrom ? new Date(customFrom).toISOString() : null, customTo ? new Date(`${customTo}T23:59:59.999`).toISOString() : null]
      : boundsForPreset(preset);

  const filtered = useMemo(() => filterByRange(lines, fromISO, toISO), [lines, fromISO, toISO]);

  const totalCents = sumCents(filtered);
  const renewalCents = sumCents(filtered.filter((l) => l.kind === "membership_renewal"));
  const passCents = sumCents(filtered.filter((l) => l.kind === "pass_pack"));
  const byPackage = useMemo(() => groupByPackage(filtered), [filtered]);
  const byAge = useMemo(() => groupByAgeBracket(filtered), [filtered]);

  const taxEstimateCents =
    rateSaved !== null ? Math.round((totalCents * rateSaved) / 100) : null;

  async function saveTaxRate() {
    setSavingRate(true);
    setRateError(null);
    try {
      const trimmed = taxRateInput.trim();
      const value = trimmed === "" ? null : Number(trimmed);
      if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100)) {
        setRateError("Enter a rate between 0 and 100, or leave blank to clear it.");
        return;
      }
      const res = await fetch("/api/staff/settings/finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taxRatePercent: value }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setRateError(data?.message ?? "Could not save.");
        return;
      }
      setRateSaved(value);
    } catch {
      setRateError("Something went wrong. Please try again.");
    } finally {
      setSavingRate(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="label-caps">Staff</p>
        <h2 className="text-display mt-1 text-[28px] leading-tight">Finances</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Gross revenue actually received from members — membership renewals and one-time class
          passes/top-ups, sourced from the Stripe and Revolut payment webhooks. This app doesn&apos;t
          track expenses, so it can only ever show gross figures, never profit.
        </p>
      </div>

      {/* Range picker */}
      <div className="panel flex flex-wrap items-center gap-2 p-4">
        {REVENUE_RANGE_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPreset(p.key)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              preset === p.key
                ? "bg-primary text-primary-foreground"
                : "border border-border text-muted-foreground hover:border-primary hover:text-foreground"
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPreset("custom")}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
            preset === "custom"
              ? "bg-primary text-primary-foreground"
              : "border border-border text-muted-foreground hover:border-primary hover:text-foreground"
          }`}
        >
          Custom range
        </button>
        {preset === "custom" ? (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              aria-label="From date"
              className={input}
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              aria-label="To date"
              className={input}
            />
          </div>
        ) : null}
      </div>

      {/* Totals */}
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryStat label="Total revenue" value={formatPriceCents(totalCents)} detail={`${filtered.length} payment${filtered.length === 1 ? "" : "s"} in range.`} />
        <SummaryStat label="Membership renewals" value={formatPriceCents(renewalCents)} detail="Recurring subscription payments." />
        <SummaryStat label="Passes & top-ups" value={formatPriceCents(passCents)} detail="One-time purchases." />
      </div>

      {/* Breakdown by package */}
      <div className="panel p-6">
        <h3 className="text-lg font-semibold">By package</h3>
        {byPackage.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No revenue in this range.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {byPackage.map((row) => (
              <div key={row.label} className="well flex items-center justify-between gap-3 p-3">
                <div>
                  <p className="text-sm font-medium">{row.label}</p>
                  <p className="text-xs text-muted-foreground">{row.count} payment{row.count === 1 ? "" : "s"}</p>
                </div>
                <p className="text-sm font-semibold tabular-nums">{formatPriceCents(row.amountCents)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Breakdown by age bracket */}
      <div className="panel p-6">
        <h3 className="text-lg font-semibold">By member age</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Based on date of birth on file. Members without one are grouped under Unknown.
        </p>
        {byAge.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No revenue in this range.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {byAge.map((row) => (
              <div key={row.bracket} className="well flex items-center justify-between gap-3 p-3">
                <div>
                  <p className="text-sm font-medium">{row.label}</p>
                  <p className="text-xs text-muted-foreground">{row.count} payment{row.count === 1 ? "" : "s"}</p>
                </div>
                <p className="text-sm font-semibold tabular-nums">{formatPriceCents(row.amountCents)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tax estimate */}
      <div className="panel p-6">
        <h3 className="text-lg font-semibold">Estimated tax</h3>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          Not a filing figure. This app has no expense tracking, so it can only multiply the gross
          revenue above by a rate you set yourself — it doesn&apos;t know your business structure, VAT
          treatment, or allowable expenses. Use this as a rough indicator only, and get the real
          number from your accountant.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Tax rate (%)</span>
            <input
              type="number"
              min={0}
              max={100}
              step="0.1"
              value={taxRateInput}
              onChange={(e) => setTaxRateInput(e.target.value)}
              placeholder="e.g. 20"
              className={`${input} w-32`}
            />
          </label>
          <button
            type="button"
            onClick={saveTaxRate}
            disabled={savingRate}
            className="btn-primary px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
          >
            {savingRate ? "Saving…" : "Save rate"}
          </button>
        </div>

        {rateError ? (
          <p className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {rateError}
          </p>
        ) : null}

        {taxEstimateCents !== null ? (
          <p className="mt-4 text-sm">
            Estimated at <span className="font-semibold">{rateSaved}%</span> of revenue in range:{" "}
            <span className="font-semibold tabular-nums">{formatPriceCents(taxEstimateCents)}</span>
          </p>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">Set a rate above to see an estimate.</p>
        )}
      </div>

      {/* Recent transactions */}
      <div className="panel p-6">
        <h3 className="text-lg font-semibold">Recent payments in range</h3>
        {filtered.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No payments in this range.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {filtered.slice(0, 20).map((line) => (
              <div key={line.id} className="well flex flex-wrap items-center justify-between gap-3 p-3">
                <div>
                  <p className="text-sm font-medium">{line.packageName ?? "Unknown package"}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatMembershipDate(line.occurredAt)} · {line.kind === "membership_renewal" ? "Renewal" : "Pass/top-up"} ·{" "}
                    {line.provider}
                  </p>
                </div>
                <p className="text-sm font-semibold tabular-nums">{formatPriceCents(line.amountCents)}</p>
              </div>
            ))}
            {filtered.length > 20 ? (
              <p className="pt-1 text-xs text-muted-foreground">
                Showing the most recent 20 of {filtered.length} payments in range.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="panel rounded-3xl p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-3 text-display text-[28px] tabular-nums">{value}</p>
      <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}
