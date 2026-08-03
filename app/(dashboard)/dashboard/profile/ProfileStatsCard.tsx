"use client";

import { useMemo, useState } from "react";

import {
  formatDistanceKm,
  formatWeightKg,
  rangeStartDate,
  sumStatsInRange,
  type MemberStatsData,
  type StatsRange,
} from "@/lib/member-stats";

const RANGE_OPTIONS: { value: StatsRange; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "year", label: "Last year" },
  { value: "6months", label: "6 months" },
  { value: "3months", label: "3 months" },
  { value: "month", label: "1 month" },
  { value: "week", label: "1 week" },
  { value: "custom", label: "Custom" },
];

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function ProfileStatsCard({ data }: { data: MemberStatsData }) {
  const [range, setRange] = useState<StatsRange>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState(todayIso());

  const totals = useMemo(() => {
    const start = rangeStartDate(range, new Date(), customFrom);
    const end = range === "custom" && customTo ? customTo : null;
    return sumStatsInRange(data, start, end);
  }, [data, range, customFrom, customTo]);

  return (
    <div className="surface-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="label-caps">Your training</p>
        <label className="sr-only" htmlFor="stats-range">
          Date range
        </label>
        <select
          id="stats-range"
          value={range}
          onChange={(e) => setRange(e.target.value as StatsRange)}
          className="rounded-lg border border-border bg-input px-3 py-1.5 text-xs text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
        >
          {RANGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {range === "custom" ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            From
            <input
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-lg border border-border bg-input px-2.5 py-1.5 text-xs text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            To
            <input
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-lg border border-border bg-input px-2.5 py-1.5 text-xs text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
            />
          </label>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-3 gap-2">
        <StatTile label="Classes completed" value={totals.classesCompleted.toLocaleString("en-IE")} />
        <StatTile label="Weight lifted" value={formatWeightKg(totals.totalWeightKg)} />
        <StatTile label="Distance run" value={formatDistanceKm(totals.totalDistanceKm)} />
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-white/[0.02] p-3 text-center">
      <p className="text-display text-lg leading-tight tabular-nums text-foreground sm:text-xl">{value}</p>
      <p className="mt-1 text-[11px] leading-tight text-muted-foreground">{label}</p>
    </div>
  );
}
