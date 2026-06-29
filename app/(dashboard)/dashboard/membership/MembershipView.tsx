"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatPriceCents, isPendingCheckoutStale } from "@/lib/billing";
import type { BillingProvider, ClassCategoryRecord, MembershipPlanRecord, SubscriptionStatus } from "@/lib/db";
import {
  formatMembershipDate,
  isPeriodLapsed,
  SUBSCRIPTION_STATUS_LABEL,
} from "@/lib/membership-status";
import {
  classCategoryLabel,
  formatRemainingSessions,
  formatSessionAllowance,
} from "@/lib/scheduling-status";

function planCardClass(
  isCurrent: boolean,
  status: SubscriptionStatus | null,
  lapsed: boolean,
): string {
  if (!isCurrent) return "bg-card";
  if (status === "active" && !lapsed) return "bg-primary/5 border-primary/30";
  if (lapsed || status === "past_due") return "bg-destructive/5 border-destructive/30";
  return "bg-card";
}

function statusBadgeClass(
  status: SubscriptionStatus,
  lapsed: boolean,
  stale: boolean,
): string {
  if (lapsed || status === "past_due")
    return "bg-destructive/10 text-destructive border-destructive/20";
  if (stale) return "bg-muted text-muted-foreground border";
  if (status === "active") return "bg-primary/10 text-primary border-primary/20";
  return "bg-muted text-muted-foreground border";
}

function statusBadgeLabel(
  status: SubscriptionStatus,
  lapsed: boolean,
  stale: boolean,
): string {
  if (lapsed) return "Period ended";
  if (stale) return "Checkout expired";
  return SUBSCRIPTION_STATUS_LABEL[status];
}

function WarningIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0 mt-px"
    >
      <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0 mt-px"
    >
      <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

export function MembershipView({
  plans,
  categories,
  deletedLabels,
  currentPlanId,
  currentPlanName,
  subscriptionStatus,
  subscriptionUpdatedAt,
  subscriptionCurrentPeriodEnd,
  subscriptionProvider,
  remainingSessions,
  billingConfigured,
}: {
  plans: MembershipPlanRecord[];
  categories: ClassCategoryRecord[];
  deletedLabels: Record<string, string>;
  currentPlanId: string | null;
  currentPlanName: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  subscriptionUpdatedAt: string | null;
  subscriptionCurrentPeriodEnd: string | null;
  subscriptionProvider: BillingProvider | null;
  remainingSessions: number | null;
  billingConfigured: boolean;
}) {
  const pendingIsStale =
    subscriptionStatus === "pending" &&
    subscriptionUpdatedAt !== null &&
    isPendingCheckoutStale(subscriptionUpdatedAt);

  const periodLapsed =
    subscriptionStatus !== null &&
    isPeriodLapsed({
      status: subscriptionStatus,
      currentPeriodEnd: subscriptionCurrentPeriodEnd,
    });

  const isActiveNotLapsed = subscriptionStatus === "active" && !periodLapsed;

  const router = useRouter();
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleSelect(planId: string) {
    setSelectingId(planId);
    setFormError(null);
    setSuccessMessage(null);

    try {
      const res = await fetch("/api/membership/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setFormError(data?.message ?? "Could not select this plan. Please try again.");
        return;
      }

      if (data?.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }

      setSuccessMessage(data?.message ?? "Plan selected.");
      router.refresh();
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setSelectingId(null);
    }
  }

  return (
    <div className="space-y-5 pt-2">

      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Membership</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your plan controls which sessions you can book.
        </p>
      </div>

      {/* Current plan card */}
      <div className="rounded-2xl border bg-card p-5 shadow-[var(--shadow-card)]">
        {currentPlanId && currentPlanName && subscriptionStatus ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Current plan
                </p>
                <p className="mt-2 text-xl font-semibold tracking-tight">{currentPlanName}</p>
              </div>
              <span
                className={`shrink-0 text-[11px] rounded-full px-2.5 py-1 font-medium border ${statusBadgeClass(subscriptionStatus, periodLapsed, pendingIsStale)}`}
              >
                {statusBadgeLabel(subscriptionStatus, periodLapsed, pendingIsStale)}
              </span>
            </div>

            {/* Alert: period lapsed */}
            {periodLapsed && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                <WarningIcon />
                <span>
                  Your billing period ended on{" "}
                  {subscriptionCurrentPeriodEnd
                    ? formatMembershipDate(subscriptionCurrentPeriodEnd)
                    : "an earlier date"}
                  {subscriptionProvider === "revolut"
                    ? ". Your Revolut subscription may have been cancelled or a payment failed — select your plan below to continue."
                    : ". Select your plan below to continue."}
                </span>
              </div>
            )}

            {/* Alert: checkout expired */}
            {pendingIsStale && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-border bg-muted p-3 text-xs text-muted-foreground">
                <ClockIcon />
                <span>Your checkout session expired. Retry below to start a new one.</span>
              </div>
            )}

            {/* Alert: past due */}
            {subscriptionStatus === "past_due" && !periodLapsed && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                <WarningIcon />
                <span>
                  Your last payment failed. Update your payment method to keep your sessions.
                </span>
              </div>
            )}

            {/* Sessions remaining */}
            {isActiveNotLapsed && remainingSessions !== null && (
              <p className="mt-3 text-xs text-muted-foreground">
                {formatRemainingSessions(remainingSessions)} this billing period.
              </p>
            )}

            {/* Period end note */}
            {isActiveNotLapsed && subscriptionCurrentPeriodEnd && (
              subscriptionProvider === "revolut" ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Billing period ends{" "}
                  {formatMembershipDate(subscriptionCurrentPeriodEnd)} · renews automatically via
                  Revolut.
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  Current period ends {formatMembershipDate(subscriptionCurrentPeriodEnd)}. Select
                  your plan again after that to keep access.
                </p>
              )
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            You haven&apos;t selected a plan yet. Choose one below.
          </p>
        )}

        {/* Billing setup note */}
        <p
          className={`text-[11px] text-muted-foreground ${
            currentPlanId ? "mt-4 border-t border-border pt-4" : "mt-2"
          }`}
        >
          {!billingConfigured
            ? "Online payment isn’t set up yet — selecting a plan records your choice only. Staff can activate your membership manually."
            : "Selecting a plan sets up a recurring Revolut subscription. Membership activates once the first payment is confirmed."}
        </p>
      </div>

      {/* Action banners */}
      {formError && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {formError}
        </p>
      )}
      {successMessage && (
        <p className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
          {successMessage}
        </p>
      )}

      {/* Plan list */}
      <div>
        <p className="mb-3 px-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          {currentPlanId ? "Change plan" : "Available plans"}
        </p>

        {plans.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-card p-8 text-center">
            <p className="text-sm font-medium">No plans available yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Check back soon.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {plans.map((plan) => {
              const isCurrent = plan.id === currentPlanId;
              const isLockedIn =
                isCurrent &&
                ((subscriptionStatus === "active" && !periodLapsed) ||
                  (subscriptionStatus === "pending" && !pendingIsStale));

              const buttonLabel =
                selectingId === plan.id
                  ? "Starting checkout…"
                  : isLockedIn
                  ? subscriptionStatus === "pending"
                    ? "Awaiting payment"
                    : "Selected"
                  : isCurrent
                  ? subscriptionStatus === "active" && periodLapsed
                    ? "Renew"
                    : subscriptionStatus === "pending" && pendingIsStale
                    ? "Retry expired checkout"
                    : "Retry checkout"
                  : "Select plan";

              return (
                <div
                  key={plan.id}
                  className={`rounded-2xl border p-5 shadow-[var(--shadow-card)] ${planCardClass(isCurrent, subscriptionStatus, periodLapsed)}`}
                >
                  {/* Header: name left, price right */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{plan.name}</p>
                      {plan.description && (
                        <p className="mt-1 text-xs text-muted-foreground">{plan.description}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-lg font-semibold">{formatPriceCents(plan.priceCents)}</p>
                      <p className="text-[11px] text-muted-foreground">per {plan.billingInterval}</p>
                    </div>
                  </div>

                  {/* Pills: sessions + categories */}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                      {formatSessionAllowance(plan.monthlySessionAllowance)}
                    </span>
                    {plan.allowedCategories.length === 0 ? (
                      <span className="rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground">
                        All class types
                      </span>
                    ) : (
                      plan.allowedCategories.map((category) => (
                        <span
                          key={category}
                          className="rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground"
                        >
                          {classCategoryLabel(categories, category, deletedLabels)}
                        </span>
                      ))
                    )}
                  </div>

                  {/* Select button */}
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => handleSelect(plan.id)}
                      disabled={isLockedIn || selectingId === plan.id}
                      className={`w-full rounded-xl px-4 py-2 text-sm font-semibold transition ${
                        isLockedIn
                          ? "cursor-not-allowed bg-secondary text-secondary-foreground opacity-70"
                          : "bg-primary text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                      }`}
                    >
                      {buttonLabel}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
