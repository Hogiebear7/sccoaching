"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { formatPriceCents, isPendingCheckoutStale } from "@/lib/billing";
import { PageHeader } from "@/components/ui/PageHeader";
import type { BillingProvider, ClassCategoryRecord, ClassPassProductRecord, MembershipPlanRecord, SubscriptionStatus } from "@/lib/db";
import {
  formatMembershipDate,
  isPeriodLapsed,
  SUBSCRIPTION_STATUS_LABEL,
} from "@/lib/membership-status";
import {
  classCategoryLabel,
  formatSessionAllowance,
  type ClassPassBalance,
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
  passBalance,
  purchasedPasses,
  passProducts,
  passCheckoutStatus,
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
  passBalance: ClassPassBalance | null;
  /** Purchased pass-pack balance from the ledger — separate from the plan's
      monthly allowance and never reset by billing periods. */
  purchasedPasses: number;
  passProducts: ClassPassProductRecord[];
  /** Return-from-checkout banner state ("pending" | "cancelled"). */
  passCheckoutStatus: string | null;
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
  const [buyingProductId, setBuyingProductId] = useState<string | null>(null);
  const [passError, setPassError] = useState<string | null>(null);
  // One idempotency key per product per page visit: a double-click (or a
  // back-navigation retry) resumes the same checkout instead of creating a
  // second Stripe session.
  const passKeysRef = useRef<Map<string, string>>(new Map());

  function passKeyFor(productId: string): string {
    let key = passKeysRef.current.get(productId);
    if (!key) {
      key = crypto.randomUUID();
      passKeysRef.current.set(productId, key);
    }
    return key;
  }

  async function handleBuyPasses(productId: string) {
    setBuyingProductId(productId);
    setPassError(null);

    try {
      const res = await fetch("/api/passes/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, idempotencyKey: passKeyFor(productId) }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setPassError(data?.message ?? "Could not start checkout. Please try again.");
        return;
      }

      if (data?.checkoutUrl) {
        window.location.assign(data.checkoutUrl);
        return; // keep the loading state while the browser navigates
      }

      setPassError("Checkout could not be started. Please try again.");
    } catch {
      setPassError("Something went wrong. Please try again.");
    } finally {
      setBuyingProductId(null);
    }
  }

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
    <div className="space-y-8">

      <PageHeader
        eyebrow="Club"
        title="Membership"
        subtitle="Your plan controls which sessions you can book."
      />

      {/* Current plan card */}
      <div className="panel p-5">
        {currentPlanId && currentPlanName && subscriptionStatus ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="label-caps">
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
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
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
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-muted p-3 text-xs text-muted-foreground">
                <ClockIcon />
                <span>Your checkout session expired. Retry below to start a new one.</span>
              </div>
            )}

            {/* Alert: past due */}
            {subscriptionStatus === "past_due" && !periodLapsed && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                <WarningIcon />
                <span>
                  Your last payment failed. Update your payment method to keep your sessions.
                </span>
              </div>
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

      {/* Class passes this period */}
      <div className="panel p-5">
        <p className="label-caps">Class passes</p>

        {!isActiveNotLapsed || !passBalance ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {currentPlanId
              ? "Your membership isn't active right now — class passes appear here once it is."
              : "Choose a plan below to get class passes."}
          </p>
        ) : passBalance.remaining === null ? (
          <>
            <p className="text-display mt-2 text-[28px] leading-tight">Unlimited</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Your plan has no monthly class cap — book as often as you like.
            </p>
          </>
        ) : (
          <>
            <p className="text-display mt-2 text-[28px] leading-tight tabular-nums">
              {passBalance.remaining}
              <span className="ml-2 align-middle text-sm font-normal tracking-normal text-muted-foreground">
                pass{passBalance.remaining === 1 ? "" : "es"} remaining
              </span>
            </p>

            <p className="mt-2 text-xs text-muted-foreground tabular-nums">
              {passBalance.allowance} included · {passBalance.used} used
              {passBalance.extra > 0 ? (
                <> · <span className="font-medium text-gold">{passBalance.extra} extra</span></>
              ) : null}
            </p>

            {passBalance.extra > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Includes {passBalance.extra} bonus pass{passBalance.extra === 1 ? "" : "es"} added
                by your coach for this period.
              </p>
            ) : null}

            {passBalance.overusedBy > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                You&apos;ve booked {passBalance.overusedBy} more than your current allowance this
                period — nothing to fix on your side; talk to your coach if anything looks off.
              </p>
            ) : null}

            <p className="mt-3 border-t border-white/[0.06] pt-3 text-[11px] text-muted-foreground">
              Passes reset when your billing period renews
              {subscriptionCurrentPeriodEnd
                ? ` on ${formatMembershipDate(subscriptionCurrentPeriodEnd)}`
                : ""}
              .
            </p>
          </>
        )}

        {/* Purchased pass packs — separate pool, doesn't reset */}
        {purchasedPasses > 0 && (
          <div className="mt-3 border-t border-white/[0.06] pt-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold tracking-tight">Pass packs</span>
              <span className="text-display text-[17px] text-gold tabular-nums">
                {purchasedPasses} pass{purchasedPasses === 1 ? "" : "es"}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Purchased passes — used automatically once your monthly passes run out.
              They don&apos;t reset with your billing period.
            </p>
          </div>
        )}
      </div>

      {/* Buy class passes — one-off pass packs, separate from the plan */}
      {passProducts.length > 0 && (
        <div>
          <p className="mb-3 px-1 label-caps">Buy Class Passes</p>

          {passCheckoutStatus === "pending" && (
            <p className="mb-3 rounded-lg border border-teal-500/25 bg-teal-500/[0.08] px-4 py-3 text-sm text-teal-300">
              Payment received — your passes will appear above within a few
              seconds, once Stripe confirms the payment.
            </p>
          )}
          {passCheckoutStatus === "cancelled" && (
            <p className="mb-3 rounded-lg border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-sm text-muted-foreground">
              Checkout cancelled — no payment was taken.
            </p>
          )}
          {passError && (
            <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {passError}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {passProducts.map((product) => (
              <div key={product.id} className="panel flex flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{product.name}</p>
                    {product.description && (
                      <p className="mt-1 text-xs text-muted-foreground">{product.description}</p>
                    )}
                  </div>
                  <span className="chip shrink-0 border-gold/30 bg-gold/[0.08] text-[11px] font-semibold !text-gold">
                    {product.passCount} passes
                  </span>
                </div>
                <p className="text-display mt-3 text-[22px] tabular-nums">
                  {formatPriceCents(product.priceCents)}
                </p>
                <button
                  type="button"
                  onClick={() => handleBuyPasses(product.id)}
                  disabled={buyingProductId !== null}
                  className="btn-primary mt-4 w-full px-4 py-2.5 disabled:cursor-not-allowed"
                >
                  {buyingProductId === product.id ? (
                    <>
                      <span
                        aria-hidden="true"
                        className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white motion-reduce:animate-none"
                      />
                      Starting checkout…
                    </>
                  ) : (
                    "Buy pack"
                  )}
                </button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Pass packs top up your monthly plan passes and never expire with the
            billing period. They&apos;re added automatically once payment is confirmed.
          </p>
        </div>
      )}

      {/* Action banners */}
      {formError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {formError}
        </p>
      )}
      {successMessage && (
        <p className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
          {successMessage}
        </p>
      )}

      {/* Plan list */}
      <div>
        <p className="mb-3 px-1 label-caps">
          {currentPlanId ? "Change plan" : "Available plans"}
        </p>

        {plans.length === 0 ? (
          <div className="empty-state">
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
                  className={`rounded-[10px] border p-5 shadow-[var(--shadow-card)] ${planCardClass(isCurrent, subscriptionStatus, periodLapsed)}`}
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
                      className={`w-full rounded-lg px-4 py-2 text-sm font-semibold transition ${
                        isLockedIn
                          ? "cursor-not-allowed bg-secondary text-secondary-foreground opacity-70"
                          : "border btn-primary text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16),0_1px_2px_0_rgba(0,0,0,0.4)] disabled:cursor-not-allowed disabled:opacity-60"
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
