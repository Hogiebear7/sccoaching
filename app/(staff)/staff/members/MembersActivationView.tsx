"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatPriceCents } from "@/lib/billing";
import type { MembershipPlanRecord, SubscriptionStatus } from "@/lib/db";
import {
  formatMembershipDate,
  isPeriodLapsed,
  SUBSCRIPTION_STATUS_LABEL,
  SUBSCRIPTION_STATUS_STYLE,
} from "@/lib/membership-status";
import { formatRemainingSessions } from "@/lib/scheduling-status";

export type MemberRow = {
  userId: string;
  email: string;
  fullName: string | null;
  currentPlanId: string | null;
  currentPlanName: string | null;
  currentStatus: SubscriptionStatus | null;
  currentPeriodEnd: string | null;
  currentRemainingSessions: number | null;
};

export function MembersActivationView({
  rows,
  plans,
}: {
  rows: MemberRow[];
  plans: MembershipPlanRecord[];
}) {
  return (
    <div className="space-y-5">
      <div>
        <p className="label-caps">Staff</p>
        <h1 className="text-display mt-1 text-[28px] leading-tight">Members</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {rows.length} member{rows.length === 1 ? "" : "s"} · use the detail link for full profile
          and coach notes.
        </p>
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mt-px h-3.5 w-3.5 shrink-0"
          >
            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>
            Manual override — sets provider to &ldquo;none&rdquo;, resets session count to 0. Use
            for cash payments, comps, or local testing. Does not interact with Revolut.
          </span>
        </div>
      </div>

      {plans.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/[0.12] bg-white/[0.02] p-6 text-center">
          <p className="text-sm font-medium">No active plans</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create a plan on the{" "}
            <Link href="/staff/plans" className="text-gold transition hover:text-gold/80">
              Plans page
            </Link>{" "}
            before activating memberships.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No member accounts yet.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <MemberCard key={row.userId} row={row} plans={plans} />
          ))}
        </div>
      )}
    </div>
  );
}

function MemberCard({
  row,
  plans,
}: {
  row: MemberRow;
  plans: MembershipPlanRecord[];
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState(
    row.currentPlanId ?? plans[0]?.id ?? ""
  );
  const [periodEnd, setPeriodEnd] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const periodLapsed =
    row.currentStatus !== null &&
    isPeriodLapsed({ status: row.currentStatus, currentPeriodEnd: row.currentPeriodEnd });

  const isCurrentlyActive = row.currentStatus === "active" && !periodLapsed;

  async function handleActivate() {
    if (!selectedPlanId) {
      setError("Select a plan first.");
      return;
    }

    setError(null);
    setSuccessMsg(null);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/admin/membership/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: row.userId,
          planId: selectedPlanId,
          periodEndIso: periodEnd || undefined,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(data?.message ?? "Could not activate membership.");
        return;
      }

      setSuccessMsg(data?.message ?? "Activated.");
      setShowForm(false);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="panel p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {row.fullName ?? row.email}
          </p>
          {row.fullName ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.email}</p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {row.currentStatus ? (
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  periodLapsed
                    ? "bg-destructive/10 text-destructive"
                    : SUBSCRIPTION_STATUS_STYLE[row.currentStatus]
                }`}
              >
                {periodLapsed
                  ? "Period ended"
                  : SUBSCRIPTION_STATUS_LABEL[row.currentStatus]}
              </span>
            ) : (
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                No subscription
              </span>
            )}

            {row.currentPlanName ? (
              <span className="text-xs text-muted-foreground">{row.currentPlanName}</span>
            ) : null}

            {isCurrentlyActive && row.currentRemainingSessions !== null ? (
              <span className="text-xs text-muted-foreground">
                {formatRemainingSessions(row.currentRemainingSessions)}
              </span>
            ) : null}

            {row.currentPeriodEnd ? (
              <span className="text-xs text-muted-foreground">
                Period ends {formatMembershipDate(row.currentPeriodEnd)}
              </span>
            ) : isCurrentlyActive ? (
              <span className="text-xs text-muted-foreground/50">No expiry set</span>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 gap-2">
          <Link
            href={`/staff/members/${row.userId}`}
            className="rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent"
          >
            Details →
          </Link>
          {plans.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setShowForm(!showForm);
                setError(null);
                setSuccessMsg(null);
              }}
              className="rounded-xl border border-teal-700/60 bg-gradient-to-b from-teal-500 to-teal-600 px-3 py-1.5 text-xs font-semibold text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16),0_1px_2px_0_rgba(0,0,0,0.4)] transition-[background-color,transform] duration-150 hover:from-teal-400 hover:to-teal-500 active:translate-y-px"
            >
              {showForm ? "Cancel" : isCurrentlyActive ? "Re-activate" : "Activate"}
            </button>
          ) : null}
        </div>
      </div>

      {successMsg ? (
        <p className="mt-3 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
          {successMsg}
        </p>
      ) : null}

      {showForm ? (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          {error ? (
            <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={selectedPlanId}
              onChange={(e) => setSelectedPlanId(e.target.value)}
              className="flex-1 rounded-xl border border-border bg-input px-3 py-2 text-xs text-foreground outline-none transition focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
            >
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} ({formatPriceCents(plan.priceCents)} / {plan.billingInterval})
                </option>
              ))}
            </select>

            <input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              aria-label="Period end date (optional)"
              className="rounded-xl border border-border bg-input px-3 py-2 text-xs text-foreground outline-none transition focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
            />

            <button
              type="button"
              onClick={handleActivate}
              disabled={isSubmitting}
              className="rounded-xl border border-teal-700/60 bg-gradient-to-b from-teal-500 to-teal-600 px-4 py-2 text-xs font-semibold text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16),0_1px_2px_0_rgba(0,0,0,0.4)] transition-[background-color,transform] duration-150 hover:from-teal-400 hover:to-teal-500 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Activating…" : "Confirm"}
            </button>
          </div>

          <p className="text-[11px] text-muted-foreground/60">
            Period end is optional — leave blank for no expiry. Session count resets to 0.
          </p>
        </div>
      ) : null}
    </div>
  );
}
