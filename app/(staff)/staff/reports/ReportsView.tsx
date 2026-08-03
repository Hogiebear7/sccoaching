"use client";

import { useMemo, useState } from "react";

import { formatMembershipDate } from "@/lib/membership-status";
import {
  REPORT_RANGE_PRESETS,
  boundsForReportPreset,
  computeRetention,
  currentlyActiveCount,
  filterByRange,
  filterClassesByRange,
  groupClassesByType,
  type ClassReportRow,
  type MemberSignupRow,
  type ReportRangePreset,
  type SubscriptionRow,
} from "@/lib/reports-shared";

export function ReportsView({
  members,
  subscriptions,
  classes,
}: {
  members: MemberSignupRow[];
  subscriptions: SubscriptionRow[];
  classes: ClassReportRow[];
}) {
  const [preset, setPreset] = useState<ReportRangePreset["key"] | "custom">("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [fromISO, toISO] =
    preset === "custom"
      ? [
          customFrom ? new Date(customFrom).toISOString() : null,
          customTo ? new Date(`${customTo}T23:59:59.999`).toISOString() : null,
        ]
      : boundsForReportPreset(preset);

  const newMembers = useMemo(
    () => filterByRange(members, (m) => m.createdAt, fromISO, toISO).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [members, fromISO, toISO]
  );
  const newStarters = useMemo(
    () => filterByRange(subscriptions, (s) => s.createdAt, fromISO, toISO).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [subscriptions, fromISO, toISO]
  );
  const lost = useMemo(
    () =>
      filterByRange(
        subscriptions.filter((s) => s.status === "canceled"),
        (s) => s.updatedAt,
        fromISO,
        toISO
      ).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [subscriptions, fromISO, toISO]
  );
  const active = currentlyActiveCount(subscriptions);
  const { retainedCount, retainedBaseCount } = useMemo(() => computeRetention(subscriptions, fromISO), [subscriptions, fromISO]);

  const classesInRange = useMemo(() => filterClassesByRange(classes, fromISO, toISO), [classes, fromISO, toISO]);
  const byType = useMemo(() => groupClassesByType(classesInRange), [classesInRange]);

  return (
    <div className="space-y-6">
      <div>
        <p className="label-caps">Staff</p>
        <h2 className="text-display mt-1 text-[28px] leading-tight">Reports</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Membership and class activity — who joined, who started paying, who left, and how classes
          are being used. No monetary figures here; see Finances for revenue.
        </p>
      </div>

      {/* Range picker */}
      <div className="panel flex flex-wrap items-center gap-2 p-4">
        {REPORT_RANGE_PRESETS.map((p) => (
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
              className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              aria-label="To date"
              className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
            />
          </div>
        ) : null}
      </div>

      {/* Summary stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryStat label="New members" value={String(newMembers.length)} detail="Accounts created in range." />
        <SummaryStat label="New starters" value={String(newStarters.length)} detail="First activated a membership in range." />
        <SummaryStat label="Lost" value={String(lost.length)} detail="Cancelled in range." />
        <SummaryStat label="Currently active" value={String(active)} detail="Right now, not range-bound." />
      </div>

      {/* Retention */}
      <div className="panel p-6">
        <h3 className="text-lg font-semibold">Retention</h3>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          This app stores each member&apos;s current status, not a full history of when it changed —
          so this isn&apos;t a precise point-in-time figure. It&apos;s the best available proxy: of
          members who first started paying before this range began, how many are still active today.
        </p>
        {retainedBaseCount === null ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Pick a range with a start date (not All time) to see a retention figure.
          </p>
        ) : retainedBaseCount === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No members had started before this range began.</p>
        ) : (
          <p className="mt-4 text-sm">
            <span className="font-semibold tabular-nums">{retainedCount}</span> of{" "}
            <span className="font-semibold tabular-nums">{retainedBaseCount}</span> still active —{" "}
            <span className="font-semibold tabular-nums">
              {Math.round(((retainedCount ?? 0) / retainedBaseCount) * 100)}%
            </span>
          </p>
        )}
      </div>

      {/* Bookings by class type */}
      <div className="panel p-6">
        <h3 className="text-lg font-semibold">Bookings by class type</h3>
        {byType.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No classes in this range.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {byType.map((row) => (
              <div key={row.label} className="well flex flex-wrap items-center justify-between gap-3 p-3">
                <div>
                  <p className="text-sm font-medium">{row.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.classCount} class{row.classCount === 1 ? "" : "es"} · {row.attendedCount} attended
                  </p>
                </div>
                <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                  {row.bookingCount} of {row.capacityTotal} booked
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Drill-down: new starters */}
      <div className="panel p-6">
        <h3 className="text-lg font-semibold">New starters in range</h3>
        {newStarters.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No new starters in this range.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {newStarters.map((s) => (
              <div key={s.userId} className="well flex flex-wrap items-center justify-between gap-3 p-3">
                <div>
                  <p className="text-sm font-medium">{s.fullName ?? s.email}</p>
                  {s.fullName ? <p className="text-xs text-muted-foreground">{s.email}</p> : null}
                </div>
                <span className="text-xs text-muted-foreground">{formatMembershipDate(s.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Drill-down: lost */}
      <div className="panel p-6">
        <h3 className="text-lg font-semibold">Lost in range</h3>
        {lost.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No members lost in this range.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {lost.map((s) => (
              <div key={s.userId} className="well flex flex-wrap items-center justify-between gap-3 p-3">
                <div>
                  <p className="text-sm font-medium">{s.fullName ?? s.email}</p>
                  {s.fullName ? <p className="text-xs text-muted-foreground">{s.email}</p> : null}
                </div>
                <span className="text-xs text-muted-foreground">{formatMembershipDate(s.updatedAt)}</span>
              </div>
            ))}
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
