"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { formatPriceCents, isPendingCheckoutStale } from "@/lib/billing";
import type { MembershipPlanRecord, SubscriptionStatus } from "@/lib/db";
import {
  formatMembershipDate,
  isPeriodLapsed,
  SUBSCRIPTION_STATUS_LABEL,
  SUBSCRIPTION_STATUS_STYLE,
} from "@/lib/membership-status";
import { formatRemainingSessions } from "@/lib/scheduling-status";

const STATUS_OPTIONS: SubscriptionStatus[] = [
  "inactive",
  "pending",
  "active",
  "past_due",
  "canceled",
];

export function MembershipStatusPanel({
  memberId,
  plans,
  currentPlanId,
  currentPlanName,
  currentStatus,
  currentProvider,
  currentUpdatedAt,
  currentPeriodEnd,
  currentRemainingSessions,
}: {
  memberId: string;
  plans: MembershipPlanRecord[];
  currentPlanId: string | null;
  currentPlanName: string | null;
  currentStatus: SubscriptionStatus | null;
  currentProvider: "none" | "revolut" | null;
  currentUpdatedAt: string | null;
  currentRemainingSessions: number | null;
  currentPeriodEnd: string | null;
}) {
  const pendingIsStale =
    currentStatus === "pending" && currentUpdatedAt !== null && isPendingCheckoutStale(currentUpdatedAt);
  const periodLapsed =
    currentStatus !== null && isPeriodLapsed({ status: currentStatus, currentPeriodEnd });
  const router = useRouter();
  const [planId, setPlanId] = useState(currentPlanId ?? plans[0]?.id ?? "");
  const [status, setStatus] = useState<SubscriptionStatus>(currentStatus ?? "inactive");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!planId) {
      setError("Select a plan first.");
      return;
    }

    setError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      const res = await fetch(`/api/staff/members/${memberId}/subscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, status }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(data?.message ?? "Could not update membership. Please try again.");
        return;
      }

      setSuccessMessage(data?.message ?? "Membership updated.");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
      <h3 className="text-lg font-semibold text-zinc-50">Membership</h3>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-sm text-zinc-300">
          {currentPlanName ?? "No plan selected"}
        </span>
        {currentStatus ? (
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              periodLapsed ? "bg-red-500/15 text-red-300" : SUBSCRIPTION_STATUS_STYLE[currentStatus]
            }`}
          >
            {periodLapsed
              ? "Period ended"
              : pendingIsStale
                ? "Checkout expired"
                : SUBSCRIPTION_STATUS_LABEL[currentStatus]}
          </span>
        ) : null}
        {currentStatus === "active" && !periodLapsed ? (
          <span className="text-xs text-zinc-500">
            {formatRemainingSessions(currentRemainingSessions)}
          </span>
        ) : null}
        {pendingIsStale ? (
          <span className="text-xs text-zinc-500">
            Member can retry checkout themselves — no action needed.
          </span>
        ) : null}
        {periodLapsed ? (
          <span className="text-xs text-zinc-500">
            Billing period ended {currentPeriodEnd ? formatMembershipDate(currentPeriodEnd) : ""} —
            recurring renewal isn&apos;t automatic yet. Member can renew themselves, or set status below.
          </span>
        ) : null}
        {currentProvider === "revolut" ? (
          <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-400">
            Billed via Revolut
          </span>
        ) : null}
      </div>

      {plans.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-400">
          No plans exist yet — create one on the Plans page first.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <p className="text-xs text-zinc-500">
            Manual override (cash payment, comp, or correcting a stuck state). This
            doesn&apos;t affect any in-progress Revolut checkout.
          </p>

          {error ? (
            <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {error}
            </p>
          ) : null}

          {successMessage ? (
            <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
              {successMessage}
            </p>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row">
            <select
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-teal-500"
            >
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} ({formatPriceCents(plan.priceCents)} / {plan.billingInterval})
                </option>
              ))}
            </select>

            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as SubscriptionStatus)}
              className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-teal-500"
            >
              {STATUS_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {SUBSCRIPTION_STATUS_LABEL[value]}
                </option>
              ))}
            </select>

            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-xl bg-teal-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Saving…" : "Update"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
